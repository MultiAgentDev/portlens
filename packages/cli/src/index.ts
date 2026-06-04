#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { Command } from "commander";
import ora from "ora";
import chalk from "chalk";
import open from "open";
import qrcode from "qrcode-terminal";
import { Agent } from "./agent.js";
import { readConfig, configFilePath } from "./config.js";
import { readAuth, writeAuth, deleteAuth } from "./authStore.js";
import { printBox, updateBox } from "./display.js";
import type { TunnelStatus, ReconnectInfo } from "./display.js";

// ── Privacy Policy consent ────────────────────────────────────────────────────

const CONFIG_DIR    = join(homedir(), ".portlens");
const CONSENT_FILE  = join(CONFIG_DIR, "consent.json");
/** Bump this version string whenever the privacy policy changes materially. */
const POLICY_VERSION = "1.0";
const POLICY_URL     = "https://portlens.net/privacy-policy.html";

interface ConsentRecord {
  accepted: boolean;
  version: string;
  acceptedAt: string;
}

function readConsent(): ConsentRecord | null {
  try {
    if (!existsSync(CONSENT_FILE)) return null;
    return JSON.parse(readFileSync(CONSENT_FILE, "utf8")) as ConsentRecord;
  } catch {
    return null;
  }
}

function saveConsent(): void {
  try {
    mkdirSync(CONFIG_DIR, { recursive: true });
    const record: ConsentRecord = {
      accepted: true,
      version: POLICY_VERSION,
      acceptedAt: new Date().toISOString(),
    };
    writeFileSync(CONSENT_FILE, JSON.stringify(record, null, 2) + "\n", "utf8");
  } catch { /* best-effort */ }
}

/**
 * Ensure the user has accepted the Privacy Policy before starting a tunnel.
 * Prompts once; acceptance is stored in ~/.portlens/consent.json.
 * Re-prompts if the stored policy version differs from the current one.
 */
async function ensurePrivacyConsent(): Promise<void> {
  const existing = readConsent();
  if (existing?.accepted && existing.version === POLICY_VERSION) return;

  const isUpdate = existing?.accepted && existing.version !== POLICY_VERSION;

  console.log();
  if (isUpdate) {
    console.log(
      chalk.yellow("  ℹ  The PortLens Privacy Policy has been updated (v" + POLICY_VERSION + ").")
    );
  } else {
    console.log(
      chalk.bold("  PortLens Privacy Policy")
    );
  }
  console.log(
    chalk.dim(`  Before creating a tunnel, please review the Privacy Policy:\n`) +
    chalk.cyan(`  ${POLICY_URL}\n`)
  );
  console.log(
    chalk.dim("  By continuing you agree that PortLens may process your data as described,\n") +
    chalk.dim("  including the use of a device fingerprint for free-plan quota management.\n") +
    chalk.dim("  We comply with GDPR, ISO 27001 guidelines, and PCI DSS (via Stripe).\n")
  );

  const rl = createInterface({ input, output });
  let answer = "";
  try {
    answer = await rl.question(
      chalk.white("  Do you accept the Privacy Policy? ") + chalk.dim("[yes/no] ")
    );
  } finally {
    rl.close();
  }

  if (answer.trim().toLowerCase().startsWith("y")) {
    saveConsent();
    console.log(chalk.green("  ✔  Privacy Policy accepted. Thank you.\n"));
  } else {
    console.log(
      chalk.red("\n  Privacy Policy not accepted.\n") +
      chalk.dim(`  You can read the full policy at ${POLICY_URL}\n`) +
      chalk.dim("  To use PortLens you must accept the Privacy Policy.\n")
    );
    process.exit(0);
  }
}

const VIEWER_BASE = "https://viewer.portlens.net";

/** Convert a WebSocket URL to its HTTP equivalent for REST calls. */
function wsToHttp(url: string): string {
  return url.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://");
}

/**
 * Normalise a relay URL: auto-prepend wss:// if the protocol is missing,
 * then validate.  Exits with a clean message on failure.
 */
