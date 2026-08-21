import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const create = mutation({
  args: {
    fullName: v.string(),
    email: v.string(),
    department: v.optional(v.string()),
    designation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Enforce email uniqueness
    const existing = await ctx.db
      .query("employees")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();
      
    if (existing) {
      throw new Error(`Employee with email ${args.email} already exists.`);
    }

    return await ctx.db.insert("employees", {
      fullName: args.fullName,
      email: args.email,
      department: args.department,
      designation: args.designation,
      employmentStatus: "active",
    });
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("employees").collect();
  },
});

export const update = mutation({
  args: {
    id: v.id("employees"),
    fullName: v.optional(v.string()),
    department: v.optional(v.string()),
    designation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    await ctx.db.patch(id, updates);
  },
});

export const deactivate = mutation({
  args: { id: v.id("employees") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { employmentStatus: "inactive" });
  },
});

export const getBySlackId = query({
  args: { slackUserId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("employees")
      .withIndex("by_slackUserId", (q) => q.eq("slackUserId", args.slackUserId))
      .first();
  }
});

export const getByEmail = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("employees")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();
  }
});

export const updateSlackId = mutation({
  args: { id: v.id("employees"), slackUserId: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { slackUserId: args.slackUserId });
  }
});

