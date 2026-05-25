---
name: openzetcx-brand-guard
description: Preserve openZetcX brand customizations during upstream Git syncs, merge conflict resolution, release preparation, or refactors that may touch assistants, yuan/persona templates, logos, app names, company culture text, plugin marketplace URLs, update metadata, package names, or GitHub release configuration.
---

# openZetcX Brand Guard

Use this skill whenever merging external code into openZetcX or preparing a release where branding must remain stable.

## Workflow

1. Read `OPENZETCX_BRAND_MAINTENANCE.md` first.
2. Inspect the current diff before editing: `git status --short` and targeted `git diff -- <file>`.
3. Preserve these invariants:
   - App/product name stays `openZetcX`.
   - GitHub owner/repo stays `TomPrestonWernerp/openZetcX`.
   - yuan set includes `butter`, `hanako`, `ming`, and `kong`.
   - `hanako` displays as `环环`; `kong` displays as `openZetcX`.
   - `hanako` and `kong` use separate `identity`, `ishiki`, and `yuan` templates.
   - Logo/avatar assets remain the openZetcX assets under `desktop/src` and `.github/assets`.
   - Company culture text remains in locale splash/welcome entries.
4. When conflicts touch brand files, prefer the openZetcX side for naming, assets, yuan templates, marketplace URLs, and update metadata; then re-apply upstream functional changes around that preserved baseline.
5. After edits, run the focused checks:

```powershell
npx vitest run tests/agents-route.test.js tests/yuan-visuals.test.js tests/plugin-marketplace.test.js tests/auto-updater.test.js
npm run typecheck
```

## Critical Files

Load `references/brand-map.md` for the file-by-file map. Keep the list in that reference aligned with `OPENZETCX_BRAND_MAINTENANCE.md`.

## Conflict Heuristics

- If a file contains both `hanako` and `openZetcX`, check whether `openZetcX` means product name, legacy yuan alias, or `kong` display name before changing it.
- If a locale file loses the enterprise culture lines, restore them from the maintenance document.
- If marketplace URLs point outside `TomPrestonWernerp/openZetcX`, restore the openZetcX repo URL and re-check package SHA values.
- If templates are regenerated, verify `lib/identity-templates/kong.md`, `lib/ishiki-templates/kong.md`, and `lib/yuan/kong.md` do not contain环环/ MOOD rules.
- If release scripts change, verify `package.json` still publishes GitHub releases to `TomPrestonWernerp/openZetcX`.

## Release Guard

Before tagging or uploading assets, verify:

```powershell
node -p "require('./package.json').version"
git remote -v
rg -n "TomPrestonWernerp/openZetcX|productName|artifactName|marketplace.json" package.json marketplace.json lib/plugin-marketplace.js
```

