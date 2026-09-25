# Releasing

## Versioning

Use semantic versions as git tags: `vMAJOR.MINOR.PATCH`. There is no `1.0.0` until a license is chosen and the release checklist is actually checked off.

## Before a tag

On a clean commit:

```bash
npm ci
npm run lint
npm run format:check
npm run typecheck
npm run check:auth
npm test
npm run build
npm run release:check
```

Update [CHANGELOG.md](../CHANGELOG.md) under a dated version heading. Do not invent older versions.

## Tag

```bash
git tag v0.1.0
git push origin v0.1.0
```

`.github/workflows/release.yml` runs the same checks, writes an npm CycloneDX SBOM, writes `SHA256SUMS.txt` for the static build assets and the SBOM, attests those files, and creates a GitHub Release. It does not publish to npm. `package.json` stays `"private": true`.

## Rollback

A bad release is a new patch tag that reverts the change, not a moved tag. Do not force-push a tag that already has a release. The default-branch ruleset, once activated, also forbids force-pushes to the default branch.

## Not done automatically

The ruleset file is `enforcement: disabled` until real check names are confirmed. See [BRANCH_PROTECTION.md](BRANCH_PROTECTION.md).
