# Release checklist

Unchecked items are unfinished. Do not tag a release while a blocking row is open.

## Identity

- [ ] Product name stays Ember unless the owner renames it
- [ ] Package name `ember-voice` accepted (`private: true`, not an npm publish)
- [ ] Real repository URL filled into docs that still say the URL is unknown
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
- [ ] Dependabot file is present, and alerts are enabled in settings
- [ ] Secret scanning reviewed in GitHub settings
- [ ] Push protection reviewed in GitHub settings
- [ ] Private vulnerability reporting enabled
- [x] No Venice key committed in this tree
- [ ] Branch ruleset applied and tested (file is `enforcement: disabled`)

## Documentation

- [x] README describes the current app
- [x] Installation, configuration, usage, architecture, security, privacy, and troubleshooting pages exist

## Legal

- [ ] License explicitly selected (not selected today)
- [ ] SPDX field matches that license
- [x] Direct dependency notices generated
- [x] Trademark note does not claim endorsement
- [x] Privacy text matches the proxy and local storage
- [ ] Code of conduct contact is a real address

## Release

- [ ] SemVer tag chosen
- [ ] Changelog has that version
- [ ] Tag points at the verified commit
- [ ] Release workflow succeeded
- [ ] Checksums and SBOM attached
