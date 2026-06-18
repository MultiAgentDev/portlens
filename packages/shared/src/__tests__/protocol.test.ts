import { test } from "node:test";
import assert from "node:assert/strict";
import {
  safeParseTunnelMessage,
  TunnelMessageSchema,
} from "../protocol.js";

test("accepts a valid register frame and strips it to the schema shape", () => {
  const msg = safeParseTunnelMessage({
    type: "register",
    token: "abc123",
    appName: "My App",
    deviceFingerprint: "f".repeat(64),
  });
  assert.ok(msg);
  assert.equal(msg.type, "register");
  if (msg.type === "register") {
    assert.equal(msg.token, "abc123");
    assert.equal(msg.appName, "My App");
  }
});

test("accepts heartbeat ping/pong frames", () => {
  assert.equal(safeParseTunnelMessage({ type: "ping" })?.type, "ping");
  assert.equal(safeParseTunnelMessage({ type: "pong" })?.type, "pong");
});

test("accepts a tunnel-ready frame with a nullable expiry", () => {
  const pro = safeParseTunnelMessage({
    type: "tunnel-ready",
    token: "t",
    expiresAt: null,
    plan: "pro",
  });
  assert.equal(pro?.type, "tunnel-ready");

  const free = safeParseTunnelMessage({
    type: "tunnel-ready",
    token: "t",
    expiresAt: new Date().toISOString(),
    plan: "free",
  });
  assert.equal(free?.type, "tunnel-ready");
});

test("rejects an unknown frame type", () => {
  assert.equal(safeParseTunnelMessage({ type: "totally-made-up" }), null);
});

test("rejects a register frame missing its token", () => {
  assert.equal(safeParseTunnelMessage({ type: "register" }), null);
});

test("rejects a register frame with an empty token", () => {
  assert.equal(safeParseTunnelMessage({ type: "register", token: "" }), null);
});

test("rejects a response frame with a non-numeric status code", () => {
  assert.equal(
    safeParseTunnelMessage({
      type: "response",
      requestId: "r",
      statusCode: "200",
      headers: {},
      body: "",
    }),
    null,
  );
});

test("rejects non-object input", () => {
  assert.equal(safeParseTunnelMessage(null), null);
  assert.equal(safeParseTunnelMessage("ping"), null);
  assert.equal(safeParseTunnelMessage(42), null);
});

test("plan enum on tunnel-ready is constrained", () => {
  assert.equal(
    safeParseTunnelMessage({
      type: "tunnel-ready",
      token: "t",
      expiresAt: null,
      plan: "enterprise",
    }),
    null,
  );
});

test("schema exposes every protocol frame type", () => {
  const types = new Set<string>(
    TunnelMessageSchema.options.map((o) => o.shape.type.value),
  );
  for (const expected of [
    "register",
    "tunnel-ready",
    "error",
    "ping",
    "pong",
    "request",
    "response",
    "ws-connect",
    "ws-message",
    "ws-close",
    "ws-error",
    "client-feedback",
  ]) {
    assert.ok(types.has(expected), `missing frame type: ${expected}`);
  }
});
