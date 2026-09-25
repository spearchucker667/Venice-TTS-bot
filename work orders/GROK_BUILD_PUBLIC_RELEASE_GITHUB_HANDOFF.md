# Agent Handoff — Professional GitHub/Public-Release Hardening for Ember / Grok Venice TTS

## Role

You are **Grok Build acting as a senior open-source release engineer, GitHub Actions/security engineer, technical writer, and repository maintainer**.

You are operating on the existing Ember / Venice TTS project. Do not scaffold a replacement application. Do not rewrite the application simply to make documentation easier. Your job is to turn the existing repository into a **professional, secure, maintainable, contributor-friendly public GitHub project** while preserving the application and Grok Build runtime contracts.

Treat this as a release-engineering task, not a cosmetic README task.

---

# 1. Primary objective

Bring the repository to a state where a reasonable external developer can:

1. understand what the project is;
2. understand what is actually implemented versus planned;
3. clone it and develop against it safely;
4. run deterministic validation;
5. submit an issue or pull request using structured templates;
6. understand the security and privacy model;
7. report vulnerabilities privately;
8. understand release/versioning policy;
9. identify maintainers/code owners;
10. inspect CI/security status from GitHub;
11. consume a tagged release with checksums/provenance where supported;
12. understand third-party service/trademark relationships;
13. apply a version-controlled GitHub repository ruleset for `main`;
14. view a polished README with a custom hero/banner derived from the real app;
15. verify that the repository contains no fake badges, invented claims, leaked secrets, or stale setup instructions.

The public repository must look deliberate, technically credible, and maintainable.

---

# 2. Repository facts already known

Before changing anything, verify these facts against the current workspace. They were true in the supplied project snapshot:

- The product branding in the current README is **Ember**.
- The app is a Venice-powered voice companion/TTS/chat application.
- The project is a React 19 / TypeScript / Vite / TanStack-based web application.
- `package-lock.json` is present, therefore CI should use **npm** and `npm ci`.
- The Grok Build environment contract targets **Node 22**.
- Existing package scripts include:
  - `npm run dev`
  - `npm run build`
  - `npm run db:migrate`
  - `npm run typecheck`
  - `npm run check:auth`
  - `npm test`
  - `npm run lint`
  - `npm run format`
- `README.md` is currently only a minimal stub.
- `package.json` currently uses the generic identity `app-builder-workspace`.
- `package.json` currently has `"private": true`.
- `AGENTS.md` is a platform contract and must be read before edits.
- The Grok Build/Vercel scaffold contains platform-sensitive files under `scripts/`, `server/`, `.grok/`, and Vite/Nitro configuration.
- The app currently contains an in-app Venice API-key workflow and legacy/local-prefill documentation that must be reconciled with the actual implementation.
- Previous audit work found failing PWA/OG integration tests. Do not enable an impossible branch protection configuration while required CI is red.

These are starting points only. Re-check the live repository and prefer current code over this handoff if the implementation has changed.

---

# 3. Mandatory first actions

Before creating files:

1. Read `AGENTS.md` completely.
2. Read `package.json`, `package-lock.json`, `vite.config.ts`, `vercel.json`, `.gitignore`, `.env.example`, and the current `README.md`.
3. Inspect all existing `.github/` files if the directory now exists.
4. Run:
   ```bash
   git status --short
   git branch --show-current
   git remote -v
   node --version
   npm --version
   ```
5. Derive the actual GitHub owner/repository name from `git remote get-url origin` when available.
6. Do **not** invent a repository URL, maintainer username, support address, security email, funding link, company name, legal entity, license, or affiliation.
7. Inspect the current screenshots and the live app before writing branding copy:
   - `screenshots/app-builder-built.png`
   - `screenshots/app-builder-built-mobile.png`
   - `screenshots/settings.png`
   - other current screenshots that are still representative.
8. Run the current quality baseline:
   ```bash
   npm ci
   npm run lint
   npm run typecheck
   npm run check:auth
   npm test
   npm run build
   ```
9. Record all failures before editing. Fix release-blocking failures that are directly related to repository readiness. Do not hide failures using `continue-on-error`, `|| true`, blanket ignores, reduced test scope, or disabled checks.
10. Check current GitHub documentation before finalizing workflow action versions or ruleset schema. GitHub Actions and ruleset APIs evolve; do not rely on stale examples.

---

# 4. Non-negotiable constraints

## 4.1 Preserve application/platform contracts

Do not delete or casually rewrite:

- `AGENTS.md`
- `/workspace/startup.sh` behavior
- `scripts/grok-pwa-*`
- `scripts/app-env-plugin.mjs`
- platform-owned `server/` behavior
- `public/__grok/` if present
- required Grok Build preview conventions
- Vercel/Nitro behavior required by the existing project

If a release-readiness change requires touching one of those files, explain why and validate the full platform contract afterward.

## 4.2 No fake quality signals

Never create:

- a fake “build passing” badge;
- a fake coverage percentage;
- a fake download count;
- a fake security certification;
- fake stars/forks;
- fake compatibility claims;
- fake supported browsers;
- fake model lists;
- fake API guarantees;
- fake screenshots;
- a fake roadmap completion state.

Badges must point to real workflows or real repository metadata.

## 4.3 No security theater

Do not:

- add a workflow that never runs;
- require a status check that is not emitted;
- pin a branch to a nonexistent workflow context;
- add `continue-on-error` to security jobs merely to stay green;
- give PR workflows write permissions they do not require;
- expose secrets to forked pull requests;
- use `pull_request_target` to check out and execute untrusted PR code;
- add long-lived deployment credentials if OIDC or existing platform integration suffices;
- store an API key in repository files;
- place secrets in README examples;
- commit `.env`;
- weaken existing app security controls merely to simplify CI.

