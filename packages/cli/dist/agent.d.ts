import { EventEmitter } from "node:events";
/**
 * Manages exponential-backoff reconnection with jitter.
 *
 * Usage:
 *   const mgr = new ReconnectionManager();
 *   await mgr.scheduleReconnect(() => openSocket(), onWaiting);
 */
export declare class ReconnectionManager {
    private attempts;
    private readonly maxAttempts;
    private readonly baseDelay;
    private readonly maxDelay;
    /**
     * Compute the next delay with full-jitter:
     *   base = min(baseDelay × 2^attempts, maxDelay)
     *   result = base + base × 0.2 × random()
     */
    getDelay(): number;
    /** Reset the attempt counter after a successful connection. */
    reset(): void;
    /** Returns true when the max retry budget has been exhausted. */
    shouldGiveUp(): boolean;
    /**
     * Wait for the computed back-off delay, then call `connectFn`.
     *
     * @param connectFn   Function that initiates a new WebSocket connection.
     * @param onWaiting   Optional callback fired just before sleeping.
     *                    Receives `(delayMs, attempt, maxAttempts)` so callers
     *                    can update the UI without coupling the manager to display code.
     */
    scheduleReconnect(connectFn: () => void, onWaiting?: (delayMs: number, attempt: number, maxAttempts: number) => void): Promise<void>;
}
export interface AgentOptions {
    name: string;
    desc: string;
    password?: string;
    relay: string;
    noOpen: boolean;
    /** JWT from ~/.portlens/config.json — forwarded to relay for userId resolution */
    jwtToken?: string;
    /** Skip automatic screenshot capture after connect */
    noScreenshot?: boolean;
}
export declare class Agent extends EventEmitter {
    private readonly port;
    private readonly options;
    private ws;
    private pingTimer;
    private closing;
    private screenshotDone;
    /** Timestamp of the last agent-initiated ping; null when no ping is in-flight. */
    private pingTimestamp;
    private readonly reconnectionManager;
    readonly token: string;
    constructor(port: number, options: AgentOptions);
    connect(): void;
    close(): void;
    private _openSocket;
    private _startPing;
    private _stopPing;
    private _handleMessage;
    private _forwardRequest;
    /** Convert the relay WebSocket URL to its HTTP equivalent. */
    private _relayHttp;
    /**
     * Try to locate a system Chrome / Chromium executable.
     * Returns the first path that exists on disk, or null.
     */
    private _findChrome;
    /**
     * Wait 2 s after connect, take a WebP screenshot of localhost:{port},
     * and POST the base64 image to the relay for storage.
     * All errors are caught and logged as warnings — never aborts the tunnel.
     */
    private _captureScreenshot;
}
//# sourceMappingURL=agent.d.ts.map