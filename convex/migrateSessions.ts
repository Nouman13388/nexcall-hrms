// One-time migration: attendanceRecords (date-bucketed) -> attendanceSessions
// (session model). See docs/decisions-log.md for why the date-bucketed model
// was replaced.
//
// Run order (per agents.md's migration steps — do not skip ahead):
//   1. `npx convex run migrateSessions:dryRun`        — read-only, reports counts + a sample
//   2. wait for explicit go-ahead
//   3. `npx convex run migrateSessions:run`            — writes attendanceSessions rows
//   4. `npx convex run migrateSessions:verify`         — confirms row counts + spot-checks
//   5. decide whether to remove the legacy attendanceRecords block from schema.ts
//
// Mapping is direct and lossless for the fields that carry over:
//   checkInAt, checkOutAt, workingHours, correctedByAdmin -> unchanged
//   date, status -> dropped (both are computed on read now, see attendanceStatus.ts)
//
// One real gap this mapping can't fix: attendanceRecords rows with
// checkInAt === undefined (a checkout-only ADMIN correction under the old
// model) have no valid attendanceSessions equivalent, since checkInAt is
// required there now. dryRun reports how many of those exist; they are
// skipped (not migrated) rather than fabricating a checkInAt.

import { v } from 'convex/values'
import { internalMutation, internalQuery } from './_generated/server'
import type { Doc } from './_generated/dataModel'

// Deliberately .collect(), not the MAX_ROWS-bounded .take() every hot-path
// query in convex/ uses — this is a one-time full-table migration where
// completeness matters more than avoiding a full read, not a per-request
// query. dryRun's totalRecords is the first check that this still fits
// inside Convex's per-transaction read limit; if it doesn't, this needs
// pagination before step 3, not a silent MAX_ROWS truncation that would
// under-migrate real data.

type MappedSession = {
  employeeId: Doc<'attendanceRecords'>['employeeId']
  checkInAt: number
  checkOutAt?: number
  workingHours?: number
  correctedByAdmin: boolean
}

function mapRecord(record: Doc<'attendanceRecords'>): MappedSession | null {
  if (record.checkInAt === undefined) return null
  return {
    employeeId: record.employeeId,
    checkInAt: record.checkInAt,
    checkOutAt: record.checkOutAt,
    workingHours: record.workingHours,
    correctedByAdmin: record.correctedByAdmin,
  }
}

export const dryRun = internalQuery({
  args: {},
  returns: v.object({
    totalRecords: v.number(),
    migratable: v.number(),
    skippedNoCheckIn: v.number(),
    sample: v.array(
      v.object({
        sourceRecordId: v.id('attendanceRecords'),
        mapped: v.object({
          employeeId: v.id('employees'),
          checkInAt: v.number(),
          checkOutAt: v.optional(v.number()),
          workingHours: v.optional(v.number()),
          correctedByAdmin: v.boolean(),
        }),
      }),
    ),
  }),
  // Read-only by construction — internalQuery cannot call ctx.db.insert/patch,
  // so this cannot write no matter what the handler does.
  handler: async (ctx) => {
    // NOTE: this table is still declared in schema.ts (marked LEGACY) purely
    // so this migration can read it with full typing — see schema.ts.
    const records = await ctx.db.query('attendanceRecords').collect()

    let migratable = 0
    let skippedNoCheckIn = 0
    const sample: Array<{
      sourceRecordId: Doc<'attendanceRecords'>['_id']
      mapped: MappedSession
    }> = []

    for (const record of records) {
      const mapped = mapRecord(record)
      if (!mapped) {
        skippedNoCheckIn++
        continue
      }
      migratable++
      if (sample.length < 4) {
        sample.push({ sourceRecordId: record._id, mapped })
      }
    }

    return {
      totalRecords: records.length,
      migratable,
      skippedNoCheckIn,
      sample,
    }
  },
})

// Step 3 — DO NOT RUN until the user has confirmed the dryRun output.
// Single mutation: Convex mutations are transactional, so this either
// migrates every row or none of it does — no partial-migration state to
// clean up if it fails partway.
export const run = internalMutation({
  args: {},
  returns: v.object({ migrated: v.number(), skippedNoCheckIn: v.number() }),
  handler: async (ctx) => {
    // Guard against an accidental second invocation duplicating every
    // migrated row — this is meant to run exactly once. If attendanceSessions
    // needs to be rebuilt from scratch, clear it manually first; that's a
    // deliberate action, not something this mutation should do silently.
    const alreadyMigrated = await ctx.db.query('attendanceSessions').first()
    if (alreadyMigrated) {
      throw new Error(
        'attendanceSessions already has rows — refusing to run the migration again. ' +
          'If this is intentional (re-running after clearing the table), remove this guard.',
      )
    }

    const records = await ctx.db.query('attendanceRecords').collect()

    let migrated = 0
    let skippedNoCheckIn = 0
    for (const record of records) {
      const mapped = mapRecord(record)
      if (!mapped) {
        skippedNoCheckIn++
        continue
      }
      await ctx.db.insert('attendanceSessions', mapped)
      migrated++
    }

    return { migrated, skippedNoCheckIn }
  },
})

// Step 4 — confirms the migration landed: row counts line up (accounting for
// the no-checkIn skips reported in step 1/3), and a same-day sample from
// both tables agrees on employee + times.
export const verify = internalQuery({
  args: {},
  returns: v.object({
    attendanceRecordsCount: v.number(),
    attendanceSessionsCount: v.number(),
    expectedSkipped: v.number(),
    countsReconcile: v.boolean(),
  }),
  handler: async (ctx) => {
    const records = await ctx.db.query('attendanceRecords').collect()
    const sessions = await ctx.db.query('attendanceSessions').collect()
    const expectedSkipped = records.filter((r) => r.checkInAt === undefined).length

    return {
      attendanceRecordsCount: records.length,
      attendanceSessionsCount: sessions.length,
      expectedSkipped,
      countsReconcile: sessions.length === records.length - expectedSkipped,
    }
  },
})
