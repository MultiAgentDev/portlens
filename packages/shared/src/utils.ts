import { createHash, randomBytes } from "node:crypto";

// Re-export browser-safe time helpers as part of the server-side utils surface
export { isExpired, formatExpiry } from "./time.js";

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Encode(buf: Buffer): string {
  let num = BigInt("0x" + buf.toString("hex"));
  const base = BigInt(58);
  const chars: string[] = [];
  while (num > 0n) {
    chars.unshift(BASE58_ALPHABET[Number(num % base)]);
    num /= base;
  }
  for (const byte of buf) {
    if (byte !== 0) break;
    chars.unshift(BASE58_ALPHABET[0]);
  }
  return chars.join("");
}

export function generateToken(length: number): string {
  const buf = randomBytes(Math.ceil(length * 0.75));
  return base58Encode(buf).slice(0, length);
}

export function hashPassword(password: string): string {
  return createHash("sha256").update(password).digest("hex");
}
