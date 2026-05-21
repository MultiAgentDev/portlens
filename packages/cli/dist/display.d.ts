export type TunnelStatus = "connected" | "reconnecting" | "disconnected";
export interface ReconnectInfo {
    /** Milliseconds until the next attempt fires. */
    delayMs: number;
    /** Zero-based attempt index (0 = first retry). */
    attempt: number;
    maxAttempts: number;
}
export interface BoxOptions {
    shareUrl: string;
    localPort: number;
    expiresAt: string | null;
    status: TunnelStatus;
    /**
     * Most-recently measured ping round-trip time in milliseconds.
     * Absent until the first ping/pong cycle completes (~30 s after connect).
     */
    rtt?: number;
    /**
     * Present while status === "reconnecting"; drives the countdown display
     * in the Status row without adding extra lines below the box.
     */
    reconnectInfo?: ReconnectInfo;
}
/** Render the info box and return it as a string (ends with \n). */
export declare function renderBox(opts: BoxOptions): string;
/** Number of terminal lines the box occupies (used for cursor repositioning). */
export declare function boxLineCount(_opts: BoxOptions): number;
/** Print the box for the first time. */
export declare function printBox(opts: BoxOptions): void;
/**
 * Overwrite the previously printed box in-place.
 * Call this only when the box is the last thing printed to stdout
 * (no other writes since the previous printBox / updateBox).
 */
export declare function updateBox(opts: BoxOptions): void;
//# sourceMappingURL=display.d.ts.map