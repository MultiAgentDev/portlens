export type TunnelStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

// The tunnel wire protocol lives in protocol.ts as zod schemas; the
// TunnelMessage type is derived from them so types and validators stay in sync.
export type { TunnelMessage, FrameType } from "./protocol.js";

export type UserPlan = "free" | "pro";

export interface User {
  id: string;
  email: string;
  plan: UserPlan;
  customSubdomain?: string;
  createdAt: string;
  /** Unique code the user can share to earn bonus tunnel-time. */
  referralCode: string | null;
  /** Remaining bonus minutes earned through referrals (consumed 30 min/tunnel). */
  referralBonusMinutes: number;
}

export interface TunnelSession {
  token: string;
  userId?: string;
  appName: string;
  appDesc: string;
  expiresAt: string | null;
  viewCount: number;
  createdAt: string;
}
