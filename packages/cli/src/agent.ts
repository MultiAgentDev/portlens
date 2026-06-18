import fs from "node:fs";
import http from "node:http";
import { EventEmitter } from "node:events";
import WebSocket from "ws";
import chalk from "chalk";
import { getDeviceFingerprint } from "./deviceId.js";
// ── Inlined from @portlens/shared (kept private / not on npm) ────────────────
import { createHash, randomBytes } from "node:crypto";

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58Encode(buf: Buffer): string {
  let num = BigInt("0x" + buf.toString("hex"));
  const chars: string[] = [];
  while (num > 0n) { chars.unshift(BASE58[Number(num % 58n)]!); num /= 58n; }
  for (const byte of buf) { if (byte !== 0) break; chars.unshift(BASE58[0]!); }
  return chars.join("");
}
function generateToken(length: number): string {
  return base58Encode(randomBytes(Math.ceil(length * 0.75))).slice(0, length);
}
function hashPassword(password: string): string {
  return createHash("sha256").update(password).digest("hex");
}

// ── TunnelMessage type (mirrors @portlens/shared protocol.ts) ─────────────────
// The CLI is bundled standalone and does not depend on @portlens/shared at
// runtime, so the wire protocol is mirrored here. Keep in sync with
// packages/shared/src/protocol.ts.
type TunnelMessage =
  | { type: "register"; token: string; userId?: string; appName?: string; appDesc?: string; passwordHash?: string; jwtToken?: string; deviceFingerprint?: string }
  | { type: "tunnel-ready"; token: string; expiresAt: string | null; plan: "free" | "pro" }
  | { type: "request"; requestId: string; method: string; path: string; headers: Record<string, string>; body?: string }
  | { type: "response"; requestId: string; statusCode: number; headers: Record<string, string>; body: string }
  | { type: "error"; code: string; message: string }
  | { type: "ping" }
  | { type: "pong" }
  | { type: "ws-connect"; wsId: string; path: string }
  | { type: "ws-message"; wsId: string; data: string; binary: boolean }
  | { type: "ws-close"; wsId: string; code?: number; reason?: string }
  | { type: "ws-error"; wsId: string; message: string };

// ── Timing constants ──────────────────────────────────────────────────────────

/** How often the agent sends its own health-check ping to the relay. */
const PING_INTERVAL_MS = 30_000;

// ── ReconnectionManager ───────────────────────────────────────────────────────

/**
 * Manages exponential-backoff reconnection with jitter.
 *
 * Usage:
 *   const mgr = new ReconnectionManager();
 *   await mgr.scheduleReconnect(() => openSocket(), onWaiting);
 */
export class ReconnectionManager {
  private attempts = 0;
  private readonly maxAttempts = 10;
  private readonly baseDelay   = 1_000;   // 1 s
  private readonly maxDelay    = 30_000;  // 30 s

  /**
   * Compute the next delay with full-jitter:
   *   base = min(baseDelay × 2^attempts, maxDelay)
   *   result = base + base × 0.2 × random()
   */
  getDelay(): number {
    const base   = Math.min(this.baseDelay * 2 ** this.attempts, this.maxDelay);
    const jitter = base * 0.2 * Math.random();
    return base + jitter;
  }

  /** Reset the attempt counter after a successful connection. */
  reset(): void {
    this.attempts = 0;
  }

  /** Returns true when the max retry budget has been exhausted. */
  shouldGiveUp(): boolean {
    return this.attempts >= this.maxAttempts;
  }

  /**
   * Wait for the computed back-off delay, then call `connectFn`.
   *
   * @param connectFn   Function that initiates a new WebSocket connection.
   * @param onWaiting   Optional callback fired just before sleeping.
   *                    Receives `(delayMs, attempt, maxAttempts)` so callers
   *                    can update the UI without coupling the manager to display code.
   */
  async scheduleReconnect(
    connectFn: () => void,
    onWaiting?: (delayMs: number, attempt: number, maxAttempts: number) => void
  ): Promise<void> {
    if (this.shouldGiveUp()) {
      console.error(
        chalk.red(
          "\n  Max reconnection attempts reached. " +
          "Run `portlens` again to retry."
        )
      );
      process.exit(1);
    }

    const delay = this.getDelay();
    onWaiting?.(delay, this.attempts, this.maxAttempts);

    await new Promise<void>((resolve) => setTimeout(resolve, delay));
    this.attempts++;
    connectFn();
  }
}

