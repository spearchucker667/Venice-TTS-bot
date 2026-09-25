# Security model

This is a description of the current code, not a certification.

## API key

The key lives in `localStorage` or `sessionStorage`. Any script running on the page origin can read it. The proxy scrubs the key out of Venice error text it returns. It does not encrypt the key at rest. A shared or compromised browser profile is a compromised key.

## Proxy

The allowlist is the security boundary for server-side egress to Venice. It is not a general HTTP proxy. Bodies are capped (12 MB). Timeouts are 90 seconds. See [VENICE_API.md](VENICE_API.md).

## Tools

Model-chosen tool calls are not trusted instructions to the user. Search and scrape results are packed as untrusted JSON and the system prompt tells the model to ignore instructions inside them. That is a mitigation, not a proof against prompt injection.

The browser HTTP tool:

- is off by default for arbitrary model-driven HTTP. The model can only reach an origin you scoped, either as a durable **integration** (exact `https://` origin, optional path prefix, allowed method set, request-body byte bound, stored under `ember.integrations.v1`) or as a **session-only grant** (expires after 30 minutes, never written to storage)
- lets reads inside a scope run without re-asking; **writes always require per-request confirmation**, even inside an integration, and are never covered by session grants
- denies methods outside an integration's method set outright instead of silently widening scope
- blocks literal private, loopback, link-local, CGNAT, multicast, and reserved IPv4/IPv6 addresses (including IPv4-mapped IPv6) and suspicious hostnames (`localhost`, `.local`, `.internal`, metadata names)
- rejects userinfo in URLs and ports other than 80/443
- does not follow redirects (a redirect target is re-checked against the same policy and then refused)
- strips cookie/authorization/api-key style headers the model tries to set; model-supplied headers are capped (12 headers, 200 chars each)
- caps the request body (16 KiB, or the integration's bound if lower) and reads responses as a stream with a hard 1 MiB raw-byte cap, then packs the result to the ~6 KiB model-visible untrusted JSON budget
- never persists model-generated headers or secrets; the old per-host "remembered reads" list (`ember.hosts.v1`) is removed on startup because a bare hostname grant was wider than a real integration scope

### DNS-resolution limitation

The HTTP tool classifies addresses **textually, before any connection**. Browser-only code cannot resolve DNS, pin the resolved IP, re-verify it after approval, or re-check redirect targets at the socket layer. A hostname that looks public can resolve to a private, loopback, or link-local address, or change its DNS answer after you approve it (rebinding). For that reason arbitrary model-driven HTTP is disabled unless you define an integration or approve a session grant — **your scoped consent, not the address check, is the security boundary**. Treat an integration like a credential: exact origin, tight path prefix, only the methods you intend.

## Microphone

Capture starts only after a user gesture (button or Space). Tracks are stopped when recording ends. Permission denied is surfaced and does not upload.

## Model output

Assistant text is rendered with a small markdown splitter (paragraphs, links, fenced code). It is not a full sanitizer for every HTML case because it does not use `innerHTML` for the message body. Links open in a new tab with `rel="noreferrer"`.

## Supply chain

Dependencies are locked. CI is intended to run lint, tests, and build without secrets. Dependabot and dependency review are configured in `.github/` but are not active until the repository exists on GitHub. Fork pull requests must not receive secrets; the workflows here do not declare any secrets.

## Known limits

- The HTTP tool cannot resolve DNS or pin the destination IP: see "DNS-resolution limitation" above. Private destinations are blocked only when they appear as literal addresses or known-bad hostnames — not categorically.
- The key is not in a hardware enclave.
- Voice changer media sits on Venice until complete is called.
- Platform auth code is still in the tree. It is off (`VITE_AUTH_ENABLED=false`) and is not the Ember login.
