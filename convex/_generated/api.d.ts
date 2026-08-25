/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as attendance from "../attendance.js";
import type * as attendanceStatus from "../attendanceStatus.js";
import type * as auth from "../auth.js";
import type * as constants from "../constants.js";
import type * as dashboard from "../dashboard.js";
import type * as employees from "../employees.js";
import type * as http from "../http.js";
import type * as migrateSessions from "../migrateSessions.js";
import type * as slack from "../slack.js";
import type * as slackSync from "../slackSync.js";
import type * as time from "../time.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  attendance: typeof attendance;
  attendanceStatus: typeof attendanceStatus;
  auth: typeof auth;
  constants: typeof constants;
  dashboard: typeof dashboard;
  employees: typeof employees;
  http: typeof http;
  migrateSessions: typeof migrateSessions;
  slack: typeof slack;
  slackSync: typeof slackSync;
  time: typeof time;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
};
