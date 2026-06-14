# vendor/

Vendored `@gcu/*` modules, copied (not submoduled) so paiol stays self-contained and
auditable-forever. Each is the **pre-bundled single-file** `index.js` from the auditable
monorepo, pinned to a known build.

| Module | Source | Pinned to |
|---|---|---|
| `@gcu/yaml` | `auditable/ext/yaml/index.js` | auditable @ `591b719` |
| `@gcu/vfs`  | `auditable/ext/vfs/index.js`  | auditable @ `591b719` |

Re-vendor by copying the corresponding `ext/<name>/index.js` from auditable at the pinned
(or newer) commit and re-running `npm test`.

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
