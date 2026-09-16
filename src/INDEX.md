# `src/`

Laws live in tooling. Do not restate or loosen them here without an explicit request.

- Imports: `biome.json` FSD `overrides` (shared ↛ entities/features/routes; entities ↛ features/routes; barrels only).
- Slice folders: `pnpm check:layout` — `entities/<name>/` and `features/<name>/` need `index.ts`; extra inner dirs only `hooks` | `lib` | `ui` | `i18n`.

Many entities still keep `api.ts` / `hooks.ts` / `store.ts` / `types.ts` at the slice root. That is allowed. New inner **directories** are not.

- `injection/` — overlay; entry `main.tsx`. Not a slice layer.
- `routes/` — TanStack pages. `routeTree.gen.ts` is generated.
- `shared/` — `api`, `ui`, `store`, `lib`, `utils`.

`bindings.ts` is generated from specta. Do not edit.