## 4.4 Documentation must describe reality

README/privacy/security documentation must follow the code.

If the current app routes a Venice key through a server proxy, do not say “the key is sent only from your browser directly to Venice.”

If microphone audio is uploaded for STT, say so.

If chat history is stored locally, identify where and for how long based on the implementation.

If a feature is not shipped, list it under roadmap/planned work, not Features.

---

# 5. Required deliverable tree

Create or normalize the following structure as applicable:

```text
/
├── README.md
├── CHANGELOG.md
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── GOVERNANCE.md
├── SUPPORT.md
├── SECURITY.md                      # OR .github/SECURITY.md; choose one canonical location
├── LICENSE                          # only when license choice is already authorized
├── NOTICE                           # when appropriate to selected license/project
├── THIRD_PARTY_NOTICES.md
├── PRIVACY.md
├── TRADEMARKS.md
├── RELEASE_CHECKLIST.md
├── .github/
│   ├── CODEOWNERS
│   ├── rules.json
│   ├── dependabot.yml
│   ├── release.yml
│   ├── PULL_REQUEST_TEMPLATE.md
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug-report.yml
│   │   ├── feature-request.yml
│   │   ├── security-config.yml      # only if useful; do not duplicate SECURITY instructions badly
│   │   └── config.yml
│   ├── DISCUSSION_TEMPLATE/         # only if Discussions are enabled / appropriate
│   │   ├── ideas.yml
│   │   └── help.yml
│   └── workflows/
│       ├── ci.yml
│       ├── codeql.yml
│       ├── dependency-review.yml
│       ├── scorecard.yml
│       ├── docs.yml
│       └── release.yml
├── docs/
│   ├── README.md
│   ├── QUICKSTART.md
│   ├── INSTALLATION.md
│   ├── CONFIGURATION.md
│   ├── USAGE.md
│   ├── VOICE_MODES.md
│   ├── VENICE_API.md
│   ├── ARCHITECTURE.md
│   ├── SECURITY_MODEL.md
│   ├── PRIVACY_MODEL.md
│   ├── DEVELOPMENT.md
│   ├── TESTING.md
│   ├── TROUBLESHOOTING.md
│   ├── RELEASING.md
│   ├── GITHUB_ADMIN.md
│   ├── BRANCH_PROTECTION.md
│   ├── LEGAL.md
│   ├── ROADMAP.md
│   └── assets/
│       ├── ember-hero.png
│       ├── ember-hero.webp           # optional optimized copy
│       ├── ember-app.png
│       ├── ember-settings.png
│       └── architecture.svg
└── scripts/
    └── github/
        ├── apply-ruleset.sh
        └── verify-release-readiness.mjs
```

Adapt filenames when an equivalent canonical file already exists. Do not create duplicate competing policies.

---

# 6. CI workflow requirements

All workflows must be valid GitHub Actions YAML, use least privilege, and have stable human-readable workflow/job names.

Use top-level:

```yaml
permissions:
  contents: read
```

unless a workflow genuinely needs more.

Prefer official GitHub actions. For third-party actions:

- use reputable maintained actions only;
- pin to a full commit SHA when practical;
- add a comment indicating the corresponding release tag;
- configure Dependabot to update GitHub Actions;
- never use an unreviewed action simply to avoid writing a few shell commands.

Use concurrency to cancel stale PR runs where appropriate.

---

## 6.1 `.github/workflows/ci.yml`

Purpose: deterministic mandatory quality gate.

Triggers:

- pull requests targeting the default branch;
- pushes to the default branch;
- manual `workflow_dispatch`.

Use Node 22 and the repository lockfile.

Suggested jobs with deliberately stable display names:

### Job: `Quality`

Run:

```bash
npm ci
npm run lint
npm run typecheck
npm run check:auth
```

### Job: `Tests`

Run:

```bash
npm ci
npm test
```

### Job: `Build`

Run:

```bash
npm ci
npm run build
```

Requirements:

- no hidden environment secrets;
- build must succeed without `DATABASE_URL` if the app intentionally supports that path;
- if a production-only environment variable is required, document it and provide a safe test value only if the app supports one;
- cache npm using `actions/setup-node`'s npm cache support;
- do not cache `node_modules`;
- retain useful logs on failure if necessary;
- do not upload massive build output on every PR unless it has diagnostic value.

If `npm run format` mutates files, do not run it as a CI validation step. Add a non-mutating `format:check` script such as:

```json
"format:check": "prettier --check ."
```

and run that in `Quality`.

If needed, add the script rather than calling `prettier --write` in CI.

---

## 6.2 `.github/workflows/codeql.yml`

Purpose: code scanning for JavaScript/TypeScript.

Triggers:

- PRs targeting default branch;
- pushes to default branch;
- scheduled weekly scan;
- manual dispatch.

Use the currently supported CodeQL Action major version at implementation time.

Set only required permissions, typically:

```yaml
permissions:
  contents: read
  security-events: write
  packages: read
```

If the current GitHub configuration makes one permission unnecessary, remove it.

Analyze the JavaScript/TypeScript codebase. Do not pretend generated/platform files are first-party app logic if CodeQL configuration can exclude irrelevant generated output safely.

Add `.github/codeql-config.yml` only if it materially improves signal/noise. Never exclude application code simply to make alerts disappear.

---

## 6.3 `.github/workflows/dependency-review.yml`

Purpose: prevent new vulnerable or unacceptable dependencies from entering through pull requests.

Trigger only on pull requests.

Use the official dependency review action.

Default recommendation:

