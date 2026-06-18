import chalk from "chalk";
import qrcode from "qrcode-terminal";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Strip ANSI escape codes to get the printable width of a string. */
function visibleLength(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

function padRight(s: string, width: number): string {
  const extra = width - visibleLength(s);
  return extra > 0 ? s + " ".repeat(extra) : s;
}

function formatExpiry(expiresAt: string | null): string {
  if (!expiresAt) return "No expiry";
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "Expired";
  const totalSec = Math.floor(ms / 1000);
  const hours    = Math.floor(totalSec / 3600);
  const mins     = Math.floor((totalSec % 3600) / 60);
  const secs     = totalSec % 60;
  if (hours > 0) return `${hours}h ${String(mins).padStart(2, "0")}m`;
  if (mins  > 0) return `${mins}m ${String(secs).padStart(2, "0")}s`;
  return `${secs}s`;
}

// ── Public types ──────────────────────────────────────────────────────────────

export type TunnelStatus = "connected" | "reconnecting" | "disconnected";

export interface ReconnectInfo {
  /** Milliseconds until the next attempt fires. */
  delayMs:     number;
  /** Zero-based attempt index (0 = first retry). */
  attempt:     number;
  maxAttempts: number;
}

export interface BoxOptions {
  shareUrl:  string;
  /** App name shown as the box title; falls back to a generic title. */
  appName?:  string;
  /** Local host traffic is forwarded to (default "localhost"). */
  localHost: string;
  localPort: number;
  expiresAt: string | null;
  status:    TunnelStatus;
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

// ── Status line ───────────────────────────────────────────────────────────────

function rttLabel(rtt: number): string {
  const text = `(${rtt}ms)`;
  if (rtt > 2_000) return chalk.red(text);
  if (rtt >   500) return chalk.yellow(text);
  return chalk.greenBright(text);
}

function statusLine(opts: BoxOptions): string {
  switch (opts.status) {
    case "connected": {
      const base = chalk.greenBright("● Connected");
      return opts.rtt !== undefined
        ? `${base} ${rttLabel(opts.rtt)}`
        : base;
    }

    case "reconnecting": {
      if (opts.reconnectInfo) {
        const { delayMs, attempt, maxAttempts } = opts.reconnectInfo;
        const secs = Math.floor(delayMs / 1000) || "<1";
        return chalk.yellow(
          `◌ Reconnecting... (in ${secs}s, ${attempt + 1}/${maxAttempts})`
        );
      }
      return chalk.yellow("◌ Reconnecting...");
    }

    case "disconnected":
      return chalk.red("○ Disconnected");
  }
}

// ── Box renderer ──────────────────────────────────────────────────────────────

const LABEL_COL  = 9;   // length of "Share URL"
const LEFT_PAD   = 2;
const RIGHT_PAD  = 2;

interface Row { label: string; value: string }

function buildRows(opts: BoxOptions): Row[] {
  return [
    { label: "Share URL", value: opts.shareUrl },
    { label: "Local",     value: `http://${opts.localHost}:${opts.localPort}` },
    { label: "Expires",   value: formatExpiry(opts.expiresAt) },
    { label: "Status",    value: statusLine(opts) },
  ];
}

/** Render the info box and return it as a string (ends with \n). */
export function renderBox(opts: BoxOptions): string {
  const rows = buildRows(opts);

  const titleText = opts.appName?.trim()
    ? `PortLens · ${opts.appName.trim()}`
    : "PortLens tunnel active";
  const title    = chalk.white.bold(titleText);
  const rowLines = rows.map(({ label, value }) => {
    const lbl = chalk.dim(label.padEnd(LABEL_COL));
    const val =
      label === "Share URL"
        ? chalk.greenBright.bold(value)
        : label === "Status"
        ? value             // already coloured by statusLine()
        : chalk.white(value);
    return `${lbl}  ${val}`;
  });

  const allLines    = [title, "", ...rowLines];
  const contentWidth = Math.max(...allLines.map(visibleLength));
  const innerWidth   = LEFT_PAD + contentWidth + RIGHT_PAD;

  const border = chalk.green;
  const h      = "─".repeat(innerWidth);

  const out: string[] = [];
  out.push(border(`╭${h}╮`));
  for (const line of allLines) {
    out.push(
      `${border("│")}${" ".repeat(LEFT_PAD)}${padRight(line, contentWidth)}${" ".repeat(RIGHT_PAD)}${border("│")}`
    );
  }
  out.push(border(`╰${h}╯`));
  return out.join("\n") + "\n";
}

/** Number of terminal lines the box occupies (used for cursor repositioning). */
export function boxLineCount(_opts: BoxOptions): number {
  // top border + title + blank + 4 rows + bottom border = 8
  return 8;
}

/** Print the box for the first time. */
export function printBox(opts: BoxOptions): void {
  process.stdout.write(renderBox(opts));
}

/**
 * Overwrite the previously printed box in-place.
 * Call this only when the box is the last thing printed to stdout
 * (no other writes since the previous printBox / updateBox).
 */
export function updateBox(opts: BoxOptions): void {
  const lines = boxLineCount(opts);
  process.stdout.write(`\x1b[${lines}A`);   // cursor up
  process.stdout.write(renderBox(opts));
}

// ── QR rendering ────────────────────────────────────────────────────────────

/**
 * Heuristically decide whether the terminal has a dark background.
 *
 * Many terminals export `COLORFGBG` as "fg;bg" (e.g. "15;0" = light-on-dark).
 * ANSI background codes 0–6 and 8 are dark; 7 and 9–15 are light. When the
 * variable is absent we assume dark, the common default for dev terminals.
 */
function terminalIsDark(): boolean {
  const cfb = process.env["COLORFGBG"];
  if (cfb) {
    const parts = cfb.split(";");
    const bg = Number.parseInt(parts[parts.length - 1] ?? "", 10);
    if (!Number.isNaN(bg)) return bg <= 6 || bg === 8;
  }
  return true;
}

// Swapping each half-block glyph for its photo-negative flips dark<->light
// modules, so the QR keeps proper contrast whichever way the terminal renders.
const QR_INVERT_MAP: Record<string, string> = {
  "█": " ",        // █ full  → blank
  " ":       "█",  // blank   → █ full
  "▀":  "▄",  // ▀ upper → ▄ lower
  "▄":  "▀",  // ▄ lower → ▀ upper
};

function invertQr(block: string): string {
  return block.replace(/[█▀▄ ]/g, (c) => QR_INVERT_MAP[c] ?? c);
}

/**
 * Print `text` as a scannable QR code with a quiet zone.
 *
 * QR codes must be dark-on-light to scan reliably. On a dark terminal the raw
 * block output is light-on-dark (inverted), so we flip it; on a light terminal
 * we leave it as-is. Pass `invert: true` (the `--qr-invert` flag) to override
 * the auto-detection when it guesses wrong.
 */
export function printQr(text: string, opts: { invert?: boolean } = {}): void {
  qrcode.generate(text, { small: true }, (qr: string) => {
    const autoInvert = terminalIsDark();
    const doInvert = opts.invert ? !autoInvert : autoInvert;
    const body = doInvert ? invertQr(qr) : qr;
    // Blank lines above/below act as a vertical quiet zone.
    process.stdout.write("\n" + body + "\n");
  });
}
