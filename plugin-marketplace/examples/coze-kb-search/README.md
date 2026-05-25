# Coze KB Search

This marketplace package installs a `coze-kb-search` skill into openZetcX.

It is a safe publishing template for the environmental assessment knowledge-base search workflow. Do not commit Coze PAT tokens into this package or into `marketplace.json`; keep tokens in local configuration, environment variables, or a private secrets manager.

## What It Adds

- Skill name: `coze-kb-search`
- Trigger domain: environmental impact assessment, EIA reports, project approval, pollutant permits, and related policy searches
- Distribution: release zip served from the openZetcX Git repository

## Maintenance

1. Edit `skills/coze-kb-search/SKILL.md`.
2. Bump the version in `manifest.json` and `marketplace.json`.
3. Rebuild the zip package under `plugin-marketplace/packages/`.
4. Update the `sha256` value in `marketplace.json`.
5. Push the repo so the raw GitHub URLs become available to users.
