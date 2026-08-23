import { v } from 'convex/values'
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from './_generated/server'
import { requireAdmin } from './auth'
import schema from './schema'

// Exported so convex/slackSync.ts normalizes emails identically before
// matching against by_email — one definition of "same email", not two.
export const normalizeEmail = (email: string) => email.trim().toLowerCase()

export const create = mutation({
  args: {
    fullName: v.string(),
    email: v.string(),
    department: v.optional(v.string()),
    designation: v.optional(v.string()),
  },
  returns: v.id('employees'),
  handler: async (ctx, args) => {
    await requireAdmin(ctx)
    const email = normalizeEmail(args.email)
    const existing = await ctx.db
      .query('employees')
      .withIndex('by_email', (q) => q.eq('email', email))
      .unique()

    if (existing) throw new Error(`Employee with email ${email} already exists`)

    return ctx.db.insert('employees', {
      ...args,
      fullName: args.fullName.trim(),
      email,
      employmentStatus: 'active',
    })
  },
})

export const list = query({
  args: {},
  returns: v.array(schema.doc('employees')),
  handler: async (ctx) => {
    await requireAdmin(ctx)
    return ctx.db.query('employees').order('asc').take(500)
  },
})

export const update = mutation({
  args: {
    id: v.id('employees'),
    fullName: v.optional(v.string()),
    department: v.optional(v.string()),
    designation: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { id, ...updates }) => {
    await requireAdmin(ctx)
    if (!(await ctx.db.get('employees', id))) throw new Error('Employee not found')
    await ctx.db.patch('employees', id, updates)
    return null
  },
})

export const deactivate = mutation({
  args: { id: v.id('employees') },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx)
    if (!(await ctx.db.get('employees', id))) throw new Error('Employee not found')
    await ctx.db.patch('employees', id, { employmentStatus: 'inactive' })
    return null
  },
})

export const getBySlackId = internalQuery({
  args: { slackUserId: v.string() },
  returns: v.union(schema.doc('employees'), v.null()),
  handler: (ctx, { slackUserId }) =>
    ctx.db
      .query('employees')
      .withIndex('by_slackUserId', (q) => q.eq('slackUserId', slackUserId))
      .unique(),
})

export const getByEmail = internalQuery({
  args: { email: v.string() },
  returns: v.union(schema.doc('employees'), v.null()),
  handler: (ctx, { email }) =>
    ctx.db
      .query('employees')
      .withIndex('by_email', (q) => q.eq('email', normalizeEmail(email)))
      .unique(),
})

export const updateSlackId = internalMutation({
  args: { id: v.id('employees'), slackUserId: v.string() },
  returns: v.null(),
  handler: async (ctx, { id, slackUserId }) => {
    await ctx.db.patch('employees', id, { slackUserId })
    return null
  },
})
