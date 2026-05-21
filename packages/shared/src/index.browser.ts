/**
 * Browser-safe entry point for @portlens/shared.
 * No Node.js built-ins — safe to bundle with Vite/Rollup for the browser.
 */
export type {
  TunnelStatus,
  TunnelMessage,
  UserPlan,
  User,
  TunnelSession,
} from "./types.js";

export { isExpired, formatExpiry } from "./time.js";
