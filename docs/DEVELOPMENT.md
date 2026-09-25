# Development

```bash
npm ci
npm run dev
npm run lint
npm run format:check
npm run typecheck
npm run check:auth
npm test
npm run build
npm run release:check
```

`npm run format` rewrites files. CI runs `format:check` instead. `.prettierignore` skips generated output and the platform `.grok/` skill bundle so that gate stays on project source.

`npm run validate` runs lint, format check, typecheck, auth invariant, tests, and the production build.

## Conventions

- TypeScript and React 19. The UI is TanStack Start.
- Do not add a `.env` file. Keys are entered in the browser.
- Do not call Venice key creation.
- Do not document inference sliders as fine-tuning.
- Do not hardcode a Venice model id as the catalog.
- Keep the proxy allowlist explicit. Do not forward arbitrary paths.
- Platform files (`AGENTS.md`, `startup.sh`, `scripts/grok-pwa-*`, `server/`, `public/__grok/`) are required by the Grok Build preview. Change them only when a platform defect requires it.

## Pull requests

Use the template in `.github/PULL_REQUEST_TEMPLATE.md`. UI changes need a desktop and a narrow screenshot. Security-sensitive changes should say which boundary moved.
