# Branch protection

`.github/rules.json` is a GitHub repository ruleset payload. It is **not applied**. `enforcement` is `disabled` so a later apply does not lock `main` before CI has been seen.

## Expected check contexts

These strings follow GitHub's `{workflow name} / {job name}` pattern for the workflows in this repo. They are **not** copied from a live check run. Confirm them with `gh pr checks` or the checks API after the first successful workflow run, then edit `required_status_checks` if the real names differ.

- `CI / Quality`
- `CI / Tests`
- `CI / Build`
- `Dependency Review / Review`

CodeQL (`CodeQL / Analyze`) and Scorecard are not required yet. Add them only after they appear as green checks.

## What the payload asks for

- No deletion of the default branch
- No force-push
- Linear history
- A pull request before merge
- Review threads resolved
- Zero required approving reviews (solo maintainer; a forced second approval would deadlock a one-person repo)
- Code-owner review off until CODEOWNERS names a real owner
- Squash or rebase only
- The four checks above, and the branch must be up to date

## Apply

```bash
scripts/github/apply-ruleset.sh --dry-run
scripts/github/apply-ruleset.sh
```

Requires `gh` auth and a GitHub repository. The script creates or updates the ruleset named `Protect default branch` and refuses to replace a stricter remote enforcement with a weaker one unless you pass `--allow-weaker`.

After the checks are confirmed, change `enforcement` to `active` and apply again.

## Solo vs team

The file is in solo mode (`required_approving_review_count` is 0). If a second maintainer exists, set the count to 1, turn on code-owner review, and name that owner in CODEOWNERS before enforcing.