- fail on newly introduced vulnerabilities of `moderate` severity or higher;
- do not invent an arbitrary license denylist without checking the selected project license and maintainer policy;
- if license policy is not yet decided, enforce vulnerabilities first and document the pending license-policy decision.

The workflow's job/display name must remain stable so the repository ruleset can require it.

---

## 6.4 `.github/workflows/scorecard.yml`

Purpose: OpenSSF Scorecard security posture for a public project.

Requirements:

- use the official OpenSSF Scorecard action;
- least-privilege permissions;
- scheduled run plus default-branch push/manual run as appropriate;
- upload SARIF to GitHub code scanning when supported;
- publish results only if appropriate for the public repository;
- never expose secrets;
- pin the action safely.

If GitHub/plan limitations prevent a feature, keep the workflow valid for the actual public-repository plan rather than claiming it is active.

---

## 6.5 `.github/workflows/docs.yml`

Purpose: documentation quality.

At minimum validate:

- Markdown formatting/linting;
- broken local links;
- missing referenced images/files;
- README image paths;
- malformed YAML frontmatter if used;
- duplicate canonical policy files.

Prefer a small repository-owned Node script for local-link/path validation so external HTTP flakiness does not block every PR.

A scheduled external link check may be non-blocking if third-party sites are unstable, but local documentation references must be blocking.

---

## 6.6 `.github/workflows/release.yml`

Purpose: repeatable tagged releases.

Trigger:

```text
vMAJOR.MINOR.PATCH
```

or the repository's established SemVer tag convention.

Before publishing:

1. checkout exact tag;
2. use Node 22;
3. `npm ci`;
4. lint;
5. typecheck;
6. auth invariant;
7. tests;
8. production build;
9. determine the actual deploy/build artifact directory from the current build output;
10. package a reproducible release artifact where useful;
11. generate SHA-256 checksums;
12. generate an SBOM if practical;
13. create build provenance/artifact attestation when supported;
14. create or update the GitHub Release;
15. attach artifact(s), checksums, and SBOM;
16. use generated release notes or `.github/release.yml` categories.

Permissions must be narrow. Typical release-only writes may include:

```yaml
permissions:
  contents: write
  id-token: write
  attestations: write
```

Add additional permissions only when a specific step requires them.

Do not publish to npm unless the owner explicitly wants this project distributed as an npm package. `"private": true` may remain correct for a public source repository that is not an npm package.

---

# 7. Dependabot

Create `.github/dependabot.yml` covering:

1. npm dependencies;
2. GitHub Actions.

Use a conservative update cadence such as weekly.

Requirements:

- group compatible minor/patch development updates when helpful;
- keep security updates enabled in repository settings;
- do not auto-merge major upgrades;
- do not flood the repo with excessive PRs;
- assign/review using the real owner only if it can be resolved;
- never invent usernames.

Document which Dependabot features must also be enabled in GitHub repository settings because not all security settings are controlled by `dependabot.yml`.

---

# 8. CODEOWNERS

Create `.github/CODEOWNERS`.

Determine the actual owner from the repository remote or existing GitHub metadata.

Do not hardcode a guessed username.

At minimum establish ownership for:

```text
*                           <resolved-owner>
/.github/                    <resolved-owner>
/.github/workflows/          <resolved-owner>
/.github/CODEOWNERS          <resolved-owner>
/.github/rules.json          <resolved-owner>
/package.json                <resolved-owner>
/package-lock.json           <resolved-owner>
/vite.config.ts              <resolved-owner>
/vercel.json                 <resolved-owner>
/src/                        <resolved-owner>
/src/venice.ts               <resolved-owner>
/src/audio.ts                <resolved-owner>
/src/speech.ts               <resolved-owner>
/scripts/                    <resolved-owner>
/server/                     <resolved-owner>
/SECURITY.md                 <resolved-owner>
/PRIVACY.md                  <resolved-owner>
```

Consolidate redundant entries if one wildcard already expresses the same ownership.

CODEOWNERS entries must use GitHub-valid owners that actually have the required repository access.

If the repo belongs to an organization with appropriate teams, prefer stable team ownership for security/workflow-sensitive areas rather than one personal account.

---

# 9. Version-controlled GitHub branch rules: `.github/rules.json`

Create a valid GitHub repository ruleset payload intended for the repository rulesets API.

Target the default branch using the current GitHub ruleset schema and `~DEFAULT_BRANCH` when supported.

The ruleset should be named clearly, for example:

```text
Protect default branch
```

Set active enforcement only after CI names are verified.

Core rules should include, when supported for the actual repository/plan:

- prevent branch deletion;
- prevent force pushes / non-fast-forward updates;
- require linear history;
- require pull requests;
- require resolution of review threads;
- require selected CI checks to pass;
- require branches to be up to date with the target branch;
- restrict allowed merge methods to the project's intended history policy;
- optionally require signed commits if that will not break the project's contributor model;
- optionally gate code scanning only after CodeQL is confirmed operational.

## 9.1 Required checks

Do not guess check contexts.

After the workflows have run successfully on a real branch/PR, inspect emitted checks with GitHub CLI/API and put the exact context strings in `required_status_checks`.

The required set should normally cover:

- Quality
- Tests
- Build
- Dependency Review

Add CodeQL only when the exact check context and scan availability are confirmed.

## 9.2 Review policy must not deadlock the repository

Detect whether this is a solo-maintained personal repository or a multi-maintainer/org repository.

### Solo-maintainer mode

Use:

- PR required;
- required status checks;
- resolved conversations;
- no forced external approval count that prevents the maintainer from merging their own maintenance PR;
- CODEOWNERS still used for ownership visibility and future contributors.

### Multi-maintainer mode

Use:

