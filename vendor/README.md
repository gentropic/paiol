# vendor/

Vendored `@gcu/*` modules, copied (not submoduled) so paiol stays self-contained and
auditable-forever. Each is the **pre-bundled single-file** `index.js` from the auditable
monorepo, pinned to a known build.

| Module | Source | Pinned to |
|---|---|---|
| `@gcu/yaml` | `auditable/ext/yaml/index.js` | auditable @ `591b719` |
| `@gcu/vfs`  | `auditable/ext/vfs/index.js`  | auditable @ `591b719` |
| `@gcu/sheet`| `auditable/ext/sheet/index.js`| auditable @ `591b719` (dev/tools only — XLSX reader for tools/xlsx-to-paiol.mjs; not imported by the app) |
| `@gcu/sw`   | `auditable/ext/sw/{sw-core.js,register.js,make.mjs}` | auditable @ `591b719` (PWA: `register.js` imported by `src/pwa.js`; `make.mjs` used by `build.js` to emit `sw.js`; `sw-core.js` is the worker body baked into `sw.js`) |
| `pdf-lib`   | `pdf-lib/dist/pdf-lib.min.js` (UMD) | **v1.17.1** — PDF generation (Rev 04 fichas/recibo). NOT a @gcu lib; the upstream npm UMD bundle. **NOT imported** — it's a self-contained classic script that sets a global `PDFLib`, **lazy-loaded** by `src/pdf.js` from `./vendor/pdf-lib/pdf-lib.min.js` on first PDF use (so it never bloats startup; the SW precaches it for offline; `build.js` never touches it → no strip-and-concat collision). Deploy copies it preserving the `vendor/pdf-lib/` path. ~525 KB. License: `vendor/pdf-lib/LICENSE.md` (MIT). |
| `exceljs`   | `exceljs/dist/exceljs.min.js` (UMD) | **v4.4.0** — Excel `.xlsx` import/export (Rev 06, `src/xlsx-exchange.js`). NOT a @gcu lib; the upstream npm UMD bundle. Same pattern as pdf-lib: **NOT imported** (sets a global `ExcelJS`), **lazy-loaded** from `./vendor/exceljs/exceljs.min.js` on first spreadsheet use, SW-precached, deploy-copied preserving the `vendor/exceljs/` path, build untouched. Also a **devDependency** (`exceljs` in package.json) so `test/xlsx-exchange.test.mjs` can inject the lib in Node — the shipped app only uses this vendored UMD. ~950 KB. License: `vendor/exceljs/LICENSE` (MIT). |

Re-vendor by copying the corresponding `ext/<name>/index.js` (or, for `@gcu/sw`, the three
files) from auditable at the pinned (or newer) commit and re-running `npm test`.

## Local patches

These diverge from upstream. Re-applying or dropping them is required on re-vendor — grep for
the marker.

### `@gcu/yaml/index.js` — `PAIOL LOCAL PATCH` (emitter round-trip bug)

**Bug:** the emitter's compact seq-item form (`- key: …` on the dash line) is not
re-parsable by the same strict parser when the first entry's value is itself a block map/seq
— `parse(emit(x))` throws `YamlParseError` rule 7.3. This hits the extremely common shape
`[{ ref: {...}, qty, unit }]`, which paiol's recipe components use, so it broke the at-rest
format round-trip.

**Fix (local):** in `emitSeqItem`, when a map item's *first* value is a block, fall back to
the bare-dash form (`-` alone, full map block below), which the parser accepts. Inline /
scalar-first items keep the compact form.

**Upstream:** the same one-branch guard belongs in `auditable/ext/yaml/src/emit.js`
(`emitSeqItem`, the `nested-map` branch). Once upstream carries it and the bundle is rebuilt,
this local patch can be dropped on re-vendor. Regression test:
`test/yaml-bridge.test.mjs` → "round-trips a sequence of maps whose first value is a nested map".

### `@gcu/sw/register.js` — `PAIOL LOCAL PATCH` (import-shaped comment)

**Bug:** the header's usage example used ES `import … from '@gcu/sw'`. paiol's strip-and-concat
`build.js` scans **raw source (comments included)** for imports and rejects bare specifiers, so
that example comment failed the build (`unexpected bare import "@gcu/sw"`). Only `register.js` is
inlined into the bundle (via `src/pwa.js`), so only it is affected.

**Fix (local):** reworded the one example line to plain prose (no `import … from …`). No behaviour
change. Re-apply on re-vendor, or alternatively teach `build.js` to strip comments before scanning.
