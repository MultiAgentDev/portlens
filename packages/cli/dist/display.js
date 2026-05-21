import chalk from "chalk";
// ── Helpers ───────────────────────────────────────────────────────────────────
/** Strip ANSI escape codes to get the printable width of a string. */
function visibleLength(s) {
    return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}
function padRight(s, width) {
    const extra = width - visibleLength(s);
    return extra > 0 ? s + " ".repeat(extra) : s;
}
function formatExpiry(expiresAt) {
    if (!expiresAt)
        return "No expiry";
    const ms = new Date(expiresAt).getTime() - Date.now();
    if (ms <= 0)
        return "Expired";
    const totalSec = Math.floor(ms / 1000);
    const hours = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    if (hours > 0)
        return `${hours}h ${String(mins).padStart(2, "0")}m`;
    if (mins > 0)
        return `${mins}m ${String(secs).padStart(2, "0")}s`;
    return `${secs}s`;
}
// ── Status line ───────────────────────────────────────────────────────────────
function rttLabel(rtt) {
    const text = `(${rtt}ms)`;
    if (rtt > 2_000)
        return chalk.red(text);
    if (rtt > 500)
        return chalk.yellow(text);
    return chalk.greenBright(text);
}
function statusLine(opts) {
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
                return chalk.yellow(`◌ Reconnecting... (in ${secs}s, ${attempt + 1}/${maxAttempts})`);
            }
            return chalk.yellow("◌ Reconnecting...");
        }
        case "disconnected":
            return chalk.red("○ Disconnected");
    }
}
// ── Box renderer ──────────────────────────────────────────────────────────────
const LABEL_COL = 9; // length of "Share URL"
const LEFT_PAD = 2;
const RIGHT_PAD = 2;
function buildRows(opts) {
    return [
        { label: "Share URL", value: opts.shareUrl },
        { label: "Local", value: `http://localhost:${opts.localPort}` },
        { label: "Expires", value: formatExpiry(opts.expiresAt) },
        { label: "Status", value: statusLine(opts) },
    ];
}
/** Render the info box and return it as a string (ends with \n). */
export function renderBox(opts) {
    const rows = buildRows(opts);
    const title = chalk.white.bold("PortLens tunnel active");
    const rowLines = rows.map(({ label, value }) => {
        const lbl = chalk.dim(label.padEnd(LABEL_COL));
        const val = label === "Share URL"
            ? chalk.greenBright.bold(value)
            : label === "Status"
                ? value // already coloured by statusLine()
                : chalk.white(value);
        return `${lbl}  ${val}`;
    });
    const allLines = [title, "", ...rowLines];
    const contentWidth = Math.max(...allLines.map(visibleLength));
    const innerWidth = LEFT_PAD + contentWidth + RIGHT_PAD;
    const border = chalk.green;
    const h = "─".repeat(innerWidth);
    const out = [];
    out.push(border(`╭${h}╮`));
    for (const line of allLines) {
        out.push(`${border("│")}${" ".repeat(LEFT_PAD)}${padRight(line, contentWidth)}${" ".repeat(RIGHT_PAD)}${border("│")}`);
    }
    out.push(border(`╰${h}╯`));
    return out.join("\n") + "\n";
}
/** Number of terminal lines the box occupies (used for cursor repositioning). */
export function boxLineCount(_opts) {
    // top border + title + blank + 4 rows + bottom border = 8
    return 8;
}
/** Print the box for the first time. */
export function printBox(opts) {
    process.stdout.write(renderBox(opts));
}
/**
 * Overwrite the previously printed box in-place.
 * Call this only when the box is the last thing printed to stdout
 * (no other writes since the previous printBox / updateBox).
 */
export function updateBox(opts) {
    const lines = boxLineCount(opts);
    process.stdout.write(`\x1b[${lines}A`); // cursor up
    process.stdout.write(renderBox(opts));
}
//# sourceMappingURL=display.js.map