- at least one approving review;
- code-owner review for owned files;
- dismiss stale approvals after new reviewable commits;
- require approval of the latest push by someone other than the pusher when that policy is operationally viable.

Do not create a configuration that permanently locks `main`.

## 9.3 Apply script

Create:

```text
scripts/github/apply-ruleset.sh
```

Requirements:

- `set -euo pipefail`;
- require `gh` authentication;
- detect owner/repo from `gh repo view` or git remote;
- validate `.github/rules.json` parses before API call;
- find an existing repository ruleset by exact name;
- POST if absent;
- PATCH/PUT the correct endpoint if present;
- print the resulting ruleset URL/ID;
- never delete unrelated rulesets;
- never silently weaken an existing stronger ruleset;
- support a dry-run mode if practical.

Document exact usage in `docs/BRANCH_PROTECTION.md`.

---

# 10. Repository settings hardening

Create `docs/GITHUB_ADMIN.md` with a manual admin checklist for settings that are not reliably expressed in repo files.

Include verification for:

- default branch is `main` unless current repository intentionally differs;
- delete head branches after merge;
- squash/rebase/merge policy matches ruleset;
- dependency graph enabled;
- Dependabot alerts enabled;
- Dependabot security updates enabled;
- secret scanning enabled/available;
- push protection enabled where available;
- private vulnerability reporting enabled for a public repository;
- repository security advisories available;
- default GitHub Actions token permissions set to read-only where possible;
- workflow approval policy for first-time contributors is deliberate;
- fork PR workflows do not receive secrets;
- Actions are limited to allowed/reviewed actions if repository policy supports it;
- branch ruleset active;
- Discussions enabled only if project intends to support them;
- Issues enabled if issue templates are being shipped;
- Releases enabled;
- correct repository topics;
- website/homepage set only if a real deployed URL exists;
- repository description is concise and accurate.

Do not claim these settings were changed unless Grok has actual GitHub admin access and verified the API response.

---

# 11. Issue templates

Use GitHub Issue Forms rather than unstructured Markdown where practical.

## 11.1 Bug report

Collect:

- app version/commit;
- browser + version;
- OS;
- desktop/mobile;
- installation/deployment context;
- affected mode: text chat / TTS / STT / voice chat / voice changer / settings / character / tools / other;
- reproduction steps;
- expected behavior;
- actual behavior;
- logs with explicit warning not to paste API keys;
- screenshots/video;
- regression status;
- network/proxy/ad-blocker context if relevant.

Add a privacy warning:

> Never include Venice API keys, bearer tokens, cookies, private prompts, private conversation content, or unredacted credentials.

## 11.2 Feature request

Collect:

- problem/use case;
- proposed behavior;
- current workaround;
- scope;
- UX implications;
- Venice API dependency if relevant;
- security/privacy considerations;
- alternatives.

## 11.3 Template config

Link:

- security reports to the security policy/private reporting path;
- support questions to Discussions only if Discussions are enabled;
- documentation.

Do not publish a nonexistent email address.

---

# 12. Pull request template

Create `.github/PULL_REQUEST_TEMPLATE.md`.

Require:

- summary;
- motivation;
- type of change;
- linked issue;
- implementation notes;
- screenshots for UI changes;
- test evidence;
- accessibility impact;
- security/privacy impact;
- dependency changes;
- documentation changes;
- breaking changes;
- checklist.

Checklist should include:

```text
[ ] npm run lint
[ ] npm run typecheck
[ ] npm run check:auth
[ ] npm test
[ ] npm run build
[ ] docs updated where behavior changed
[ ] no secrets/API keys committed
[ ] UI changes verified desktop + mobile
```

Do not make meaningless “I have read everything” checkboxes.

---

# 13. README overhaul

Replace the stub README with a professional landing page.

The README must remain concise enough to scan while linking to deeper docs.

Recommended structure:

1. Hero/banner
2. Product name and one-line positioning
3. Real status badges
4. Short description
5. Screenshot/product preview
6. Key capabilities
7. Voice flow overview
8. Quick start
9. Venice API key/configuration explanation
10. Main usage modes
11. Architecture summary
12. Security/privacy summary
13. Development commands
14. Documentation index
15. Contributing
16. Security reporting
17. Roadmap
18. License/legal status
19. Trademark/non-affiliation statement

## 13.1 README copy rules

Use factual language.

Good:

> Ember is a Venice-powered voice and chat interface with configurable models, TTS/STT controls, system prompts, and conversational voice workflows.

Bad:

> The world's most advanced private AI voice agent.

Do not use “private” unless the architecture supports the claim and the privacy documentation defines the boundary.

Do not call inference parameter controls “fine-tuning” if no model weights are trained.

Distinguish:

- text chat;
- STT → LLM → TTS conversational voice chat;
- dedicated speech-to-speech Voice Changer, only if actually implemented;
- TTS voice/model selection;
- Venice character integration, only to the degree currently implemented.

## 13.2 Badges

Use only live, real badges:

- CI
- CodeQL
- dependency/security workflow if useful
- current release
- license once selected
- Node version if desired

All badge URLs must be derived from the actual repository owner/name.

No shields with hardcoded “passing”.

---

# 14. README hero image / visual system

The repository needs a custom hero asset based on the actual Ember app.

## 14.1 First inspect the app

Use the live app and representative screenshots to identify:

- background palette;
- Ember/orb lighting;
- glow treatment;
- typography;
- panels/settings design;
- microphone/voice iconography;
- waveform/speech visual language;
- mobile/desktop composition.

Do not create a generic AI stock-art banner.

## 14.2 Preferred generation path

If an image-generation tool is available in Grok Build, generate a purpose-built README hero.

Recommended art direction prompt:

