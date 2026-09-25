# Security policy

## Supported versions

There are no tagged releases yet. Security fixes apply to the current working tree until a version is published.

## Reporting a vulnerability

Do not open a public GitHub issue for an undisclosed vulnerability.

When this project has a GitHub repository, use that repository's private vulnerability reporting (Security advisories). That is the preferred path. This workspace has no repository URL and no security email, so none is listed here. Do not invent one in a fork.

Include:

- what you can do that you should not be able to do
- the file or request path involved
- impact (key theft, server-side request, cross-site scripting, and so on)
- whether you want credit

Do not include a live Venice key, cookies, or a private transcript. A redacted request shape is enough.

## Scope

In scope:

- the Venice proxy allowlist and header handling
- API key exposure in logs, storage, or error text
- the browser HTTP tool's network policy
- cross-site scripting in rendered chat
- microphone or audio lifetime bugs
- GitHub Actions permission mistakes in this repository

Out of scope:

- Venice's own service, account, or billing
- model output that is merely rude or wrong
- a missing license or trademark question (see [docs/LEGAL.md](docs/LEGAL.md))

## Disclosure

There is no promised response time. A maintainer, once named, should acknowledge a private report, fix or mitigate, and publish a note in the changelog when a release exists. Dependency vulnerabilities are handled through Dependabot alerts once those alerts are enabled on the GitHub repository. See [docs/GITHUB_ADMIN.md](docs/GITHUB_ADMIN.md).

## Coordinated disclosure

Please give the maintainer time to ship a fix before describing an exploit in public. If you get no answer because no maintainer is listed yet, that is a project gap, not permission to post the key material.
