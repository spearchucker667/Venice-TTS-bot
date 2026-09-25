import assert from "node:assert/strict";
import test from "node:test";
import { blockedHostReason, inspectUrl, packUntrusted } from "./policy.ts";

const blocked = [
  "10.0.0.1",
  "10.255.255.255",
  "127.0.0.1",
  "127.0.0.2",
  "0.0.0.0",
  "169.254.169.254",
  "172.16.0.1",
  "172.31.255.255",
  "192.168.0.1",
  "192.168.1.20",
  "100.64.0.1",
  "100.127.255.254",
  "192.0.2.1",
  "198.51.100.4",
  "203.0.113.9",
  "224.0.0.1",
  "255.255.255.255",
  "localhost",
  "foo.localhost",
  "printer.local",
  "metadata.google.internal",
  "::1",
  "[::1]",
  "fe80::1",
  "[fe80::1]",
  "fc00::1",
  "fd12:3456::1",
  "[::ffff:a01:203]",
  "[::ffff:7f00:1]",
];

const allowed = [
  "1.1.1.1",
  "8.8.8.8",
  "172.15.0.1",
  "172.32.0.1",
  "100.63.1.1",
  "100.128.0.1",
  "example.com",
  "api.venice.ai",
];

test("blocks private, loopback, link-local, metadata, and reserved hosts", () => {
  for (const host of blocked) {
    assert.equal(blockedHostReason(host), "That address is blocked.", host);
  }
});

test("allows ordinary public hosts", () => {
  for (const host of allowed) assert.equal(blockedHostReason(host), null, host);
});

test("URL parser canonical forms and credentials are denied", () => {
  for (const raw of [
    "http://2130706433/",
    "http://0x7f000001/",
    "http://0177.0.0.1/",
    "http://127.1/",
    "http://10.1.2.3/",
    "http://192.168.1.1/admin",
    "http://[::ffff:10.1.2.3]/",
    "https://user:pass@example.com/secret",
    "http://example.com:8080/",
    "http://169.254.169.254/latest/meta-data",
  ]) {
    const result = inspectUrl(raw);
    assert.ok("error" in result, raw);
  }
  const ok = inspectUrl("https://example.com/v1");
  assert.ok("url" in ok);
  assert.equal(ok.url.hostname, "example.com");
});

test("packUntrusted stays valid JSON and marks truncation", () => {
  const small = packUntrusted("venice_web_search", { query: "hi", results: [{ title: "A" }] });
  const parsed = JSON.parse(small) as { untrusted: boolean; truncated: boolean };
  assert.equal(parsed.untrusted, true);
  assert.equal(parsed.truncated, false);
  const huge = packUntrusted("venice_scrape", { content: "x".repeat(20_000) }, 1200);
  const again = JSON.parse(huge) as { truncated: boolean; note: string };
  assert.equal(again.truncated, true);
  assert.match(again.note, /Untrusted data/);
});

function jsonDepth(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  const kids = Array.isArray(value) ? value : Object.values(value);
  return 1 + Math.max(0, ...kids.map(jsonDepth));
}

test("packUntrusted bounds deep nesting deterministically (HTTP-004)", () => {
  let deep: unknown = { leaf: "x".repeat(500) };
  for (let i = 0; i < 12; i += 1) deep = { nest: deep };
  const packed = packUntrusted("http_request", deep, 400);
  const parsed = JSON.parse(packed) as { truncated: boolean; data: unknown };
  assert.equal(parsed.truncated, true);
  assert.ok(jsonDepth(parsed.data) <= 7, `depth budget violated: ${jsonDepth(parsed.data)}`);
  assert.doesNotThrow(() => JSON.stringify(parsed));
  const again = packUntrusted("http_request", deep, 400);
  assert.equal(again, packed, "budgets must be deterministic");
});

test("packUntrusted bounds object keys, array elements, and string chars", () => {
  const wide: Record<string, unknown> = {};
  for (let i = 0; i < 80; i += 1) wide[`key_${i}`] = "v".repeat(20);
  const packed = JSON.parse(packUntrusted("http_request", { wide }, 2000)) as {
    truncated: boolean;
    data: { wide: Record<string, unknown> };
  };
  assert.equal(packed.truncated, true);
  assert.ok(Object.keys(packed.data.wide).length <= 41, "40 keys plus the overflow marker");
  assert.equal(packed.data.wide["…"], "40 more keys");

  const list = Array.from({ length: 60 }, (_, i) => `item_${i}`);
  const packedList = JSON.parse(packUntrusted("http_request", { list }, 600)) as {
    truncated: boolean;
    data: { list: unknown[] };
  };
  assert.equal(packedList.truncated, true);
  assert.equal(packedList.data.list.length, 26);
  assert.match(String(packedList.data.list.at(-1)), /35 … more items/);

  const strings = { a: "y".repeat(5000), inner: { b: "z".repeat(5000) } };
  const packedStrings = JSON.parse(packUntrusted("http_request", strings, 4000)) as {
    truncated: boolean;
    data: { a: string; inner: { b: string } };
  };
  assert.equal(packedStrings.truncated, true);
  assert.ok(packedStrings.data.a.length <= 1000);
  assert.ok(packedStrings.data.inner.b.length <= 1000);
  // When even budgeted data cannot fit, the payload collapses to null rather than exceeding max.
  const collapsed = JSON.parse(packUntrusted("http_request", strings, 100)) as {
    truncated: boolean;
    data: null;
  };
  assert.equal(collapsed.truncated, true);
  assert.equal(collapsed.data, null);
});

test("packUntrusted keeps small payloads untouched regardless of shape", () => {
  const nested = { a: { b: { c: [1, 2, { d: "text" }] } } };
  const packed = JSON.parse(packUntrusted("http_request", nested)) as { truncated: boolean };
  assert.equal(packed.truncated, false);
});