> Create a premium widescreen open-source project hero inspired directly by the current Ember voice companion UI. Dark near-black charcoal and deep aubergine background; a luminous ember-like conversational orb as the focal point; restrained warm amber, soft coral and subtle violet light; elegant translucent interface fragments suggesting text chat, microphone input, waveform/TTS playback, and model selection; precise modern software-product aesthetic; minimal, refined, technical, confident; cinematic but not game-like; no people, no copyrighted characters, no third-party logos, no Venice or xAI logo recreation, no fake UI text, no watermark. Preserve negative space around the main focal point so the asset crops well on GitHub. 2:1 composition, high detail, clean edges, production-ready.

Output target:

- source: high resolution;
- final PNG: approximately `2400x1200`;
- optional optimized WebP;
- keep Git payload reasonable;
- use lossless or visually clean compression;
- verify it renders in GitHub light and dark page contexts.

Place at:

```text
docs/assets/ember-hero.png
```

## 14.3 Fallback if no image generator is available

Do not invent an unavailable tool.

Instead:

1. capture a clean current app screenshot;
2. create a repository-owned SVG/CSS-composed banner using the app's actual colors;
3. optionally composite the real app screenshot into a stylized browser/window frame;
4. export a PNG using available tooling;
5. avoid third-party copyrighted visuals.

## 14.4 Additional visuals

Copy/curate representative actual screenshots into `docs/assets/` rather than referencing fragile temporary build paths.

Add meaningful alt text.

Create `docs/assets/architecture.svg` as an accessible diagram showing the actual data flow, for example:

```text
User
 ├─ Text ────────────────┐
 └─ Microphone → STT ───┤
                         ↓
                  Conversation State
                         ↓
                   Venice Chat API
                         ↓
               Assistant text stream
                         ↓
                TTS / Audio playback
```

Only include Voice Changer/character/catalog branches that actually exist.

---

# 15. Documentation suite

## 15.1 `docs/QUICKSTART.md`

Provide the shortest safe path to run and use the app.

Include:

- prerequisites;
- Node version;
- install;
- start;
- API key setup;
- first text-chat test;
- first TTS test;
- first microphone permission test.

## 15.2 `docs/INSTALLATION.md`

Cover:

- local clone;
- npm;
- Node 22;
- Vercel/deployment considerations;
- Grok Build-specific notes;
- no secret commits.

Clearly distinguish Grok Build's platform environment from a normal external clone.

## 15.3 `docs/CONFIGURATION.md`

Document every user-facing setting based on code:

- system prompt;
- chat model;
- TTS model;
- voice;
- STT;
- temperature/generation controls;
- Venice character slug/catalog behavior;
- tool permissions;
- storage/persistence behavior;
- API key lifecycle.

Do not document controls that do not exist.

## 15.4 `docs/USAGE.md`

Task-oriented how-to guides:

- text chat;
- choosing a model;
- selecting TTS model/voice;
- system prompt use;
- voice conversation;
- microphone permissions;
- selecting a Venice character;
- clearing history;
- exporting data if supported;
- error recovery.

## 15.5 `docs/VOICE_MODES.md`

Explicitly distinguish:

1. TTS: text → audio;
2. STT: speech → text;
3. conversational voice chat: speech → STT → LLM → TTS;
4. direct speech-to-speech/Voice Changer if implemented.

Document latency and privacy implications factually.

## 15.6 `docs/VENICE_API.md`

Document:

- this project is an independent client/integration unless affiliation is actually documented;
- endpoints used;
- authentication flow;
- dynamic model/voice catalog strategy;
- character slugs/catalog behavior;
- expected error categories;
- rate-limit behavior where known from current official docs;
- no hardcoded long-lived model promises if Venice rotates IDs.

Link to official Venice documentation rather than copying large sections.

## 15.7 `docs/ARCHITECTURE.md`

Include:

- directory map;
- frontend state;
- Venice client boundary;
- proxy/server boundary;
- audio pipeline;
- storage;
- tool execution;
- deployment;
- trust boundaries.

## 15.8 `docs/SECURITY_MODEL.md`

Threat-model the actual application.

At minimum cover:

- Venice API key handling;
- browser/server trust boundary;
- SSRF/network-tool constraints;
- model-generated tool calls;
- prompt injection through fetched content;
- microphone permissions;
- untrusted model output;
- local persistence;
- third-party APIs;
- dependency supply chain;
- GitHub Actions;
- deployment secrets.

Identify known limitations honestly.

## 15.9 `docs/PRIVACY_MODEL.md` and `PRIVACY.md`

Explain actual data flows:

- API key;
- prompts;
- system prompts;
- microphone audio;
- transcripts;
- assistant responses;
- generated speech;
- conversation history;
- browser storage;
- server/proxy transit;
- Venice API transit;
- telemetry/analytics if any.

If there is no telemetry, state that only after verifying the code.

Avoid vague claims like “nothing leaves your device” when cloud inference is used.

## 15.10 `docs/DEVELOPMENT.md`

Document:

```bash
npm ci
npm run dev
npm run lint
npm run typecheck
npm run check:auth
npm test
npm run build
```

Include project conventions and files that contributors must not break.

## 15.11 `docs/TESTING.md`

Document test layers:

- Node script tests;
- TS tests;
- browser smoke tests;
- manual voice/microphone tests;
- PWA/OG tests;
- release validation.

## 15.12 `docs/TROUBLESHOOTING.md`

Cover:

- Venice API auth failures;
- no models/voices;
- microphone permission denied;
- audio playback blocked;
- TTS model/voice mismatch;
- failed schema repair;
- network/proxy errors;
- browser autoplay restrictions;
- stale local settings;
- Vercel deployment issues.

Never tell users to paste credentials into an issue.

