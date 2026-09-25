# Release checklist

Unchecked items are unfinished. Do not tag a release while a blocking row is open.

## Identity

- [x] Product name stays Ember unless the owner renames it
- [x] Package name `ember-voice` accepted (`private: true`, not an npm publish)
- [x] Real repository URL filled into docs (`https://github.com/spearchucker667/Venice-TTS-bot`)
- [x] Hero and current app screenshots are in `docs/assets/`

## Quality

- [x] `npm run lint`
- [x] `npm run format:check`
- [x] `npm run typecheck`
- [x] `npm run check:auth`
- [x] `npm test`
- [x] `npm run build`

## Security

- [x] CodeQL has run on the GitHub repository and passed
- [x] Dependency review has run on pull requests and vulnerability alerts are enabled
- [x] Dependabot configuration is active (`.github/dependabot.yml`)
- [x] Secret scanning enabled in GitHub settings
- [x] Push protection reviewed in GitHub settings
- [x] Private vulnerability reporting enabled in GitHub settings
- [x] No Venice key committed in this tree
- [x] Branch ruleset active on `main` branch (`Protect main`)
- [x] All CodeQL & Scorecard security alerts reviewed and resolved

## Documentation

- [x] README describes the current app with dynamic badges and diagrams
- [x] Installation, configuration, usage, architecture, security, privacy, and troubleshooting pages exist
- [x] All internal markdown links validated

## Legal

- [x] License explicitly selected (Apache-2.0)
- [x] SPDX field matches that license (`package.json`: `Apache-2.0`)
- [x] Direct dependency notices generated (`THIRD_PARTY_NOTICES.md`)
- [x] Trademark note does not claim endorsement (`TRADEMARKS.md`)
- [x] Privacy text matches the proxy and local storage (`PRIVACY.md`, `docs/PRIVACY_MODEL.md`)
- [x] Code of conduct contact is documented (@spearchucker667)

## Release

- [ ] SemVer tag chosen (e.g. `v1.0.0`)
- [ ] Changelog has that version
- [ ] Tag points at the verified commit
- [ ] Release workflow succeeded
- [ ] Checksums and SBOM attached
