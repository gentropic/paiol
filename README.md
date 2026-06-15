# paiol

Cost, recipe, and sales management for a Brazilian MEI confeitaria — **Quitutes do Paiol**.
Local-first, single-file, auditable-forever. Part of the GCU ecosystem.

See [`paiol-spec-v0.1.md`](./paiol-spec-v0.1.md) for the full design.

## Run it

```sh
npm run dev      # serves http://localhost:8080/ (native ES modules, no build step)
npm test         # run the test suite (node --test, zero deps)
npm run build    # inline everything → paiol.html (single-file deploy)
```

Open <http://localhost:8080/> — that exact URL is also the registered Dropbox OAuth
redirect, so "Conectar ao Dropbox" works in local dev.

## Deploy

Live at <https://gentropic.org/paiol/> via GitHub Pages — a project site for this repo,
served under the org's `gentropic.org` custom domain. **Deployment is automatic:** pushing
to `main` runs [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml), which builds
the single file and publishes it (no manual steps, no separate hosting repo).

The single file is self-contained (everything inlined). The production OAuth redirect
`https://gentropic.org/paiol/` must stay registered in the Dropbox app for "Conectar ao
Dropbox" to work in production.

## Layout

```
src/
  domain.js        domain types (§2) as JSDoc
  units.js         unit conversions + per-ingredient override graph (§3)
  cost-engine.js   cost engine: DAG roll-up, estimate/actual lens, MEI markup (§4)
  store.js         append-only event store, union-by-id merge, canonical YAML
  yaml-bridge.js   JS value <-> @gcu/yaml
  persist.js       backend-agnostic persistence over @gcu/vfs (§5)
  dropbox-auth.js  PKCE OAuth (no secret) + token manager
  sync.js          pull / union-merge / push against any VFS (Dropbox in prod)
  auth-flow.js     browser glue for the Dropbox redirect
  app.js / ui.js / main.js   boot + PT-BR UI
vendor/@gcu/       vendored, pinned libraries (see vendor/README.md)
tools/dev-server.js   zero-dep static dev server
build.js              single-file builder
```

Code identifiers are English; every label the user sees is Portuguese.

## License

CC0 / MIT.
