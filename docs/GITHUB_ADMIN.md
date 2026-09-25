# GitHub admin checklist

These settings are not applied by files in this workspace. Nothing below has been verified against a GitHub API response because this workspace has no git remote and no `gh` login.

Do not mark an item done until you see it in the repository settings.

## Repository

- [ ] Default branch is `main` (or change the workflow branch filters if it is not)
- [ ] Description matches the README, without marketing claims
- [ ] Homepage is set only if a real deployment URL exists
- [ ] Topics only for things the app does: `venice-ai`, `tts`, `speech-to-text`, `voice-ai`, `react`, `typescript`, `vite`, `ai-chat`
- [ ] Do not add `open-source` until a LICENSE file exists
- [ ] Issues enabled (the forms in `.github/ISSUE_TEMPLATE` depend on it)
- [ ] Discussions left off unless you intend to support them. SUPPORT.md does not point at Discussions
- [ ] Releases enabled

## Merge

- [ ] Automatically delete head branches
- [ ] Allow squash and rebase if you activate the ruleset as written (it requires linear history)
- [ ] Disable merge commits if linear history stays on

## Actions

- [ ] Default token permissions are read
- [ ] Fork pull requests do not receive secrets
- [ ] First-time contributor workflow approval is on if the repository is public
- [ ] Allowed actions policy matches your review bar. Official actions plus `ossf/scorecard-action` are the third-party uses in `.github/workflows`

## Security settings (GitHub UI or API)

- [ ] Dependency graph
- [ ] Dependabot alerts
- [ ] Dependabot security updates
- [ ] Secret scanning
- [ ] Push protection, if the plan allows it
- [ ] Private vulnerability reporting
- [ ] Code scanning shows the CodeQL workflow after it has run
- [ ] Scorecard: keep `publish_results: true` only for a public repository. A private repository without GitHub Advanced Security should set that input to `false` before the first run, or the job can fail

`dependabot.yml` does not turn those toggles on by itself.

## Rules

- [ ] After CI has run once, compare check names with `.github/rules.json`
- [ ] Then run `scripts/github/apply-ruleset.sh` and only then set enforcement to `active`

Suggested description, if you want one: "Venice voice and chat client. The key stays in the browser; requests are proxied to Venice."
