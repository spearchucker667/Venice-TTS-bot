/**
 * Scoped HTTP integrations for the model-driven HTTP tool (SEC-001 / HTTP-002).
 *
 * Arbitrary model-driven HTTP is disabled by default. The model may only reach
 * an origin the user has explicitly scoped, either through a durable
 * integration (exact https origin + path prefix + method set + request-body
 * bound, stored locally) or a session-only grant that expires and is never
 * persisted. Writes always require per-request confirmation, even inside an
 * integration.
 *
 * Browser-only limitation: this code can classify literal IP addresses and
 * suspicious hostnames, but it cannot resolve DNS, pin the resolved address,
 * or re-verify it after approval. The user's scoped consent — not the address
 * check — is the security boundary.
 */

import { inspectUrl } from "./policy.ts";

export const INTEGRATIONS_KEY = "ember.integrations.v1";
export const SESSION_GRANT_TTL_MS = 30 * 60 * 1000;
export const DEFAULT_MAX_BODY_BYTES = 16_000;
export const MAX_BODY_BYTES_LIMIT = 1_000_000;

const ALL_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);

export type HttpIntegration = {
  id: string;
  /** Exact origin, e.g. "https://api.example.com" (https only, no port suffix). */
  origin: string;
  /** "" matches every path on the origin; otherwise a normalized absolute prefix. */
  pathPrefix: string;
  /** Methods the integration permits. Methods outside the set are denied outright. */
  methods: readonly string[];
  /** Request-body byte bound for requests under this integration. */
  maxBodyBytes: number;
  createdAt: number;
};

export type SessionGrant = {
  origin: string;
  pathPrefix: string;
  methods: readonly string[];
  expiresAt: number;
};

export type IntegrationInput = {
  origin: string;
  pathPrefix?: string;
  methods: readonly string[];
  maxBodyBytes?: number;
};

export type HttpPermissionRequest = {
  origin: string;
  /** URL pathname (no query string) used for prefix matching. */
  path: string;
  method: string;
  mutating: boolean;
  bodyBytes: number;
};

export type HttpPermissionDecision =
  | { outcome: "allow" }
  | { outcome: "confirm"; reason: "write" | "uncovered" }
  | { outcome: "deny"; reason: string };

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

let idCounter = 0;

function newId(now: number): string {
  idCounter += 1;
  return `int_${now.toString(36)}_${idCounter.toString(36)}`;
}

