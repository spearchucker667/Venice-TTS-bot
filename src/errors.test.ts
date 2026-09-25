import assert from "node:assert/strict";
import test from "node:test";
import { classifyAppError } from "./errors.ts";

test("UI-009: classifyAppError categorizes errors into consistent actionable classes", () => {
  // Auth errors
  const auth1 = classifyAppError({ status: 401, message: "Unauthorized" });
  assert.equal(auth1.kind, "auth");
  assert.ok(auth1.actionHint.includes("Settings"));

  const auth2 = classifyAppError("Add a Venice API key to talk.");
  assert.equal(auth2.kind, "auth");

  // Rate limits
  const rateLimit = classifyAppError({ status: 429, message: "Too many requests" });
  assert.equal(rateLimit.kind, "rate_limit");
  assert.ok(rateLimit.actionHint.includes("Wait"));

  // Network timeouts
  const timeout = classifyAppError(new Error("Connection timed out"));
  assert.equal(timeout.kind, "network_timeout");
  assert.ok(timeout.recoverable);

  // Provider 5xx
  const serverError = classifyAppError({ status: 503, message: "Service Unavailable" });
  assert.equal(serverError.kind, "provider_unavailable");

  // User abort
  const abort = classifyAppError(new DOMException("The operation was aborted.", "AbortError"));
  assert.equal(abort.kind, "user_abort");

  // Charged queue unknown
  const queueUnknown = classifyAppError(
    "Queue submission outcome is unknown. Do not retry this take.",
  );
  assert.equal(queueUnknown.kind, "charged_queue_unknown");
  assert.equal(queueUnknown.recoverable, false);

  // Cleanup pending
  const cleanup = classifyAppError("Cleanup not confirmed by provider.");
  assert.equal(cleanup.kind, "cleanup_pending");
  assert.ok(cleanup.actionHint.includes("Retry cleanup"));

  // Stale catalog
  const staleCatalog = classifyAppError(
    "No text model yet. Refresh the Venice catalog in settings.",
  );
  assert.equal(staleCatalog.kind, "catalog_stale");

  // Invalid import
  const importErr = classifyAppError(new Error("That file is not an Ember chat export."));
  assert.equal(importErr.kind, "invalid_import");

  // Storage failure
  const storage = classifyAppError(new DOMException("QuotaExceededError"));
  assert.equal(storage.kind, "storage_failure");
  assert.ok(storage.actionHint.includes("Export"));
});
