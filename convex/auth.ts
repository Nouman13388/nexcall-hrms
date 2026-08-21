import { betterAuth } from 'better-auth/minimal' 
import { createClient } from '@convex-dev/better-auth' 
import { convex } from '@convex-dev/better-auth/plugins' 
import authConfig from './auth.config' 
import { components } from './_generated/api' 
import { query, mutation } from './_generated/server' 
import { v } from 'convex/values'
import type { GenericCtx } from '@convex-dev/better-auth' 
import type { DataModel } from './_generated/dataModel' 

const siteUrl = process.env.SITE_URL! 

export const authComponent = createClient<DataModel>(components.betterAuth) 

export const createAuth = (ctx: GenericCtx<DataModel>) => { 
  return betterAuth({ 
    baseURL: siteUrl, 
    database: authComponent.adapter(ctx), 
    emailAndPassword: { enabled: true, requireEmailVerification: false, }, 
    plugins: [ 
      convex({ authConfig }), 
    ], 
  }) 
} 

export const getCurrentUser = query({ 
  args: {}, 
  handler: async (ctx) => { return await authComponent.getAuthUser(ctx) }, 
})

export const seedAdmin = mutation({
  args: {
    email: v.string(),
    password: v.string(),
  },
  handler: async (ctx, args) => {
    const { auth, headers } = await authComponent.getAuth(createAuth, ctx);
    await auth.api.signUpEmail({
      body: {
        email: args.email,
        password: args.password,
        name: "Admin",
      },
      headers,
    });
    return "Admin seeded successfully";
  },
})
