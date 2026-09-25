import assert from "node:assert/strict";
import test from "node:test";
import { veniceRouteAllowed } from "./venice-proxy.server.ts";

test("allows catalog, characters, chat, audio, and voice changer", () => {
  for (const [method, path, search] of [
    ["GET", "/models", "?type=text"],
    ["GET", "/models/traits", ""],
    ["GET", "/models/compatibility_mapping", ""],
    ["GET", "/characters", "?limit=20&search=ember"],
    ["GET", "/characters/ember-guide", ""],
    ["POST", "/chat/completions", ""],
    ["POST", "/audio/speech", ""],
    ["POST", "/audio/voice-changer/quote", ""],
    ["POST", "/audio/voice-changer/queue", ""],
    ["POST", "/audio/voice-changer/retrieve", ""],
    ["POST", "/audio/voice-changer/complete", ""],
  ] as const) {
    assert.equal(veniceRouteAllowed(method, path, search).ok, true, path);
  }
});

test("blocks key creation, open proxies, and unexpected queries", () => {
  assert.equal(veniceRouteAllowed("POST", "/api_keys", "").ok, false);
  assert.equal(veniceRouteAllowed("GET", "/billing/balance", "").ok, false);
  assert.equal(veniceRouteAllowed("POST", "/characters", "").ok, false);
  assert.equal(veniceRouteAllowed("GET", "/chat/completions", "?x=1").ok, false);
  assert.equal(veniceRouteAllowed("PUT", "/models", "").ok, false);
});
