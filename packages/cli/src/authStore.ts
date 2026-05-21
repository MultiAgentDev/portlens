import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface AuthData {
  token: string;
  user: {
    id: string;
    email: string;
    plan: "free" | "pro";
    customSubdomain: string | null;
  };
}

const AUTH_DIR  = path.join(os.homedir(), ".portlens");
export const AUTH_FILE = path.join(AUTH_DIR, "auth.json");

export function readAuth(): AuthData | null {
  try {
    const raw = fs.readFileSync(AUTH_FILE, "utf8");
    return JSON.parse(raw) as AuthData;
  } catch {
    return null;
  }
}

export function writeAuth(data: AuthData): void {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  fs.writeFileSync(AUTH_FILE, JSON.stringify(data, null, 2) + "\n", "utf8");
  // Restrict to owner read/write only (chmod 600)
  try {
    fs.chmodSync(AUTH_FILE, 0o600);
  } catch {
    // chmod is a best-effort — Windows doesn't support POSIX mode bits
  }
}

export function deleteAuth(): void {
  try {
    fs.unlinkSync(AUTH_FILE);
  } catch {
    // Already gone — that's fine
  }
}
