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
