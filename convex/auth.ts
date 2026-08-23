import { createClient } from '@convex-dev/better-auth'
import { convex } from '@convex-dev/better-auth/plugins'
import { betterAuth } from 'better-auth/minimal'
import { ConvexError, v } from 'convex/values'
import { components } from './_generated/api'
import { internalMutation } from './_generated/server'
import authConfig from './auth.config'
import type { GenericCtx } from '@convex-dev/better-auth'
import type { DataModel } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'

const siteUrl = process.env.SITE_URL
if (!siteUrl) throw new Error('SITE_URL is not set')

export const authComponent = createClient<DataModel>(components.betterAuth)

const buildAuth = (ctx: GenericCtx<DataModel>, disableSignUp: boolean) =>
  betterAuth({
    baseURL: siteUrl,
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: true,
      disableSignUp,
      requireEmailVerification: false,
    },
    // Long-lived, low-overhead sessions — appropriate for a single-admin
    // internal tool, not a multi-tenant public app. Shapes verified against
    // the installed @better-auth/core types (init-options.d.mts), not
    // assumed from memory.
    session: {
      // 30 days instead of Better Auth's 7-day default.
      expiresIn: 60 * 60 * 24 * 30,
      // Session expiry only gets extended once per day of activity, not on
      // every request — matches Better Auth's own default (1 day), set
      // explicitly so it's a documented choice, not an inherited default.
      updateAge: 60 * 60 * 24,
      // The actual efficiency win: most requests validate off a signed
      // cookie instead of a DB round trip, only re-checking the real
      // session once maxAge elapses. Tradeoff written up in
      // docs/security.md.
      cookieCache: {
        enabled: true,
        maxAge: 60 * 5,
      },
    },
    plugins: [convex({ authConfig })],
  })

export const createAuth = (ctx: GenericCtx<DataModel>) => buildAuth(ctx, true)
const createSeedAuth = (ctx: GenericCtx<DataModel>) => buildAuth(ctx, false)

export async function requireAdmin(ctx: QueryCtx | MutationCtx) {
  const user = await authComponent.getAuthUser(ctx)
  if (!user) throw new ConvexError('Authentication required')
  return user
}

export const seedAdmin = internalMutation({
  args: {
    email: v.string(),
    password: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const { auth, headers } = await authComponent.getAuth(createSeedAuth, ctx)
    await auth.api.signUpEmail({
      body: {
        email: args.email,
        password: args.password,
        name: "Admin",
      },
      headers,
    })
    return 'Admin seeded successfully'
  },
})
