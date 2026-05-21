#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Command } from "commander";
import ora from "ora";
import chalk from "chalk";
import open from "open";
import qrcode from "qrcode-terminal";
import { Agent } from "./agent.js";
import { readConfig, configFilePath } from "./config.js";
import { readAuth, writeAuth, deleteAuth } from "./authStore.js";
import { printBox, updateBox } from "./display.js";
const VIEWER_BASE = "https://viewer.portlens.net";
/** Convert a WebSocket URL to its HTTP equivalent for REST calls. */
function wsToHttp(url) {
    return url.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://");
}
const program = new Command();
program
    .name("portlens")
    .description("Share your local server with anyone, instantly.");
// ── portlens login ───────────────────────────────────────────────────────────
program
    .command("login")
    .description("Log in to PortLens with a magic link")
    .action(async () => {
    const cfg = readConfig();
    const base = wsToHttp(cfg.relay);
    const rl = createInterface({ input, output });
    try {
        const email = (await rl.question(chalk.cyan("  Email: "))).trim();
        if (!email) {
            console.error(chalk.red("  Email is required."));
            process.exit(1);
        }
        const reqSpinner = ora("Sending login code…").start();
        let res = await fetch(`${base}/auth/request`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email }),
        });
        reqSpinner.stop();
        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            console.error(chalk.red(`  Failed: ${body.error ?? res.statusText}`));
            process.exit(1);
        }
        console.log(chalk.dim("  Check your email for a 6-digit code."));
        const code = (await rl.question(chalk.cyan("  Code: "))).trim();
        if (!code) {
            console.error(chalk.red("  Code is required."));
            process.exit(1);
        }
        const verifySpinner = ora("Verifying…").start();
        res = await fetch(`${base}/auth/verify`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, code }),
        });
        verifySpinner.stop();
        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            console.error(chalk.red(`  ${body.error ?? "Invalid or expired code."}`));
            process.exit(1);
        }
        const data = await res.json();
        writeAuth({
            token: data.token,
            user: {
                id: data.user.id,
                email: data.user.email,
                plan: data.user.plan,
                customSubdomain: data.user.customSubdomain,
            },
        });
        console.log(chalk.green(`\n  ✓ Logged in as ${data.user.email} (${data.user.plan} plan)`));
    }
    finally {
        rl.close();
    }
});
// ── portlens logout ──────────────────────────────────────────────────────────
program
    .command("logout")
    .description("Log out and remove saved credentials")
    .action(() => {
    deleteAuth();
    console.log(chalk.dim("  Logged out."));
});
// ── portlens whoami ──────────────────────────────────────────────────────────
program
    .command("whoami")
    .description("Show the currently logged-in account")
    .action(() => {
    const auth = readAuth();
    if (!auth) {
        console.log(chalk.yellow("  Not logged in."));
        console.log(chalk.dim('  Run `portlens login` to authenticate.'));
        return;
    }
    console.log(`  ${chalk.white(auth.user.email)}  ${chalk.dim(`(${auth.user.plan} plan)`)}`);
});
// ── portlens referral ────────────────────────────────────────────────────────
program
    .command("referral")
    .description("Show your referral link and bonus-time stats")
    .action(async () => {
    const auth = readAuth();
    if (!auth) {
        console.error(chalk.red("  Not logged in. Run `portlens login` first."));
        process.exit(1);
    }
    const cfg = readConfig();
    const base = wsToHttp(cfg.relay);
    const spinner = ora("Loading referral info…").start();
    let data;
    try {
        const res = await fetch(`${base}/auth/me`, {
            headers: { "Authorization": `Bearer ${auth.token}` },
        });
        spinner.stop();
        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            console.error(chalk.red(`  ${body.error ?? "Failed to load referral info."}`));
            process.exit(1);
        }
        data = await res.json();
    }
    catch (err) {
        spinner.stop();
        console.error(chalk.red(`  Network error: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
    }
    const { referralCode, referralBonusMinutes, referralCount } = data.user;
    if (!referralCode) {
        console.log(chalk.yellow("  Referral code not yet generated — try again after your next login."));
        return;
    }
    const link = `https://portlens.net/?ref=${referralCode}`;
    const hours = Math.floor(referralBonusMinutes / 60);
    const mins = referralBonusMinutes % 60;
    const bonus = hours > 0 ? `${hours}h ${String(mins).padStart(2, "0")}m` : `${mins}m`;
    const people = referralCount === 1 ? "person" : "people";
    console.log();
    console.log(chalk.white.bold("  Your referral link:"));
    console.log(chalk.cyan(`  ${link}`));
    console.log();
    console.log(chalk.dim(`  You've referred ${chalk.white(String(referralCount))} ${people}.`));
    console.log(chalk.dim(`  Bonus time remaining: ${chalk.white(bonus)}.`));
    console.log();
    console.log(chalk.dim("  Each person who signs up via your link earns you both 30 extra minutes per tunnel."));
});
// ── portlens upgrade ─────────────────────────────────────────────────────────
program
    .command("upgrade")
    .description("Upgrade to PortLens Pro")
    .action(async () => {
    const auth = readAuth();
    if (!auth) {
        console.error(chalk.red("  Not logged in. Run `portlens login` first."));
        process.exit(1);
    }
    const cfg = readConfig();
    const base = wsToHttp(cfg.relay);
    const spinner = ora("Opening checkout…").start();
    let checkoutUrl;
    try {
        const res = await fetch(`${base}/billing/checkout`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${auth.token}`,
                "Content-Type": "application/json",
            },
        });
        if (!res.ok) {
            spinner.stop();
            const body = await res.json().catch(() => ({}));
            console.error(chalk.red(`  ${body.error ?? "Could not start checkout."}`));
            process.exit(1);
        }
        const data = await res.json();
        checkoutUrl = data.url;
    }
    catch (err) {
        spinner.stop();
        console.error(chalk.red(`  Network error: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
    }
    spinner.stop();
    console.log(chalk.dim("  Opening checkout in your browser…"));
    await open(checkoutUrl);
});
// ── portlens config ──────────────────────────────────────────────────────────
program
    .command("config")
    .description("Open ~/.portlens/config.json in your $EDITOR")
    .action(() => {
    const editor = process.env["EDITOR"] ?? "nano";
    const file = configFilePath();
    console.log(chalk.dim(`  Opening ${file} in ${editor}…`));
    const result = spawnSync(editor, [file], { stdio: "inherit" });
    if (result.error) {
        console.error(chalk.red(`  Could not open editor: ${result.error.message}`));
        process.exit(1);
    }
});
// ── portlens <port> ──────────────────────────────────────────────────────────
program
    .argument("<port>", "Local port to tunnel", (v) => {
    const n = parseInt(v, 10);
    if (isNaN(n) || n < 1 || n > 65535) {
        console.error(chalk.red(`  Invalid port: ${v}`));
        process.exit(1);
    }
    return n;
})
    .option("--name <string>", "App name shown in the viewer")
    .option("--desc <string>", "One-line description")
    .option("--password <string>", "Protect the share link with a password")
    .option("--relay <url>", "Override relay WebSocket URL")
    .option("--no-open", "Don't auto-open the viewer URL in the browser")
    .option("--no-screenshot", "Skip automatic screenshot capture")
    .option("--qr", "Print the share URL as a QR code")
    .action((port, opts) => {
    const cfg = readConfig();
    const auth = readAuth();
    const relay = opts.relay ?? cfg.relay;
    const name = opts.name ?? cfg.defaultName;
    const desc = opts.desc ?? cfg.defaultDesc;
    const jwtToken = auth?.token;
    if (auth) {
        console.log(chalk.dim(`  Tunneling as ${auth.user.email} (${auth.user.plan} plan)`));
    }
    const agent = new Agent(port, {
        name,
        desc,
        password: opts.password,
        relay,
        noOpen: opts.open === false,
        jwtToken,
        noScreenshot: opts.screenshot === false,
    });
    const spinner = ora(`Connecting to relay (port ${port})…`).start();
    let currentStatus = "connecting";
    let expiresAt = null;
    let currentRtt;
    let reconnectInfo;
    let boxVisible = false;
    let refreshTimer = null;
    let shareUrl = `${VIEWER_BASE}/${agent.token}`;
    /** Render a fresh box snapshot using the latest state variables. */
    function boxOpts() {
        return { shareUrl, localPort: port, expiresAt, status: currentStatus, rtt: currentRtt, reconnectInfo };
    }
    function startRefresh() {
        if (refreshTimer)
            return;
        // Refresh expiry countdown and RTT every 60 s.
        refreshTimer = setInterval(() => {
            if (boxVisible)
                updateBox(boxOpts());
        }, 60_000);
    }
    // ── First connect ────────────────────────────────────────────────────────
    agent.once("connected", () => {
        spinner.stop();
        currentStatus = "connected";
        reconnectInfo = undefined;
        boxVisible = true;
        printBox(boxOpts());
        startRefresh();
        if (opts.qr) {
            console.log();
            qrcode.generate(shareUrl, { small: true });
        }
        if (opts.open !== false) {
            open(shareUrl).catch(() => { });
        }
    });
    // ── Reconnect started ────────────────────────────────────────────────────
    // Agent emits (delayMs, attempt, maxAttempts) from ReconnectionManager.
    agent.on("reconnecting", (delayMs, attempt, maxAttempts) => {
        currentStatus = "reconnecting";
        currentRtt = undefined; // RTT is stale while disconnected
        reconnectInfo = { delayMs, attempt, maxAttempts };
        if (boxVisible)
            updateBox(boxOpts());
    });
    // ── Reconnected (subsequent connects after first) ────────────────────────
    agent.on("connected", () => {
        currentStatus = "connected";
        reconnectInfo = undefined;
        if (boxVisible)
            updateBox(boxOpts());
    });
    // ── RTT update (every ~30 s once the ping/pong cycle starts) ────────────
    agent.on("rtt", (ms) => {
        currentRtt = ms;
        if (boxVisible && currentStatus === "connected")
            updateBox(boxOpts());
    });
    process.on("SIGINT", () => {
        spinner.stop();
        if (refreshTimer)
            clearInterval(refreshTimer);
        agent.close();
        console.log(chalk.gray("\n  Tunnel closed."));
        process.exit(0);
    });
    agent.connect();
});
program.parse();
//# sourceMappingURL=index.js.map