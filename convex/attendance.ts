import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const recordEvent = mutation({
  args: {
    employeeId: v.optional(v.id("employees")),
    eventType: v.union(v.literal("CHECK_IN"), v.literal("CHECK_OUT")),
    source: v.union(v.literal("SLACK"), v.literal("ADMIN")),
    occurredAt: v.number(),
    rawSlackUserId: v.optional(v.string()),
    rawSlackEmail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await recordEventLogic(ctx, args);
  },
});

async function recordEventLogic(ctx: any, args: any) {
    // 1. Insert the raw event (append-only audit trail)
    const resolutionStatus = args.employeeId ? "RESOLVED" : "UNMATCHED";
    await ctx.db.insert("attendanceEvents", {
      employeeId: args.employeeId,
      eventType: args.eventType,
      source: args.source,
      occurredAt: args.occurredAt,
      resolutionStatus,
      rawSlackUserId: args.rawSlackUserId,
      rawSlackEmail: args.rawSlackEmail,
    });

    if (!args.employeeId) {
      // Unmatched event, nothing more to do for records
      return { success: false, status: "UNMATCHED" };
    }

    // 2. Update the derived attendanceRecords
    // Determine the date string (ISO date local time, or just UTC date). Let's use UTC date string for simplicity.
    const date = new Date(args.occurredAt).toISOString().split('T')[0];

    const existingRecord = await ctx.db
      .query("attendanceRecords")
      .withIndex("by_employee_date", (q: any) =>
        q.eq("employeeId", args.employeeId!).eq("date", date)
      )
      .first();

    if (args.eventType === "CHECK_IN") {
      if (existingRecord) {
        // Idempotency: if already checked in, maybe do nothing or update if admin.
        if (existingRecord.checkInAt && args.source !== "ADMIN") {
          return { success: true, status: "ALREADY_CHECKED_IN" };
        }
        await ctx.db.patch(existingRecord._id, {
          checkInAt: args.occurredAt,
          status: existingRecord.checkOutAt ? "COMPLETE" : "MISSING_CHECKOUT",
          correctedByAdmin: existingRecord.correctedByAdmin || args.source === "ADMIN",
        });
      } else {
        await ctx.db.insert("attendanceRecords", {
          employeeId: args.employeeId,
          date,
          checkInAt: args.occurredAt,
          status: "MISSING_CHECKOUT",
          correctedByAdmin: args.source === "ADMIN",
        });
      }
    } else if (args.eventType === "CHECK_OUT") {
      if (existingRecord) {
        // Idempotency
        if (existingRecord.checkOutAt && args.source !== "ADMIN") {
          return { success: true, status: "ALREADY_CHECKED_OUT" };
        }
        let workingHours = undefined;
        const checkInToUse = existingRecord.checkInAt;
        if (checkInToUse) {
          workingHours = (args.occurredAt - checkInToUse) / (1000 * 60 * 60);
        }
        await ctx.db.patch(existingRecord._id, {
          checkOutAt: args.occurredAt,
          workingHours,
          status: "COMPLETE",
          correctedByAdmin: existingRecord.correctedByAdmin || args.source === "ADMIN",
        });
      } else {
        // Checked out without checking in
        await ctx.db.insert("attendanceRecords", {
          employeeId: args.employeeId,
          date,
          checkOutAt: args.occurredAt,
          status: "COMPLETE", // or missing check in, but schema doesn't have it
          correctedByAdmin: args.source === "ADMIN",
        });
      }
    }

    return { success: true, status: "RESOLVED" };
}

export const listRecords = query({
  args: {
    employeeId: v.optional(v.id("employees")),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let records;
    if (args.employeeId) {
      records = await ctx.db
        .query("attendanceRecords")
        .withIndex("by_employee_date", (q: any) => q.eq("employeeId", args.employeeId!))
        .collect();
    } else {
      records = await ctx.db.query("attendanceRecords").collect();
    }
    
    if (args.startDate) {
      records = records.filter(r => r.date >= args.startDate!);
    }
    if (args.endDate) {
      records = records.filter(r => r.date <= args.endDate!);
    }
    if (args.status) {
      records = records.filter(r => r.status === args.status);
    }
    
    return records;
  },
});

export const correctRecord = mutation({
  args: {
    employeeId: v.id("employees"),
    eventType: v.union(v.literal("CHECK_IN"), v.literal("CHECK_OUT")),
    occurredAt: v.number(),
  },
  handler: async (ctx, args) => {
    return await recordEventLogic(ctx, {
      ...args,
      source: "ADMIN",
    });
  },
});

export const listUnmatched = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("attendanceEvents")
      .withIndex("by_resolution", (q) => q.eq("resolutionStatus", "UNMATCHED"))
      .collect();
  }
});

export const linkUnmatched = mutation({
  args: {
    eventId: v.id("attendanceEvents"),
    employeeId: v.id("employees"),
  },
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (!event || event.resolutionStatus !== "UNMATCHED") {
      throw new Error("Invalid or already resolved event");
    }
    
    await ctx.db.patch(args.eventId, {
      resolutionStatus: "RESOLVED",
      employeeId: args.employeeId,
    });
    
    // Also record the event to update attendanceRecords correctly
    await recordEventLogic(ctx, {
      employeeId: args.employeeId,
      eventType: event.eventType,
      source: "ADMIN",
      occurredAt: event.occurredAt,
    });
  }
});

