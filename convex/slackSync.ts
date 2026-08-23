import { v } from 'convex/values'
import { action, internalMutation, internalQuery } from './_generated/server'
import { internal } from './_generated/api'
import { requireAdmin } from './auth'
import { normalizeEmail } from './employees'

// Admin-triggered Slack workspace sync. This only ever creates employees or
// fills in a missing slackUserId — it never touches employmentStatus,
// department, designation, or fullName on an existing record, and it never
// deactivates anyone. Someone leaving Slack isn't the same as someone
// leaving the company; that stays an Admin decision, not something a sync
// infers from an absent row.

const SLACKBOT_ID = 'USLACKBOT'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface SlackProfile {
  email?: string
  real_name?: string
  display_name?: string
}

interface SlackMember {
  id: string
  deleted?: boolean
  is_bot?: boolean
  is_app_user?: boolean
  profile?: SlackProfile
}

interface SlackUsersListResponse {
  ok: boolean
  error?: string
  members?: SlackMember[]
  response_metadata?: { next_cursor?: string }
}

// requireAdmin (convex/auth.ts) is typed for QueryCtx | MutationCtx — an
// action's ctx has no `db` and doesn't structurally match that. This tiny
// internal query exists only so the action can run through the *exact same*
// requireAdmin check everyone else uses, without widening that function's
// signature or touching auth.ts.
export const assertAdmin = internalQuery({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await requireAdmin(ctx)
    return null
  },
})

export const syncFromSlack = action({
  args: {},
  returns: v.object({
    created: v.number(),
    matched: v.number(),
    skipped: v.number(),
    skippedReasons: v.array(v.string()),
  }),
  // Explicit return type breaks a circular-inference error: this handler
  // calls internal.slackSync.applySync, defined further down in this same
  // file, so TS can't infer this function's return type from its body
  // without help (the generated `internal` type is itself derived from
  // this file's exports).
  handler: async (
    ctx,
  ): Promise<{
    created: number
    matched: number
    skipped: number
    skippedReasons: string[]
  }> => {
    await ctx.runQuery(internal.slackSync.assertAdmin, {})

    const token = process.env.SLACK_BOT_TOKEN
    if (!token) throw new Error('SLACK_BOT_TOKEN is not set')

    const candidates: {
      slackUserId: string
      email: string
      fullName: string
    }[] = []
    const skippedReasons: string[] = []
    let skipped = 0
    let cursor: string | undefined

    do {
      const url = new URL('https://slack.com/api/users.list')
      url.searchParams.set('limit', '200')
      if (cursor) url.searchParams.set('cursor', cursor)

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = (await res.json()) as SlackUsersListResponse
      if (!data.ok) {
        throw new Error(`Slack users.list failed: ${data.error ?? 'unknown error'}`)
      }

      for (const member of data.members ?? []) {
        if (member.id === SLACKBOT_ID) continue
        if (member.deleted) continue
        if (member.is_bot) continue
        if (member.is_app_user) continue

        const email = member.profile?.email
        const label =
          member.profile?.real_name || member.profile?.display_name || member.id

        if (!email || !EMAIL_RE.test(email)) {
          skipped++
          skippedReasons.push(
            `${label} (${member.id}): ${email ? 'invalid email' : 'no email on file'}`,
          )
          continue
        }

        candidates.push({
          slackUserId: member.id,
          email,
          fullName: member.profile?.real_name || member.profile?.display_name || email,
        })
      }

      cursor = data.response_metadata?.next_cursor || undefined
    } while (cursor)

    const { created, matched } = await ctx.runMutation(
      internal.slackSync.applySync,
      { candidates },
    )

    return { created, matched, skipped, skippedReasons }
  },
})

export const applySync = internalMutation({
  args: {
    candidates: v.array(
      v.object({
        slackUserId: v.string(),
        email: v.string(),
        fullName: v.string(),
      }),
    ),
  },
  returns: v.object({ created: v.number(), matched: v.number() }),
  handler: async (
    ctx,
    { candidates },
  ): Promise<{ created: number; matched: number }> => {
    let created = 0
    let matched = 0

    for (const candidate of candidates) {
      const email = normalizeEmail(candidate.email)
      const existing = await ctx.db
        .query('employees')
        .withIndex('by_email', (q) => q.eq('email', email))
        .unique()

      if (existing) {
        matched++
        // Admin-owned fields (fullName/department/designation/status) are
        // never touched here — only fill in slackUserId if it's missing.
        if (!existing.slackUserId) {
          await ctx.db.patch('employees', existing._id, {
            slackUserId: candidate.slackUserId,
          })
        }
        continue
      }

      await ctx.db.insert('employees', {
        fullName: candidate.fullName.trim(),
        email,
        slackUserId: candidate.slackUserId,
        employmentStatus: 'active',
      })
      created++
    }

    return { created, matched }
  },
})
