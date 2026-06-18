/**
 * packages/cli/src/deviceId.ts
 *
 * Generates a stable, opaque device fingerprint that:
 *   1. Tries to read a hardware-backed machine ID from the OS.
 *   2. Falls back to a UUID that is generated once and persisted in
 *      ~/.portlens/device.json so it survives CLI reinstalls.
 *
 * The raw value is SHA-256-hashed with a fixed salt so the relay never
 * sees the real machine ID — only a one-way derivation of it.
 *
 * The fingerprint is included in every `register` message.  The relay
 * uses it to enforce the 120-minute free-plan quota per physical device.
 */

import { execSync }                  from "node:child_process";
import { createHash, randomUUID }    from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join }                      from "node:path";
import { homedir, platform }         from "node:os";

const CONFIG_DIR    = join(homedir(), ".portlens");
const DEVICE_FILE   = join(CONFIG_DIR, "device.json");
/** Salt keeps our hash distinct from other SHA-256 uses of the same machine ID. */
const HASH_SALT     = "portlens-device-v1";

// ── OS-specific machine ID readers ────────────────────────────────────────────

function readMacOs(): string {
  const out = execSync(
    "ioreg -rd1 -c IOPlatformExpertDevice | awk '/IOPlatformUUID/{ print $3 }'",
    { encoding: "utf8", timeout: 3_000, stdio: ["pipe", "pipe", "pipe"] }
  );
  return out.trim().replace(/^"|"$/g, "");
}

function readLinux(): string {
  for (const p of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
    if (existsSync(p)) return readFileSync(p, "utf8").trim();
  }
  return "";
}

function readWindows(): string {
  const out = execSync(
    "wmic csproduct get uuid /value",
    { encoding: "utf8", timeout: 3_000, stdio: ["pipe", "pipe", "pipe"] }
  );
  return (out.match(/UUID=([A-F0-9-]+)/i)?.[1] ?? "").trim();
}

/**
 * Try to get a hardware-backed machine ID.
 * Returns an empty string on failure — callers fall back to a persisted UUID.
 */
function getMachineId(): string {
  try {
    const os = platform();
    if (os === "darwin") return readMacOs();
    if (os === "linux")  return readLinux();
    if (os === "win32")  return readWindows();
  } catch { /* fall through */ }
  return "";
}

// ── Persistent UUID fallback ───────────────────────────────────────────────────

function getOrCreateUUID(): string {
  try {
    if (existsSync(DEVICE_FILE)) {
      const data = JSON.parse(readFileSync(DEVICE_FILE, "utf8")) as { uuid?: string };
      if (data.uuid && typeof data.uuid === "string") return data.uuid;
    }
  } catch { /* regenerate below */ }

  const uuid = randomUUID();
  try {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(DEVICE_FILE, JSON.stringify({ uuid }, null, 2) + "\n", "utf8");
  } catch { /* best-effort — uuid still returned even if write fails */ }
  return uuid;
}

// ── Public API ─────────────────────────────────────────────────────────────────

let _cached: string | undefined;

/**
 * Returns a stable 64-char hex fingerprint for this device.
 * Cached after first call.
 */
export function getDeviceFingerprint(): string {
  if (_cached) return _cached;

  const machineId = getMachineId();
  const raw       = machineId.length > 8 ? machineId : getOrCreateUUID();

  _cached = createHash("sha256")
    .update(HASH_SALT)
    .update(raw)
    .digest("hex");

  return _cached;
}
