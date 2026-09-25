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

- [ ] CodeQL has run on the GitHub repository
- [ ] Dependency review has run on a pull request
- [x] Dependabot file is present (`.github/dependabot.yml`)
- [ ] Secret scanning reviewed in GitHub settings
- [ ] Push protection reviewed in GitHub settings
- [ ] Private vulnerability reporting enabled in GitHub settings
- [x] No Venice key committed in this tree
- [ ] Branch ruleset applied and tested (file is `enforcement: disabled`)

## Documentation

- [x] README describes the current app
- [x] Installation, configuration, usage, architecture, security, privacy, and troubleshooting pages exist

## Legal

- [x] License explicitly selected (Apache-2.0)
- [x] SPDX field matches that license (`package.json`: `Apache-2.0`)
- [x] Direct dependency notices generated
- [x] Trademark note does not claim endorsement
- [x] Privacy text matches the proxy and local storage
- [x] Code of conduct contact is documented (@spearchucker667)

## Release

- [ ] SemVer tag chosen
- [ ] Changelog has that version
- [ ] Tag points at the verified commit
- [ ] Release workflow succeeded
- [ ] Checksums and SBOM attached