// ── AgentOptions ──────────────────────────────────────────────────────────────

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
  /**
   * Machine-readable mode: suppress all human-formatted stdout writes so the
   * caller (index.ts) owns the NDJSON event stream. Errors are surfaced as
   * "relay-error" events instead of being printed.
   */
  json?: boolean;
}

// ── Agent ─────────────────────────────────────────────────────────────────────

export class Agent extends EventEmitter {
  private ws: WebSocket | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private closing = false;
  private screenshotDone = false;

  /** Timestamp of the last agent-initiated ping; null when no ping is in-flight. */
  private pingTimestamp: number | null = null;

  /** Local WebSocket connections opened on behalf of proxied browser connections. */
  private readonly wsConnections = new Map<string, WebSocket>();

  private readonly reconnectionManager = new ReconnectionManager();

  readonly token: string;

  constructor(
    private readonly port: number,
    private readonly options: AgentOptions
  ) {
    super();
    this.token = generateToken(8);
  }

  connect(): void {
    if (this.closing) return;
    this._openSocket();
  }

  close(): void {
    this.closing = true;
    this._stopPing();
    for (const ws of this.wsConnections.values()) {
      try { ws.close(1001, "Tunnel closing"); } catch { /* ignore */ }
    }
    this.wsConnections.clear();
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
    }
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private _openSocket(): void {
    const { relay, name, desc, password, jwtToken } = this.options;
    const url = `${relay}/agent?token=${this.token}`;
    const ws  = new WebSocket(url);
    this.ws   = ws;

    ws.on("open", () => {
      // A successful open resets the back-off counter.
      this.reconnectionManager.reset();
      this.pingTimestamp = null;

      const msg: TunnelMessage = {
        type:              "register",
        token:             this.token,
        appName:           name,
        appDesc:           desc,
        deviceFingerprint: getDeviceFingerprint(),
        ...(password ? { passwordHash: hashPassword(password) } : {}),
        ...(jwtToken ? { jwtToken }                              : {}),
      };
      ws.send(JSON.stringify(msg));

      this._startPing(ws);

      /**
       * Emit "connected" — two listeners in index.ts:
       *  - once("connected")  → first-time box render
       *  - on("connected")    → subsequent reconnect box updates
       */
      this.emit("connected");

      // Take screenshot on first successful connect only (not on reconnects).
      if (!this.options.noScreenshot && !this.screenshotDone) {
        this.screenshotDone = true;
        this._captureScreenshot().catch(() => { /* warnings surfaced inside */ });
      }
    });

    ws.on("message", (data) => this._handleMessage(data));

    ws.on("close", () => {
      this._stopPing();
      if (!this.closing) {
        void this.reconnectionManager.scheduleReconnect(
          () => { if (!this.closing) this._openSocket(); },
          (delayMs, attempt, maxAttempts) => {
            this.emit("reconnecting", delayMs, attempt, maxAttempts);
          }
        );
      }
    });

    ws.on("error", (err) => {
      // "close" fires after "error" — let close handle reconnect.
      console.error(chalk.red(`\n  Error: ${err.message}`));
    });
  }

