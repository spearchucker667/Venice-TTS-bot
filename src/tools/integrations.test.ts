import assert from "node:assert/strict";
import test from "node:test";
import {
  clearSessionGrants,
  decideHttpPermission,
  directoryPrefix,
  grantSessionAccess,
  INTEGRATIONS_KEY,
  listSessionGrants,
  loadIntegrations,
  normalizeIntegration,
  normalizePathPrefix,
  pathPrefixMatches,
  purgeLegacyHosts,
  saveIntegrations,
  type HttpIntegration,
} from "./integrations.ts";

function int(partial: Partial<HttpIntegration> = {}): HttpIntegration {
  return {
    id: partial.id ?? "int_test",
    origin: partial.origin ?? "https://api.example.com",
    pathPrefix: partial.pathPrefix ?? "/v1",
    methods: partial.methods ?? ["GET", "HEAD"],
    maxBodyBytes: partial.maxBodyBytes ?? 16_000,
    createdAt: partial.createdAt ?? 1_000,
  };
}

function req(
  partial: Partial<{
    origin: string;
    path: string;
    method: string;
    mutating: boolean;
    bodyBytes: number;
  }> = {},
) {
  return {
    origin: partial.origin ?? "https://api.example.com",
    path: partial.path ?? "/v1/items",
    method: partial.method ?? "GET",
    mutating: partial.mutating ?? false,
    bodyBytes: partial.bodyBytes ?? 0,
  };
}

test("pathPrefixMatches enforces a path boundary", () => {
  assert.equal(pathPrefixMatches("", "/anything"), true);
  assert.equal(pathPrefixMatches("/v1", "/v1"), true);
  assert.equal(pathPrefixMatches("/v1", "/v1/items"), true);
  assert.equal(pathPrefixMatches("/v1", "/v1x/secret"), false);
  assert.equal(pathPrefixMatches("/v1", "/v2/items"), false);
  assert.equal(directoryPrefix("/v1/users/42"), "/v1/users");
  assert.equal(directoryPrefix("/v1"), "");
  assert.equal(directoryPrefix("/"), "");
});

test("normalizePathPrefix rejects non-clean paths", () => {
  assert.deepEqual(normalizePathPrefix(""), { prefix: "" });
  assert.deepEqual(normalizePathPrefix("/v1/"), { prefix: "/v1" });
  assert.ok("error" in normalizePathPrefix("v1"));
  assert.ok("error" in normalizePathPrefix("/a/../b"));
  assert.ok("error" in normalizePathPrefix("/a?x=1"));
  assert.ok("error" in normalizePathPrefix("/a\\b"));
  assert.ok("error" in normalizePathPrefix("//evil"));
});

test("normalizeIntegration requires https, valid prefix, and known methods", () => {
  assert.ok(
    "error" in normalizeIntegration({ origin: "http://api.example.com", methods: ["GET"] }),
  );
  assert.ok(
    "error" in normalizeIntegration({ origin: "https://user:pass@example.com", methods: ["GET"] }),
  );
  assert.ok("error" in normalizeIntegration({ origin: "https://127.0.0.1", methods: ["GET"] }));
  assert.ok(
    "error" in normalizeIntegration({ origin: "https://api.example.com:8080", methods: ["GET"] }),
  );
  assert.ok(
    "error" in
      normalizeIntegration({
        origin: "https://api.example.com",
        pathPrefix: "no-slash",
        methods: ["GET"],
      }),
  );
  assert.ok(
    "error" in normalizeIntegration({ origin: "https://api.example.com", methods: ["FETCH"] }),
  );
  assert.ok("error" in normalizeIntegration({ origin: "https://api.example.com", methods: [] }));
  assert.ok(
    "error" in
      normalizeIntegration({
        origin: "https://api.example.com",
        methods: ["GET"],
        maxBodyBytes: 5_000_000,
      }),
  );
  const ok = normalizeIntegration({
    origin: "HTTPS://API.EXAMPLE.COM:443",
    pathPrefix: "/base/",
    methods: ["get", "GET", "head"],
  });
  assert.ok("integration" in ok);
  assert.equal(ok.integration.origin, "https://api.example.com");
  assert.equal(ok.integration.pathPrefix, "/base");
  assert.deepEqual(ok.integration.methods, ["GET", "HEAD"]);
});

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