## 15.13 `docs/RELEASING.md`

Define:

- SemVer;
- changelog expectations;
- release branch/tag process;
- CI prerequisites;
- tag command;
- automated release workflow;
- artifact/checksum verification;
- rollback/hotfix process.

## 15.14 `docs/ROADMAP.md`

Separate:

- shipped;
- in progress;
- proposed.

Potential roadmap items may include only if not already shipped:

- full Venice model catalog discovery;
- TTS catalog/voice compatibility mapping;
- dedicated Voice Changer;
- Venice character browser;
- persistent chat library;
- richer model inference controls;
- export/import;
- improved streaming PCM TTS;
- accessibility improvements.

Do not assign fake dates.

---

# 16. Security policy

Create one canonical `SECURITY.md`.

Include:

- supported versions;
- how to report a vulnerability privately;
- strong instruction not to open public issues for undisclosed vulnerabilities;
- GitHub private vulnerability reporting as the preferred route when enabled;
- what information is useful in a report;
- credential-handling warning;
- scope examples;
- coordinated disclosure expectations;
- dependency vulnerability handling;
- security advisory/release process.

Do not invent a security email.

Do not promise a fixed SLA unless the maintainer has authorized one.

---

# 17. Legal / public-release documentation

This is software-maintenance work, not legal representation. The repository must not pretend uncertain legal choices are settled.

## 17.1 License

Inspect for an existing license or explicit project instruction.

If a license is already selected, ensure:

- `LICENSE` contains the correct unmodified canonical license text;
- `package.json` SPDX identifier matches;
- README license section matches;
- `NOTICE` is included when appropriate;
- source headers are not sprayed across files unless the project policy requires them.

If **no license has been explicitly selected**, do **not** silently choose one and do not falsely label the project open source.

Instead:

1. create a release blocker in `RELEASE_CHECKLIST.md`;
2. document the decision in `docs/LEGAL.md`;
3. present the owner with concise options such as MIT vs Apache-2.0 and the practical distinction, without pretending to provide legal advice;
4. leave the license badge out until resolved.

The repository may be publicly visible without being open-source licensed; documentation must use precise language.

## 17.2 Third-party notices

Create `THIRD_PARTY_NOTICES.md`.

Generate from actual production dependencies where practical.

Include:

- dependency name;
- version;
- license identifier;
- upstream project URL where reliably known.

Do not paste entire third-party license corpus unless required.

If automation is added to generate notices, make it reproducible.

## 17.3 Trademarks/non-affiliation

Create `TRADEMARKS.md` and/or a concise section in `docs/LEGAL.md`.

Unless repository evidence proves otherwise, say factually that:

- Venice/Venice.ai names and marks belong to their respective owner;
- xAI/Grok names and marks belong to their respective owner;
- the project is an independent integration/client and does not imply endorsement or affiliation.

Do not use third-party logos in the README hero unless authorized.

## 17.4 Privacy

`PRIVACY.md` must describe current behavior, not future intent.

## 17.5 Warranty/disclaimer

Avoid duplicating or contradicting the selected license's warranty terms.

Add service-specific disclaimers only where useful, such as:

- cloud inference availability is controlled by third-party APIs;
- users are responsible for complying with applicable provider terms;
- generated model output may be inaccurate.

Do not write sweeping legal guarantees.

---

# 18. Contributor governance

## 18.1 `CONTRIBUTING.md`

Cover:

- prerequisites;
- setup;
- branch/PR workflow;
- issue-first expectations only if desired;
- coding conventions;
- test commands;
- UI verification;
- security-sensitive changes;
- dependency policy;
- generated/platform-owned files;
- commit/PR title convention;
- documentation requirements;
- DCO/CLA only if the project actually adopts one.

Do not invent a CLA.

## 18.2 `CODE_OF_CONDUCT.md`

Use a recognized, current code-of-conduct template if the maintainer wants community contributions.

Fill contact/enforcement fields only with real information. Do not invent an email.

If required template fields cannot be completed, make that an explicit release checklist item rather than publishing bogus data.

## 18.3 `GOVERNANCE.md`

For a small project, keep governance simple:

- maintainer responsibilities;
- how decisions are made;
- security-sensitive decisions;
- release authority;
- contributor path;
- how ownership may expand.

Do not invent committees.

## 18.4 `SUPPORT.md`

Define:

- GitHub Issues = reproducible bugs;
- Discussions = usage questions only if enabled;
- Security reporting = private path;
- no private support channel unless one exists.

---

# 19. Changelog and release notes

Create `CHANGELOG.md` using a consistent human-readable format.

Recommended:

- `Unreleased`;
- Added;
- Changed;
- Fixed;
- Security;
- Deprecated;
- Removed.

Do not fabricate historic entries that cannot be derived from repository history.

Create `.github/release.yml` for generated GitHub release-note categories based on labels, for example:

- Breaking Changes
- Features
- Fixes
- Security
- Documentation
- Dependencies
- Internal

Exclude noisy labels such as duplicate/invalid from release notes if appropriate.

---

# 20. Package metadata cleanup

Review `package.json`.

The generic identity:

```json
"name": "app-builder-workspace"
```

should not survive a professional release unless it is intentionally the actual package name.

Set accurate metadata where appropriate:

- package name;
- description;
- repository;
- bugs URL;
- homepage;
- author/maintainers only when factual;
- license only when selected;
- engines:
  ```json
  "node": ">=22 <23"
  ```
  if that accurately reflects the current app/platform contract.

Keep:

```json
"private": true
```

if the project is not intended for npm publication.

Do not conflate “public GitHub repository” with “public npm package.”

Add useful scripts if needed:

