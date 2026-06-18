/**
 * Browser-safe entry point for @portlens/shared.
 * No Node.js built-ins — safe to bundle with Vite/Rollup for the browser.
 */
export type { TunnelStatus, TunnelMessage, FrameType, UserPlan, User, TunnelSession, } from "./types.js";
export { TunnelMessageSchema, safeParseTunnelMessage } from "./protocol.js";
export { isExpired, formatExpiry } from "./time.js";
//# sourceMappingURL=index.browser.d.ts.map