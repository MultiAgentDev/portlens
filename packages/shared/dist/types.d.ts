export type TunnelStatus = "connecting" | "connected" | "reconnecting" | "disconnected";
export type TunnelMessage = {
    type: "register";
    token: string;
    userId?: string;
    appName?: string;
    appDesc?: string;
    passwordHash?: string;
    /** Signed JWT from ~/.portlens/auth.json — relay verifies and sets userId/expiresAt */
    jwtToken?: string;
} | {
    type: "request";
    requestId: string;
    method: string;
    path: string;
    headers: Record<string, string>;
    body?: string;
} | {
    type: "response";
    requestId: string;
    statusCode: number;
    headers: Record<string, string>;
    body: string;
} | {
    type: "ping";
} | {
    type: "pong";
} | {
    type: "error";
    code: string;
    message: string;
};
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
//# sourceMappingURL=types.d.ts.map