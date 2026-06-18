/**
 * protocol.ts — the canonical PortLens tunnel wire protocol.
 *
 * Every WebSocket frame exchanged between the CLI agent, the relay, and the
 * browser viewer is defined here as a `zod` schema. The runtime `TunnelMessage`
 * type is *derived* from these schemas (`z.infer`) so the validators and the
 * TypeScript types can never drift apart — there is a single source of truth.
 *
 * Use {@link safeParseTunnelMessage} on any untrusted input (a raw socket
 * payload) to get a fully-typed frame or `null`; never cast `JSON.parse`
 * output to `TunnelMessage` directly.
 */
import { z } from "zod";

/** HTTP-style header bag carried by `request` / `response` frames. */
const HeadersSchema = z.record(z.string());

// ── Control frames ────────────────────────────────────────────────────────────

/** Agent → Relay: opens a session and supplies auth / device context. */
export const RegisterFrame = z.object({
  type: z.literal("register"),
  token: z.string().min(1),
  userId: z.string().optional(),
  appName: z.string().optional(),
  appDesc: z.string().optional(),
  passwordHash: z.string().optional(),
  /** Signed JWT from ~/.portlens/auth.json — relay verifies and sets userId/expiresAt. */
  jwtToken: z.string().optional(),
  /** SHA-256 fingerprint of the physical device — enforces per-device free quota. */
  deviceFingerprint: z.string().optional(),
});

/**
 * Relay → Agent: sent once registration succeeds and the session's expiry has
 * been computed. Lets the agent display the real expiry and lets `--json`
 * consumers detect that the tunnel is fully live. Agents that predate this
 * frame simply ignore it.
 */
export const TunnelReadyFrame = z.object({
  type: z.literal("tunnel-ready"),
  token: z.string(),
  /** ISO timestamp, or null for non-expiring (Pro) sessions. */
  expiresAt: z.string().nullable(),
  plan: z.enum(["free", "pro"]),
});

/** Relay → Agent / Agent → Relay: protocol or quota error. */
export const ErrorFrame = z.object({
  type: z.literal("error"),
  code: z.string(),
  message: z.string(),
});

// ── Heartbeat frames (HEARTBEAT) ──────────────────────────────────────────────
// ping/pong form the bidirectional keepalive used to detect dead sockets and to
// measure round-trip time for the connection-quality indicator.

export const PingFrame = z.object({ type: z.literal("ping") });
export const PongFrame = z.object({ type: z.literal("pong") });

// ── HTTP proxy frames ─────────────────────────────────────────────────────────

/** Relay → Agent: an inbound HTTP request to replay against the local server. */
export const RequestFrame = z.object({
  type: z.literal("request"),
  requestId: z.string(),
  method: z.string(),
  path: z.string(),
  headers: HeadersSchema,
  /** base64-encoded request body, omitted when empty. */
  body: z.string().optional(),
});

/** Agent → Relay: the local server's response to a forwarded request. */
export const ResponseFrame = z.object({
  type: z.literal("response"),
  requestId: z.string(),
  statusCode: z.number().int(),
  headers: HeadersSchema,
  /** base64-encoded response body. */
  body: z.string(),
});

// ── WebSocket proxy frames ────────────────────────────────────────────────────

/** Relay → Agent: open a local WebSocket to this path. */
export const WsConnectFrame = z.object({
  type: z.literal("ws-connect"),
  wsId: z.string(),
  path: z.string(),
});

/** Bidirectional: a WebSocket frame payload (base64 for binary, raw for text). */
export const WsMessageFrame = z.object({
  type: z.literal("ws-message"),
  wsId: z.string(),
  data: z.string(),
  binary: z.boolean(),
});

/** Bidirectional: one side closed the WebSocket. */
export const WsCloseFrame = z.object({
  type: z.literal("ws-close"),
  wsId: z.string(),
  code: z.number().optional(),
  reason: z.string().optional(),
});

/** Agent → Relay: a local WebSocket failed to connect. */
export const WsErrorFrame = z.object({
  type: z.literal("ws-error"),
  wsId: z.string(),
  message: z.string(),
});

// ── Collaborative frames (foundational) ───────────────────────────────────────

/**
 * Viewer → Relay → Agent: feedback a viewer leaves on a shared session.
 *
 * Defined now so the protocol type surface is stable, but end-to-end routing
 * lands with the collaborative-features phase — the relay does not forward
 * these yet.
 */
export const ClientFeedbackFrame = z.object({
  type: z.literal("client-feedback"),
  /** The request this feedback refers to, when anchored to one. */
  requestId: z.string().optional(),
  rating: z.enum(["up", "down"]).optional(),
  comment: z.string().max(2_000).optional(),
  /** Viewer path the feedback was left on. */
  path: z.string().optional(),
});

// ── Union ─────────────────────────────────────────────────────────────────────

/** Every valid frame on the tunnel, keyed by its `type` discriminator. */
export const TunnelMessageSchema = z.discriminatedUnion("type", [
  RegisterFrame,
  TunnelReadyFrame,
  ErrorFrame,
  PingFrame,
  PongFrame,
  RequestFrame,
  ResponseFrame,
  WsConnectFrame,
  WsMessageFrame,
  WsCloseFrame,
  WsErrorFrame,
  ClientFeedbackFrame,
]);

/** A fully-validated tunnel frame. Derived from {@link TunnelMessageSchema}. */
export type TunnelMessage = z.infer<typeof TunnelMessageSchema>;

/** Literal union of every frame `type`. */
export type FrameType = TunnelMessage["type"];

/**
 * Validate an untrusted value (e.g. parsed socket JSON) against the protocol.
 * Returns the typed frame on success, or `null` for anything malformed.
 */
export function safeParseTunnelMessage(raw: unknown): TunnelMessage | null {
  const result = TunnelMessageSchema.safeParse(raw);
  return result.success ? result.data : null;
}