function normaliseRelay(raw: string): string {
  let url = raw.trim();
  if (url && !/^wss?:\/\//i.test(url)) {
    url = `wss://${url}`;
  }
  try {
    new URL(url);
  } catch {
    console.error(
      chalk.red(
        `  Invalid relay URL: "${raw}"\n` +
        `  Expected a WebSocket URL, e.g. wss://relay.portlens.net`
      )
    );
    process.exit(1);
  }
  return url;
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
    const cfg  = readConfig();
    const base = wsToHttp(cfg.relay);
    const rl   = createInterface({ input, output });

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
        const body = await res.json().catch(() => ({})) as { error?: string };
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
        const body = await res.json().catch(() => ({})) as { error?: string };
        console.error(chalk.red(`  ${body.error ?? "Invalid or expired code."}`));
        process.exit(1);
      }

      const data = await res.json() as {
        token: string;
        user: { id: string; email: string; plan: string; customSubdomain: string | null };
      };

      writeAuth({
        token: data.token,
        user: {
          id:              data.user.id,
          email:           data.user.email,
          plan:            data.user.plan as "free" | "pro",
          customSubdomain: data.user.customSubdomain,
        },
      });

      console.log(
        chalk.green(
          `\n  ✓ Logged in as ${data.user.email} (${data.user.plan} plan)`
        )
      );
    } finally {
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
    console.log(
      `  ${chalk.white(auth.user.email)}  ${chalk.dim(`(${auth.user.plan} plan)`)}`
    );
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

    const cfg  = readConfig();
    const base = wsToHttp(cfg.relay);

    const spinner = ora("Loading referral info…").start();
    let data: {
      user: {
        referralCode:         string | null;
        referralBonusMinutes: number;
        referralCount:        number;
      };
    };

    try {
      const res = await fetch(`${base}/auth/me`, {
        headers: { "Authorization": `Bearer ${auth.token}` },
      });
      spinner.stop();

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        console.error(chalk.red(`  ${body.error ?? "Failed to load referral info."}`));
        process.exit(1);
      }

      data = await res.json() as typeof data;
    } catch (err) {
      spinner.stop();
      console.error(
        chalk.red(`  Network error: ${err instanceof Error ? err.message : String(err)}`)
      );
      process.exit(1);
    }

    const { referralCode, referralBonusMinutes, referralCount } = data.user;

    if (!referralCode) {
      console.log(chalk.yellow("  Referral code not yet generated — try again after your next login."));
      return;
    }

    const link   = `https://portlens.net/?ref=${referralCode}`;
    const hours  = Math.floor(referralBonusMinutes / 60);
    const mins   = referralBonusMinutes % 60;
    const bonus  = hours > 0 ? `${hours}h ${String(mins).padStart(2, "0")}m` : `${mins}m`;
    const people = referralCount === 1 ? "person" : "people";

    console.log();
    console.log(chalk.white.bold("  Your referral link:"));
    console.log(chalk.cyan(`  ${link}`));
    console.log();
    console.log(chalk.dim(`  You've referred ${chalk.white(String(referralCount))} ${people}.`));
    console.log(chalk.dim(`  Bonus time remaining: ${chalk.white(bonus)}.`));
    console.log();
    console.log(
      chalk.dim("  Each person who signs up via your link earns you both 30 extra minutes per tunnel.")
    );
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

    const cfg  = readConfig();
    const base = wsToHttp(cfg.relay);

    const spinner = ora("Opening checkout…").start();
    let checkoutUrl: string;

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
        const body = await res.json().catch(() => ({})) as { error?: string };
        console.error(chalk.red(`  ${body.error ?? "Could not start checkout."}`));
        process.exit(1);
      }

      const data = await res.json() as { url: string };
      checkoutUrl = data.url;
    } catch (err) {
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
  .action(async (port: number, opts) => {
    // ── Privacy Policy gate ───────────────────────────────────────────────
    await ensurePrivacyConsent();

    const cfg  = readConfig();
    const auth = readAuth();

    // ── Relay URL normalisation & validation ──────────────────────────────
    // Accept bare hostnames/domains (e.g. "pankaj.portlens.net") by
    // auto-prepending wss://.  Reject anything that still doesn't parse.
    const relay    = normaliseRelay((opts.relay as string | undefined) ?? cfg.relay);
    const name     = (opts.name  as string | undefined) ?? cfg.defaultName;
    const desc     = (opts.desc  as string | undefined) ?? cfg.defaultDesc;
    const jwtToken = auth?.token;

    if (auth) {
      console.log(chalk.dim(`  Tunneling as ${auth.user.email} (${auth.user.plan} plan)`));
    }

    const agent = new Agent(port, {
      name,
      desc,
      password:     opts.password as string | undefined,
      relay,
      noOpen:       opts.open === false,
      jwtToken,
      noScreenshot: opts.screenshot === false,
    });

    const spinner = ora(`Connecting to relay (port ${port})…`).start();

    let currentStatus: TunnelStatus = "connecting" as TunnelStatus;
    let expiresAt: string | null = null;
    let currentRtt: number | undefined;
    let reconnectInfo: ReconnectInfo | undefined;
    let boxVisible    = false;
    let refreshTimer: NodeJS.Timeout | null = null;
    let shareUrl      = `${VIEWER_BASE}/v/${agent.token}`;

    /** Render a fresh box snapshot using the latest state variables. */
    function boxOpts() {
      return { shareUrl, localPort: port, expiresAt, status: currentStatus, rtt: currentRtt, reconnectInfo };
    }

    function startRefresh() {
      if (refreshTimer) return;
      // Refresh expiry countdown and RTT every 60 s.
      refreshTimer = setInterval(() => {
        if (boxVisible) updateBox(boxOpts());
      }, 60_000);
    }

    // ── First connect ────────────────────────────────────────────────────────
    agent.once("connected", () => {
      spinner.stop();
      currentStatus  = "connected";
      reconnectInfo  = undefined;
      boxVisible     = true;

      printBox(boxOpts());
      startRefresh();

      if (opts.qr as boolean | undefined) {
        console.log();
        qrcode.generate(shareUrl, { small: true });
      }

      if (opts.open !== false) {
        open(shareUrl).catch(() => { /* best-effort */ });
      }
    });

    // ── Reconnect started ────────────────────────────────────────────────────
    // Agent emits (delayMs, attempt, maxAttempts) from ReconnectionManager.
    agent.on("reconnecting", (delayMs: number, attempt: number, maxAttempts: number) => {
      currentStatus = "reconnecting";
      currentRtt    = undefined;  // RTT is stale while disconnected
      reconnectInfo = { delayMs, attempt, maxAttempts };
      if (boxVisible) updateBox(boxOpts());
    });

    // ── Reconnected (subsequent connects after first) ────────────────────────
    agent.on("connected", () => {
      currentStatus = "connected";
      reconnectInfo = undefined;
      if (boxVisible) updateBox(boxOpts());
    });

    // ── RTT update (every ~30 s once the ping/pong cycle starts) ────────────
    agent.on("rtt", (ms: number) => {
      currentRtt = ms;
      if (boxVisible && currentStatus === "connected") updateBox(boxOpts());
    });

    process.on("SIGINT", () => {
      spinner.stop();
      if (refreshTimer) clearInterval(refreshTimer);
      agent.close();
      console.log(chalk.gray("\n  Tunnel closed."));
      process.exit(0);
    });

    agent.connect();
  });

program.parse();
