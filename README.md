# Chronicle

A history timeline you build yourself as you learn. Add events, periods and people, link them to your notes and sources, connect them to each other, and lay trends such as population or technology underneath. It works offline and installs like an app.

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173
```

Run `npm run check` before committing: it runs the typecheck, unit tests, a build and the end-to-end tests. Run `npx playwright install chromium` once before the first e2e run.

## Moving data between devices

Until automatic sync lands, use **More → Export a backup** on one device, then **More → Import a file… → Merge** on the other. Merging keeps the newest version of every entry, note and source, and respects deletions.

## Deploying

Pushing to `main` builds the app and publishes it to GitHub Pages (see `.github/workflows/deploy.yml`). In the repository's Settings → Pages, set the source to **GitHub Actions** once.

## For contributors (and Claude)

See [CLAUDE.md](CLAUDE.md), [ROADMAP.md](ROADMAP.md) and [docs/](docs/).