```json
"format:check": "prettier --check .",
"validate": "npm run lint && npm run format:check && npm run typecheck && npm run check:auth && npm test && npm run build"
```

Only add `validate` if it works reliably in the actual repository.

---

# 21. Git hygiene

Expand `.gitignore` only based on real project artifacts.

Ensure it covers relevant local/generated material without hiding source:

- `.env`
- `.env.*`
- exception for `.env.example` if retained;
- `node_modules/`
- build output;
- Vercel local state;
- test artifacts;
- coverage output;
- Playwright report/output if generated;
- OS junk such as `.DS_Store`;
- editor-local files when appropriate;
- temporary Grok logs that should not be public.

Do not ignore lockfiles.

Remove accidental macOS `__MACOSX`/AppleDouble metadata if present in the repository.

Do not remove Grok platform files simply because they look generated if `AGENTS.md` says they are required.

---

# 22. Repository topics and About text

Create recommendations in `docs/GITHUB_ADMIN.md`.

Possible topics must reflect actual implementation, for example:

- venice-ai
- tts
- speech-to-text
- voice-ai
- react
- typescript
- vite
- ai-chat

Do not add `voice-changer`, `open-source`, or other topic claims unless the corresponding implementation/license is true.

Provide a concise repository description based on current functionality, not marketing exaggeration.

---

# 23. Security hardening for GitHub Actions

Audit every workflow for:

- untrusted interpolation into shell;
- excessive token permissions;
- write permissions on PR jobs;
- secret access on fork PRs;
- `pull_request_target`;
- mutable third-party tags;
- arbitrary script downloads;
- unsafe `curl | sh`;
- artifact poisoning;
- release jobs that can be triggered from untrusted branches;
- cache poisoning;
- unsafe use of `${{ github.event.* }}` in `run:` blocks.

Prefer environment variables over direct shell interpolation for untrusted values.

Pin third-party actions to full SHAs where practical.

Configure Dependabot to keep action SHAs updated.

---

# 24. Release-readiness verifier

Create:

```text
scripts/github/verify-release-readiness.mjs
```

It should perform deterministic repository checks without GitHub admin credentials.

Validate at minimum:

- required public-release files exist;
- README references existing image paths;
- package metadata no longer contains obvious scaffold placeholders;
- JSON/YAML files parse;
- `.github/CODEOWNERS` is non-empty;
- `.github/rules.json` parses;
- workflow files exist;
- no `.env` file is tracked;
- no obvious API-key pattern is present in tracked source;
- no `__MACOSX` or AppleDouble metadata is tracked;
- license state is explicit;
- local documentation links resolve;
- README does not contain known stale scaffold text.

Expose through npm if useful:

```json
"release:check": "node scripts/github/verify-release-readiness.mjs"
```

Do not make this script claim repository settings are enabled; settings requiring GitHub API/admin access belong in the separate admin checklist/apply tooling.

---

# 25. Validation requirements

Before reporting completion, run all relevant commands.

At minimum:

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

Validate YAML/JSON using available tooling.

If `actionlint` is available, run it. If not, use a safe alternative or parse workflows where practical; do not install random binaries with `curl | sh`.

For shell:

```bash
bash -n scripts/github/apply-ruleset.sh
```

If ShellCheck exists, use it.

Validate README assets exist and render.

Validate desktop/mobile app screenshots still match current app.

If GitHub access is available:

```bash
gh auth status
gh repo view
gh workflow list
gh api repos/{owner}/{repo}/rulesets
```

After workflows have run, inspect real status-check names before finalizing ruleset required contexts.

---

# 26. CI activation sequencing

Do not create a branch-protection deadlock.

Use this order:

1. make local validation green;
2. add CI workflows;
3. push workflows;
4. observe real check names;
5. update `.github/rules.json` with exact contexts;
6. apply ruleset;
7. verify a test PR behaves correctly;
8. verify maintainer can still merge under intended policy;
9. enable remaining security settings;
10. cut the first professional release only when the release checklist passes.

If CI remains red, leave the ruleset file ready but do not pretend it has been safely activated.

---

# 27. Required release checklist

`RELEASE_CHECKLIST.md` must have clear blocking items.

Include:

## Identity

- [ ] Product/repo name final
- [ ] Package metadata final
- [ ] Real repository links
- [ ] Hero/screenshot assets final

## Quality

- [ ] lint green
- [ ] formatting green
- [ ] typecheck green
- [ ] tests green
- [ ] production build green

## Security

- [ ] CodeQL running
- [ ] dependency review running
- [ ] Dependabot configured
- [ ] secret scanning reviewed
- [ ] push protection reviewed
- [ ] private vulnerability reporting enabled
- [ ] no committed credentials
- [ ] branch ruleset active and tested

## Documentation

- [ ] README accurate
- [ ] installation accurate
- [ ] configuration accurate
- [ ] usage accurate
- [ ] architecture accurate
- [ ] security model accurate
- [ ] privacy model accurate
- [ ] troubleshooting accurate

## Legal

- [ ] license explicitly selected
- [ ] SPDX metadata matches
- [ ] third-party notices generated/reviewed
- [ ] trademark/non-affiliation wording reviewed
- [ ] privacy text matches implementation
- [ ] code-of-conduct contact/enforcement data valid

## Release

- [ ] SemVer version selected
- [ ] changelog updated
- [ ] tag created from clean verified commit
- [ ] release workflow passes
- [ ] checksums published
- [ ] SBOM/provenance attached where supported

---

# 28. Acceptance criteria

Do not call the task complete unless all applicable items below are true.

### Repository presentation

- README is polished and no longer a stub.
- Hero image is custom and visually derived from Ember.
- README contains real screenshots.
- All badges are live.
- No scaffold branding remains in public-facing metadata unless intentionally required.
- Public docs use consistent project naming.

