import fs from "node:fs";
import http from "node:http";
import { EventEmitter } from "node:events";
import WebSocket from "ws";
import chalk from "chalk";
import { generateToken, hashPassword } from "@portlens/shared";
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
    attempts = 0;
    maxAttempts = 10;
    baseDelay = 1_000; // 1 s
    maxDelay = 30_000; // 30 s
    /**
     * Compute the next delay with full-jitter:
     *   base = min(baseDelay × 2^attempts, maxDelay)
     *   result = base + base × 0.2 × random()
     */
    getDelay() {
        const base = Math.min(this.baseDelay * 2 ** this.attempts, this.maxDelay);
        const jitter = base * 0.2 * Math.random();
        return base + jitter;
    }
    /** Reset the attempt counter after a successful connection. */
    reset() {
        this.attempts = 0;
    }
    /** Returns true when the max retry budget has been exhausted. */
    shouldGiveUp() {
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
    async scheduleReconnect(connectFn, onWaiting) {
        if (this.shouldGiveUp()) {
            console.error(chalk.red("\n  Max reconnection attempts reached. " +
                "Run `portlens` again to retry."));
            process.exit(1);
        }
        const delay = this.getDelay();
        onWaiting?.(delay, this.attempts, this.maxAttempts);
        await new Promise((resolve) => setTimeout(resolve, delay));
        this.attempts++;
        connectFn();
    }
}
// ── Agent ─────────────────────────────────────────────────────────────────────
export class Agent extends EventEmitter {
    port;
    options;
    ws = null;
    pingTimer = null;
    closing = false;
    screenshotDone = false;
    /** Timestamp of the last agent-initiated ping; null when no ping is in-flight. */
    pingTimestamp = null;
    reconnectionManager = new ReconnectionManager();
    token;
    constructor(port, options) {
        super();
        this.port = port;
        this.options = options;
        this.token = generateToken(8);
    }
    connect() {
        if (this.closing)
            return;
        this._openSocket();
    }
    close() {
        this.closing = true;
        this._stopPing();
        if (this.ws) {
            this.ws.removeAllListeners();
            this.ws.close();
        }
    }
    // ── Private ───────────────────────────────────────────────────────────────
    _openSocket() {
        const { relay, name, desc, password, jwtToken } = this.options;
        const url = `${relay}/agent?token=${this.token}`;
        const ws = new WebSocket(url);
        this.ws = ws;
        ws.on("open", () => {
            // A successful open resets the back-off counter.
            this.reconnectionManager.reset();
            this.pingTimestamp = null;
            const msg = {
                type: "register",
                token: this.token,
                appName: name,
                appDesc: desc,
                ...(password ? { passwordHash: hashPassword(password) } : {}),
                ...(jwtToken ? { jwtToken } : {}),
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
                this._captureScreenshot().catch(() => { });
            }
        });
        ws.on("message", (data) => this._handleMessage(data));
        ws.on("close", () => {
            this._stopPing();
            if (!this.closing) {
                void this.reconnectionManager.scheduleReconnect(() => { if (!this.closing)
                    this._openSocket(); }, (delayMs, attempt, maxAttempts) => {
                    this.emit("reconnecting", delayMs, attempt, maxAttempts);
                });
            }
        });
        ws.on("error", (err) => {
            // "close" fires after "error" — let close handle reconnect.
            console.error(chalk.red(`\n  Error: ${err.message}`));
        });
    }
    _startPing(ws) {
        this._stopPing();
        this.pingTimer = setInterval(() => {
            if (ws.readyState !== WebSocket.OPEN)
                return;
            // Record send-time so we can compute RTT when the pong arrives.
            this.pingTimestamp = Date.now();
            ws.send(JSON.stringify({ type: "ping" }));
        }, PING_INTERVAL_MS);
    }
    _stopPing() {
        if (this.pingTimer) {
            clearInterval(this.pingTimer);
            this.pingTimer = null;
            this.pingTimestamp = null;
        }
    }
    _handleMessage(data) {
        let msg;
        try {
            msg = JSON.parse(data.toString());
        }
        catch {
            return;
        }
        // Relay-initiated ping — reply immediately.
        if (msg.type === "ping") {
            this.ws?.send(JSON.stringify({ type: "pong" }));
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
        if (msg.type === "request") {
            this._forwardRequest(msg);
            return;
        }
        if (msg.type === "error") {
            console.error(chalk.red(`\n  Relay error [${msg.code}]: ${msg.message}`));
        }
    }
    _forwardRequest(msg) {
        const { requestId, method, path, headers, body } = msg;
        const reqBody = body ? Buffer.from(body, "base64") : undefined;
        const options = {
            hostname: "localhost",
            port: this.port,
            method,
            path,
            headers: {
                ...headers,
                host: `localhost:${this.port}`,
                ...(reqBody ? { "content-length": String(reqBody.length) } : {}),
            },
        };
        const respond = (statusCode, respHeaders, respBody) => {
            const outMsg = {
                type: "response",
                requestId,
                statusCode,
                headers: respHeaders,
                body: respBody.toString("base64"),
            };
            if (this.ws?.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify(outMsg));
            }
        };
        const req = http.request(options, (res) => {
            const chunks = [];
            res.on("data", (chunk) => chunks.push(chunk));
            res.on("end", () => {
                const respHeaders = {};
                for (const [k, v] of Object.entries(res.headers)) {
                    if (typeof v === "string")
                        respHeaders[k] = v;
                    else if (Array.isArray(v))
                        respHeaders[k] = v.join(", ");
                }
                respond(res.statusCode ?? 500, respHeaders, Buffer.concat(chunks));
            });
        });
        req.on("error", (err) => {
            console.error(chalk.red(`  Local request failed: ${err.message}`));
            respond(502, { "content-type": "application/json" }, Buffer.from(JSON.stringify({ error: "Local server unreachable", detail: err.message })));
        });
        if (reqBody)
            req.write(reqBody);
        req.end();
    }
    // ── Screenshot capture ────────────────────────────────────────────────────
    /** Convert the relay WebSocket URL to its HTTP equivalent. */
    _relayHttp() {
        return this.options.relay
            .replace(/^wss:\/\//, "https://")
            .replace(/^ws:\/\//, "http://");
    }
    /**
     * Try to locate a system Chrome / Chromium executable.
     * Returns the first path that exists on disk, or null.
     */
    _findChrome() {
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
            }
            catch {
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
    async _captureScreenshot() {
        await new Promise((r) => setTimeout(r, 2_000));
        if (this.closing)
            return;
        const executablePath = process.env["PUPPETEER_EXECUTABLE_PATH"] ?? this._findChrome() ?? undefined;
        if (!executablePath) {
            console.log(chalk.dim("  Screenshot skipped — no Chrome found. " +
                "Set PUPPETEER_EXECUTABLE_PATH to enable."));
            return;
        }
        let puppeteer;
        try {
            puppeteer = await import("puppeteer-core");
        }
        catch {
            console.log(chalk.dim("  Screenshot skipped — puppeteer-core not available."));
            return;
        }
        let browser = null;
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
                timeout: 15_000,
            });
            const shot = await page.screenshot({ type: "webp", quality: 80 });
            const imageBase64 = Buffer.from(shot).toString("base64");
            const res = await fetch(`${this._relayHttp()}/session/${this.token}/screenshot`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ imageBase64 }),
            });
            if (res.ok) {
                console.log(chalk.dim("  Screenshot captured."));
            }
            else {
                console.log(chalk.dim(`  Screenshot upload failed (HTTP ${res.status}).`));
            }
        }
        catch (err) {
            console.log(chalk.yellow(`  Screenshot warning: ${err instanceof Error ? err.message : String(err)}`));
        }
        finally {
            await browser?.close();
        }
    }
}
//# sourceMappingURL=agent.js.map