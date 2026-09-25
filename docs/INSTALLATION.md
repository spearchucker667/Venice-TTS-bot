# Installation

## Local clone

```bash
git clone <your-repository-url>
cd <repository-directory>
npm ci
npm run dev
```

There is no `.env` file to create. Do not commit a Venice key. The key is entered in the app.

`npm run build` runs the production Vite/Nitro build and then `npm run db:migrate`. If `DATABASE_URL` is unset, the migrate script skips. Ember does not require a database.

## Node

Use Node 22. `package.json` sets `"node": ">=22 <23"` because that is the version this workspace and CI target. npm ci uses `package-lock.json`.

## Grok Build preview

Inside the Grok Build workspace, `startup.sh` starts `npm run dev` when port 8080 is not already healthy. That script is a platform contract. External clones can ignore it and run `npm run dev` themselves.

`VITE_AUTH_ENABLED` is false for this app. Do not turn on the platform auth or database just to run Ember.

## Deployment

`vercel.json` only sets the install command. The production build emits a Vercel/Nitro output under `.vercel/output`. Deployment secrets, if you add a host later, belong in the host's secret store, not in the repository.

The browser still supplies the Venice key. A deployment does not need a server-side Venice key for the current design.
