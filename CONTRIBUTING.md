# Contributing

## Setup

Node 22 and `npm ci`. Commands are in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Workflow

- Open an issue for a behavior change if you want a design check first. Small fixes can go straight to a pull request.
- Use the pull request template.
- Do not add a CLA. This project does not have one.
- Prefer a short commit subject that says what changed.

## Code

- Match the existing TypeScript style. `npm run format` uses Prettier.
- Do not commit `.env` or a Venice key.
- Do not widen the Venice proxy to an open proxy.
- Do not remove `AGENTS.md`, `startup.sh`, or the Grok PWA scripts to tidy the tree.
- UI changes need a check at desktop width and about 390 px wide.

## Dependencies

Minor and patch updates are grouped for Dependabot once the GitHub repository exists. Do not bump a major dependency inside an unrelated pull request.

## Security-sensitive changes

Say which trust boundary moved. If the change fixes an undisclosed vulnerability, follow [SECURITY.md](SECURITY.md) instead of a public issue.