test("integration storage round-trips and drops invalid entries", () => {
  const storage = fakeStorage();
  const a = normalizeIntegration({ origin: "https://a.example.com", methods: ["GET"] });
  const b = normalizeIntegration({
    origin: "https://b.example.com",
    pathPrefix: "/v2",
    methods: ["POST"],
  });
  assert.ok("integration" in a && "integration" in b);
  saveIntegrations([a.integration, b.integration], storage);
  const loaded = loadIntegrations(storage);
  assert.equal(loaded.length, 2);
  assert.equal(loaded[0].origin, "https://a.example.com");
  storage.map.set(INTEGRATIONS_KEY, JSON.stringify([{ bogus: true }, a.integration]));
  assert.equal(loadIntegrations(storage).length, 1);
  storage.map.set(INTEGRATIONS_KEY, "not json");
  assert.deepEqual(loadIntegrations(storage), []);
  assert.deepEqual(loadIntegrations(null), []);
});

test("purgeLegacyHosts removes the remembered-host grant key", () => {
  const storage = fakeStorage();
  storage.setItem("ember.hosts.v1", JSON.stringify(["evil.example"]));
  purgeLegacyHosts(storage);
  assert.equal(storage.getItem("ember.hosts.v1"), null);
});

test("decideHttpPermission: origin mismatch and path-prefix escapes must ask", () => {
  const integrations = [int()];
  assert.deepEqual(
    decideHttpPermission(integrations, [], req({ origin: "https://other.example.com" })),
    { outcome: "confirm", reason: "uncovered" },
  );
  assert.deepEqual(decideHttpPermission(integrations, [], req({ path: "/v1x/secret" })), {
    outcome: "confirm",
    reason: "uncovered",
  });
  assert.deepEqual(decideHttpPermission(integrations, [], req({ path: "/v2/items" })), {
    outcome: "confirm",
    reason: "uncovered",
  });
});

test("decideHttpPermission: in-scope reads allow, methods outside the set deny", () => {
  const integrations = [int()];
  assert.deepEqual(decideHttpPermission(integrations, [], req()), { outcome: "allow" });
  assert.deepEqual(decideHttpPermission(integrations, [], req({ path: "/v1" })), {
    outcome: "allow",
  });
  const denied = decideHttpPermission(integrations, [], req({ method: "DELETE", mutating: true }));
  assert.equal(denied.outcome, "deny");
  if (denied.outcome === "deny") assert.match(denied.reason, /outside the integration scope/);
});

test("decideHttpPermission: writes always confirm, even inside an integration", () => {
  const integrations = [int({ methods: ["GET", "POST"] })];
  assert.deepEqual(
    decideHttpPermission(integrations, [], req({ method: "POST", mutating: true, bodyBytes: 10 })),
    {
      outcome: "confirm",
      reason: "write",
    },
  );
});

test("decideHttpPermission: request body over the integration bound denies", () => {
  const integrations = [int({ methods: ["POST"], maxBodyBytes: 100 })];
  const denied = decideHttpPermission(
    integrations,
    [],
    req({ method: "POST", mutating: true, bodyBytes: 101 }),
  );
  assert.equal(denied.outcome, "deny");
  assert.deepEqual(
    decideHttpPermission(integrations, [], req({ method: "POST", mutating: true, bodyBytes: 100 })),
    {
      outcome: "confirm",
      reason: "write",
    },
  );
});

test("session grants allow only matching, unexpired reads", () => {
  clearSessionGrants();
  const now = Date.now();
  const grant = grantSessionAccess(
    { origin: "https://session.example.com", pathPrefix: "/data", methods: ["GET"] },
    now,
  );
  assert.ok(grant.expiresAt > now);
  assert.deepEqual(
    decideHttpPermission(
      [],
      listSessionGrants(now),
      req({ origin: "https://session.example.com", path: "/data/1" }),
      now,
    ),
    { outcome: "allow" },
  );
  // Expired: decision must fall back to confirmation.
  const after = grant.expiresAt + 1;
  assert.deepEqual(
    decideHttpPermission(
      [],
      listSessionGrants(after),
      req({ origin: "https://session.example.com", path: "/data/1" }),
      after,
    ),
    { outcome: "confirm", reason: "uncovered" },
  );
  assert.equal(listSessionGrants(after).length, 0);
  // Path escape and method mismatch must not be covered by the grant.
  assert.deepEqual(
    decideHttpPermission(
      [],
      listSessionGrants(now),
      req({ origin: "https://session.example.com", path: "/datax/1" }),
      now,
    ),
    { outcome: "confirm", reason: "uncovered" },
  );
  assert.deepEqual(
    decideHttpPermission(
      [],
      listSessionGrants(now),
      req({ origin: "https://session.example.com", path: "/data/1", method: "HEAD" }),
      now,
    ),
    { outcome: "confirm", reason: "uncovered" },
  );
  // Writes are never auto-allowed by a session grant.
  assert.deepEqual(
    decideHttpPermission(
      [],
      listSessionGrants(now),
      req({
        origin: "https://session.example.com",
        path: "/data/1",
        method: "POST",
        mutating: true,
      }),
      now,
    ),
    { outcome: "confirm", reason: "uncovered" },
  );
  clearSessionGrants();
});
