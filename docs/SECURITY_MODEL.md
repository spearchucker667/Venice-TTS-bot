# Security model

This is a description of the current code, not a certification.

## API key

The key lives in `localStorage` or `sessionStorage`. Any script running on the page origin can read it. The proxy scrubs the key out of Venice error text it returns. It does not encrypt the key at rest. A shared or compromised browser profile is a compromised key.

## Proxy

The allowlist is the security boundary for server-side egress to Venice. It is not a general HTTP proxy. Bodies are capped (12 MB). Timeouts are 90 seconds. See [VENICE_API.md](VENICE_API.md).

## Tools

Model-chosen tool calls are not trusted instructions to the user. Search and scrape results are packed as untrusted JSON and the system prompt tells the model to ignore instructions inside them. That is a mitigation, not a proof against prompt injection.

The browser HTTP tool:

- allows GET, HEAD, POST, PUT, PATCH, DELETE
- blocks private, loopback, link-local, CGNAT, multicast, and several IPv6 forms, including mapped IPv4
- rejects userinfo and unusual ports
- does not follow redirects
- strips cookie and authorization headers the model tries to set
- asks every time for writes; reads can be remembered per host

## Microphone

Capture starts only after a user gesture (button or Space). Tracks are stopped when recording ends. Permission denied is surfaced and does not upload.

## Model output

Assistant text is rendered with a small markdown splitter (paragraphs, links, fenced code). It is not a full sanitizer for every HTML case because it does not use `innerHTML` for the message body. Links open in a new tab with `rel="noreferrer"`.

## Supply chain

Dependencies are locked. CI is intended to run lint, tests, and build without secrets. Dependabot and dependency review are configured in `.github/` but are not active until the repository exists on GitHub. Fork pull requests must not receive secrets; the workflows here do not declare any secrets.

## Known limits

- No DNS resolution check on the HTTP tool.
- The key is not in a hardware enclave.
- Voice changer media sits on Venice until complete is called.
- Platform auth code is still in the tree. It is off (`VITE_AUTH_ENABLED=false`) and is not the Ember login.