  private _startPing(ws: WebSocket): void {
    this._stopPing();
    this.pingTimer = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      // Record send-time so we can compute RTT when the pong arrives.
      this.pingTimestamp = Date.now();
      ws.send(JSON.stringify({ type: "ping" } satisfies TunnelMessage));
    }, PING_INTERVAL_MS);
  }

  private _stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer    = null;
      this.pingTimestamp = null;
    }
  }

  private _handleMessage(data: WebSocket.RawData): void {
    let msg: TunnelMessage;
    try {
      msg = JSON.parse(data.toString()) as TunnelMessage;
    } catch {
      return;
    }

    // Relay-initiated ping — reply immediately.
    if (msg.type === "ping") {
      this.ws?.send(JSON.stringify({ type: "pong" } satisfies TunnelMessage));
      return;
    }

    // Pong in response to our own ping — measure RTT and emit.
    if (msg.type === "pong") {
      if (this.pingTimestamp !== null) {
        const rtt = Date.now() - this.pingTimestamp;
        this.pingTimestamp = null;
        this.emit("rtt", rtt);
      }
      return;
    }

    // Relay confirmed registration — carries the real expiry and plan.
    if (msg.type === "tunnel-ready") {
      this.emit("ready", { expiresAt: msg.expiresAt, plan: msg.plan });
      return;
    }

    if (msg.type === "request") {
      this._forwardRequest(msg);
      return;
    }

    if (msg.type === "ws-connect") {
      this._openLocalWs(msg.wsId, msg.path);
      return;
    }

    if (msg.type === "ws-message") {
      const localWs = this.wsConnections.get(msg.wsId);
      if (localWs?.readyState === WebSocket.OPEN) {
        const payload = msg.binary ? Buffer.from(msg.data, "base64") : msg.data;
        localWs.send(payload);
      }
      return;
    }

    if (msg.type === "ws-close") {
      const localWs = this.wsConnections.get(msg.wsId);
      if (localWs) {
        try { localWs.close(msg.code ?? 1000, msg.reason ?? ""); } catch { /* ignore */ }
        this.wsConnections.delete(msg.wsId);
      }
      return;
    }

    if (msg.type === "error") {
      // Surface as an event so `--json` callers can render it; humans get the
      // chalk-formatted version unless suppressed by json mode.
      this.emit("relay-error", { code: msg.code, message: msg.message });

      if (msg.code === "DEVICE_QUOTA_EXCEEDED") {
        if (!this.options.json) {
          console.error(
            chalk.red("\n  ✖  Free plan limit reached for this device.\n") +
            chalk.yellow("     " + msg.message) +
            "\n"
          );
        }
        this.closing = true;
        process.exit(1);
      }

      if (!this.options.json) {
        console.error(chalk.red(`\n  Relay error [${msg.code}]: ${msg.message}`));
      }
      return;
    }
  }

  private _forwardRequest(
    msg: Extract<TunnelMessage, { type: "request" }>
  ): void {
    const { requestId, method, path, headers, body } = msg;
    const reqBody = body ? Buffer.from(body, "base64") : undefined;

    const options: http.RequestOptions = {
      hostname: "localhost",
      port:     this.port,
      method,
      path,
      headers: {
        ...headers,
        host: `localhost:${this.port}`,
        ...(reqBody ? { "content-length": String(reqBody.length) } : {}),
      },
    };

    const respond = (
      statusCode: number,
      respHeaders: Record<string, string>,
      respBody: Buffer
    ) => {
      const outMsg: TunnelMessage = {
        type:       "response",
        requestId,
        statusCode,
        headers:    respHeaders,
        body:       respBody.toString("base64"),
      };
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(outMsg));
      }
    };

    const req = http.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const respHeaders: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          if (typeof v === "string")   respHeaders[k] = v;
          else if (Array.isArray(v))   respHeaders[k] = v.join(", ");
        }
        respond(res.statusCode ?? 500, respHeaders, Buffer.concat(chunks));
      });
    });

    req.on("error", (err) => {
      console.error(chalk.red(`  Local request failed: ${err.message}`));
      respond(
        502,
        { "content-type": "application/json" },
        Buffer.from(
          JSON.stringify({ error: "Local server unreachable", detail: err.message })
        )
      );
    });

    if (reqBody) req.write(reqBody);
    req.end();
  }

  // ── Local WebSocket proxy ─────────────────────────────────────────────────

  private _openLocalWs(wsId: string, path: string): void {
    const url = `ws://localhost:${this.port}${path}`;
    let localWs: WebSocket;
    try {
      localWs = new WebSocket(url);
    } catch (err) {
      this.ws?.send(JSON.stringify({
        type: "ws-error",
        wsId,
        message: err instanceof Error ? err.message : String(err),
      }));
      return;
    }

    localWs.on("open", () => {
      this.wsConnections.set(wsId, localWs);
    });

    localWs.on("message", (data, isBinary) => {
      if (this.ws?.readyState !== WebSocket.OPEN) return;
      this.ws.send(JSON.stringify({
        type: "ws-message",
        wsId,
        data: isBinary
          ? Buffer.from(data as Buffer).toString("base64")
          : data.toString(),
        binary: isBinary,
      }));
    });

    localWs.on("close", (code, reason) => {
      this.wsConnections.delete(wsId);
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          type: "ws-close",
          wsId,
          code,
          reason: reason.toString(),
        }));
      }
    });

    localWs.on("error", (err) => {
      this.wsConnections.delete(wsId);
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          type: "ws-error",
          wsId,
          message: err.message,
        }));
      }
    });
  }

  // ── Screenshot capture ────────────────────────────────────────────────────

  /** Write a human-readable status line, unless we're in machine (--json) mode. */
  private _statusLog(line: string): void {
    if (!this.options.json) console.log(line);
  }

  /** Convert the relay WebSocket URL to its HTTP equivalent. */
  private _relayHttp(): string {
    return this.options.relay
      .replace(/^wss:\/\//, "https://")
      .replace(/^ws:\/\//, "http://");
  }

  /**
   * Try to locate a system Chrome / Chromium executable.
   * Returns the first path that exists on disk, or null.
   */
  private _findChrome(): string | null {
    const candidates = [
      // macOS
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      // Linux
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/snap/bin/chromium",
      // Windows
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    ];
    for (const p of candidates) {
      try {
        fs.accessSync(p, fs.constants.X_OK);
        return p;
      } catch {
        // not found / not executable — try next
      }
    }
    return null;
  }

  /**
   * Wait 2 s after connect, take a WebP screenshot of localhost:{port},
   * and POST the base64 image to the relay for storage.
   * All errors are caught and logged as warnings — never aborts the tunnel.
   */
  private async _captureScreenshot(): Promise<void> {
    await new Promise<void>((r) => setTimeout(r, 2_000));
    if (this.closing) return;

    const executablePath =
      process.env["PUPPETEER_EXECUTABLE_PATH"] ?? this._findChrome() ?? undefined;

    if (!executablePath) {
      this._statusLog(
        chalk.dim(
          "  Screenshot skipped — no Chrome found. " +
          "Set PUPPETEER_EXECUTABLE_PATH to enable."
        )
      );
      return;
    }

    let puppeteer: typeof import("puppeteer-core") | undefined;
    try {
      puppeteer = await import("puppeteer-core");
    } catch {
      this._statusLog(chalk.dim("  Screenshot skipped — puppeteer-core not available."));
      return;
    }

    let browser: import("puppeteer-core").Browser | null = null;
    try {
      browser = await puppeteer.launch({
        executablePath,
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
        ],
      });

      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });

      await page.goto(`http://localhost:${this.port}`, {
        waitUntil: "load",
        timeout:   15_000,
      });

      const shot       = await page.screenshot({ type: "webp", quality: 80 });
      const imageBase64 = Buffer.from(shot).toString("base64");

      const res = await fetch(
        `${this._relayHttp()}/session/${this.token}/screenshot`,
        {
          method:  "POST",
          headers: { "content-type": "application/json" },
          body:    JSON.stringify({ imageBase64 }),
        }
      );

      if (res.ok) {
        this._statusLog(chalk.dim("  Screenshot captured."));
      } else {
        this._statusLog(chalk.dim(`  Screenshot upload failed (HTTP ${res.status}).`));
      }
    } catch (err) {
      this._statusLog(
        chalk.yellow(
          `  Screenshot warning: ${err instanceof Error ? err.message : String(err)}`
        )
      );
    } finally {
      await browser?.close();
    }
  }
}
