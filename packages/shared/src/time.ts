/**
 * Browser-safe time utilities — no Node.js builtins.
 */

export function isExpired(isoDate: string | null): boolean {
  if (isoDate === null) return false;
  return new Date(isoDate).getTime() < Date.now();
}

export function formatExpiry(isoDate: string | null): string {
  if (isoDate === null) return "No expiry";
  const ms = new Date(isoDate).getTime() - Date.now();
  if (ms <= 0) return "Expired";
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);
  return `${parts.join(" ")} remaining`;
}