/** True when `path` is the prefix itself or lives underneath it ("/v1" matches "/v1/x", never "/v1x"). */
export function pathPrefixMatches(prefix: string, path: string): boolean {
  if (!prefix) return true;
  if (path === prefix) return true;
  return path.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`);
}

/** Directory scope of a request path: "/v1/users/42" -> "/v1/users", "/item" -> "" (whole origin). */
export function directoryPrefix(pathname: string): string {
  if (!pathname || pathname === "/") return "";
  const trimmed = pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  const idx = trimmed.lastIndexOf("/");
  return idx <= 0 ? "" : trimmed.slice(0, idx);
}

export function normalizePathPrefix(raw: string): { prefix: string } | { error: string } {
  const p = raw.trim();
  if (!p) return { prefix: "" };
  if (!p.startsWith("/")) return { error: "Path prefix must start with /." };
  if (p.includes("?") || p.includes("#"))
    return { error: "Path prefix cannot include a query or fragment." };
  if (p.includes("\\") || p.includes("//"))
    return { error: "Path prefix is not a clean URL path." };
  if (p.split("/").includes("..")) return { error: "Path prefix cannot contain .. segments." };
  return { prefix: p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p };
}

/** Validate and normalize user-supplied integration input. */
export function normalizeIntegration(
  input: IntegrationInput,
  now = Date.now(),
): { integration: HttpIntegration } | { error: string } {
  const rawOrigin = input.origin.trim();
  if (!/^https:\/\//i.test(rawOrigin)) {
    return { error: "Integrations must use an https:// origin." };
  }
  const checked = inspectUrl(rawOrigin);
  if ("error" in checked) return { error: checked.error };
  if (checked.url.protocol !== "https:") return { error: "Integrations must use HTTPS." };
  const prefix = normalizePathPrefix(input.pathPrefix ?? "");
  if ("error" in prefix) return { error: prefix.error };
  const methods: string[] = [];
  for (const raw of input.methods) {
    const method = String(raw).trim().toUpperCase();
    if (!ALL_METHODS.has(method))
      return { error: `Method ${method || String(raw)} is not allowed.` };
    if (!methods.includes(method)) methods.push(method);
  }
  if (!methods.length) return { error: "Choose at least one method." };
  let maxBodyBytes = input.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  if (!Number.isFinite(maxBodyBytes)) return { error: "Body bound must be a number." };
  maxBodyBytes = Math.floor(maxBodyBytes);
  if (maxBodyBytes < 0 || maxBodyBytes > MAX_BODY_BYTES_LIMIT) {
    return { error: `Body bound must be between 0 and ${MAX_BODY_BYTES_LIMIT} bytes.` };
  }
  return {
    integration: {
      id: newId(now),
      origin: checked.url.origin,
      pathPrefix: prefix.prefix,
      methods,
      maxBodyBytes,
      createdAt: now,
    },
  };
}

function isValidIntegration(value: unknown): value is HttpIntegration {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.origin !== "string") return false;
  if (!/^https:\/\/[^\s/]+$/i.test(o.origin)) return false;
  if (typeof o.pathPrefix !== "string") return false;
  if (!Array.isArray(o.methods) || !o.methods.length) return false;
  if (!o.methods.every((m) => typeof m === "string" && ALL_METHODS.has(m))) return false;
  if (
    typeof o.maxBodyBytes !== "number" ||
    o.maxBodyBytes < 0 ||
    o.maxBodyBytes > MAX_BODY_BYTES_LIMIT
  )
    return false;
  return true;
}

export function loadIntegrations(
  storage: StorageLike | null = defaultStorage(),
): HttpIntegration[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(INTEGRATIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidIntegration).slice(0, 40);
  } catch {
    return [];
  }
}

export function saveIntegrations(
  integrations: readonly HttpIntegration[],
  storage: StorageLike | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(INTEGRATIONS_KEY, JSON.stringify(integrations.slice(0, 40)));
  } catch {
    /* quota or denied storage */
  }
}

/** Drop the legacy remembered-host list; per-host read grants were wider than a real scope. */
export function purgeLegacyHosts(storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.removeItem("ember.hosts.v1");
  } catch {
    /* ignore */
  }
}

const sessionGrants = new Map<string, SessionGrant>();

function grantKey(origin: string, pathPrefix: string, method: string): string {
  return `${method} ${origin}${pathPrefix}`;
}

/** Record a session-only grant. Never persisted; expires after SESSION_GRANT_TTL_MS. */
export function grantSessionAccess(
  grant: Omit<SessionGrant, "expiresAt">,
  now = Date.now(),
): SessionGrant {
  const full: SessionGrant = { ...grant, expiresAt: now + SESSION_GRANT_TTL_MS };
  sessionGrants.set(grantKey(full.origin, full.pathPrefix, full.methods.join(",")), full);
  return full;
}

/** List live session grants, pruning expired ones. */
export function listSessionGrants(now = Date.now()): SessionGrant[] {
  const live: SessionGrant[] = [];
  for (const [key, grant] of sessionGrants) {
    if (grant.expiresAt <= now) sessionGrants.delete(key);
    else live.push(grant);
  }
  return live;
}

export function clearSessionGrants(): void {
  sessionGrants.clear();
}

/**
 * Decide what a model-driven HTTP request may do.
 *
 * - Exact integration match (origin + path prefix + method + body bound):
 *   reads are allowed; writes still require per-request confirmation.
 * - Method outside the matched integration's set, or body over its bound: denied.
 * - Reads covered by a live session grant: allowed.
 * - Everything else: the user must confirm (and may scope the grant).
 */
export function decideHttpPermission(
  integrations: readonly HttpIntegration[],
  sessionGrants: readonly SessionGrant[],
  req: HttpPermissionRequest,
  now = Date.now(),
): HttpPermissionDecision {
  const scoped = integrations.find(
    (i) => i.origin === req.origin && pathPrefixMatches(i.pathPrefix, req.path),
  );
  if (scoped) {
    if (!scoped.methods.includes(req.method)) {
      return {
        outcome: "deny",
        reason: `Method ${req.method} is outside the integration scope for ${req.origin}.`,
      };
    }
    if (req.bodyBytes > scoped.maxBodyBytes) {
      return {
        outcome: "deny",
        reason: `Request body exceeds the integration limit (${scoped.maxBodyBytes} bytes).`,
      };
    }
    if (req.mutating) return { outcome: "confirm", reason: "write" };
    return { outcome: "allow" };
  }
  if (!req.mutating) {
    const grant = sessionGrants.find(
      (g) =>
        g.origin === req.origin &&
        g.expiresAt > now &&
        g.methods.includes(req.method) &&
        pathPrefixMatches(g.pathPrefix, req.path),
    );
    if (grant) return { outcome: "allow" };
  }
  return { outcome: "confirm", reason: "uncovered" };
}