### CI

- CI is green.
- Test failures are not suppressed.
- Workflows use least privilege.
- Fork PRs do not receive secrets.
- CodeQL is correctly configured.
- Dependency review works.
- Scorecard works when supported.
- Release automation works or is clearly blocked by an external setting.

### Governance

- CODEOWNERS is valid.
- PR template exists.
- Bug and feature forms exist.
- Contribution policy exists.
- Support policy exists.
- Governance is appropriate for the actual maintainer count.

### Security

- SECURITY policy is complete.
- Private reporting path is documented.
- GitHub security settings checklist exists.
- No secret is committed.
- Action supply-chain risks are addressed.
- Security docs match the application architecture.

### Branch protection

- `.github/rules.json` is syntactically valid.
- required checks exactly match emitted checks.
- no force pushes.
- no branch deletion.
- PR workflow is required.
- rules do not deadlock the actual maintainer model.
- apply script is idempotent.

### Legal

- license status is explicit.
- no invented copyright holder.
- no invented legal entity.
- third-party trademarks are handled neutrally.
- README does not imply Venice/xAI endorsement.
- privacy claims match code.

### Documentation

- local links resolve.
- screenshots exist.
- all documented commands work.
- configuration docs match real controls.
- planned features are clearly labeled planned.

---

# 29. Do not do these things

- Do not delete `AGENTS.md`.
- Do not replace the app.
- Do not rename the product without evidence the owner requested it.
- Do not use an image-generation tool that is not actually available.
- Do not generate fake screenshots.
- Do not put third-party logos into generated art without authorization.
- Do not commit an API key.
- Do not publish a security email that does not exist.
- Do not choose a software license silently.
- Do not claim “open source” before a valid open-source license is selected.
- Do not claim a privacy guarantee that cloud API use contradicts.
- Do not require a nonexistent status check.
- Do not protect `main` before CI is operational.
- Do not use `pull_request_target` to execute contributor code.
- Do not grant `contents: write` globally.
- Do not use `permissions: write-all`.
- Do not use `continue-on-error` to hide release blockers.
- Do not lower tests to make CI green.
- Do not regenerate lockfiles without a reason.
- Do not remove platform-owned Grok/Vercel integration code.
- Do not publish to npm unless explicitly requested.
- Do not create a CLA, DCO policy, sponsor page, funding link, or company governance structure without owner authorization.

---

# 30. Implementation sequence

Use this sequence:

### Phase A — discovery

- inspect repo;
- establish identity;
- establish owner/repo slug;
- baseline all checks;
- inspect GitHub/public-release gaps.

### Phase B — make repository validation deterministic

- fix release-blocking existing tests;
- add `format:check`;
- add `validate` / `release:check`;
- clean tracked junk.

### Phase C — GitHub CI/security

- CI;
- CodeQL;
- dependency review;
- Scorecard;
- Dependabot;
- docs validation.

### Phase D — governance

- CODEOWNERS;
- issue forms;
- PR template;
- CONTRIBUTING;
- CODE_OF_CONDUCT;
- GOVERNANCE;
- SUPPORT;
- SECURITY.

### Phase E — README and visual assets

- run app;
- capture screenshots;
- generate Ember hero;
- architecture graphic;
- overhaul README.

### Phase F — technical/how-to docs

- quick start;
- installation;
- configuration;
- usage;
- voice modes;
- Venice integration;
- architecture;
- testing;
- troubleshooting.

### Phase G — legal/privacy

- privacy;
- legal/trademark;
- third-party notices;
- license gate.

### Phase H — release engineering

- changelog;
- release notes config;
- release workflow;
- SBOM/checksums/attestation;
- release checklist.

### Phase I — branch rules

- observe real CI check names;
- finalize `.github/rules.json`;
- implement idempotent apply script;
- test branch behavior.

### Phase J — final audit

- run every validation command;
- inspect docs locally;
- inspect GitHub Actions when accessible;
- return completion report.

---

# 31. Final completion report format

When finished, respond with a factual report containing:

## Created

A list of every created file.

## Modified

A list of every modified pre-existing file and why.

## CI

For every workflow:

- file;
- triggers;
- job names;
- permissions;
- result of validation/run.

## Security

State:

- CodeQL status;
- dependency review status;
- Dependabot status;
- secret-scanning/push-protection status if actually verified;
- vulnerability-reporting status if actually verified;
- any unresolved security blockers.

## Branch rules

State:

- ruleset file path;
- exact required check contexts;
- whether it was applied;
- ruleset ID/URL if actually applied;
- solo/team review mode;
- any limitations.

## Documentation

List public docs and note any behavior that remains undocumented.

## Visual assets

State:

- hero generation method;
- source screenshots used;
- generated asset paths;
- final pixel dimensions/file sizes.

## Legal

State:

- selected license, or explicit unresolved license blocker;
- NOTICE status;
- third-party-notices status;
- privacy status;
- trademark/non-affiliation status.

## Validation

Paste concise results for:

```text
npm run lint
npm run format:check
npm run typecheck
npm run check:auth
npm test
npm run build
npm run release:check
```

## Remaining blockers

List only real unresolved issues.

Do not claim “professional release ready” while a blocking item remains.

---

# 32. Definition of done

The work is done only when the repository is simultaneously:

- technically green;
- publicly understandable;
- contributor-friendly;
- security-conscious;
- correctly governed;
- accurately documented;
- visually polished;
- legally explicit about what is known and unresolved;
- protected by a tested GitHub ruleset;
- capable of producing a reproducible tagged release.

A beautiful README on top of failing tests or inaccurate security/privacy claims is **not** completion.
