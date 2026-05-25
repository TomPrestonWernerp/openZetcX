# openZetcX Plugin Marketplace Maintenance

The default marketplace is this repository's catalog:

`https://raw.githubusercontent.com/TomPrestonWernerp/openZetcX/main/marketplace.json`

The app also ships the same `marketplace.json` and uses that local copy first when available. Keep the local catalog and the GitHub raw URLs in sync: the local catalog makes the page load quickly, while the raw package URLs are what users install from after the repository is pushed.

## Publish A Plugin

1. Put the plugin source under `plugin-marketplace/examples/<plugin-id>/`.
2. Set `manifest.json` with `id`, `name`, `version`, `description`, `minAppVersion`, and `trust`.
3. Build a zip into `plugin-marketplace/packages/<plugin-id>-<version>.zip`.
4. Compute the zip SHA256.
5. Add or update the plugin entry in `marketplace.json` with:
   - `distribution.kind: "release"`
   - `distribution.packageUrl` pointing to the raw GitHub zip URL
   - `distribution.sha256` matching the package file
   - `readmePath` pointing to the plugin README
6. Run tests, commit, and push. Users will see the new package after the raw GitHub file is available.

## Update A Plugin

1. Edit the plugin source.
2. Bump the plugin version.
3. Create a new zip and SHA256.
4. Add a new item to `versions[]` in `marketplace.json`.
5. Keep older package zips available so existing users can reinstall or recover.

## Secrets

Do not put API tokens, Coze PATs, customer endpoints, or private credentials into marketplace packages. Use local configuration, environment variables, or a private backend proxy.

## Local Testing

For local marketplace testing without pushing to GitHub, place a catalog at:

`${HANA_HOME}/plugin-marketplace/marketplace.json`

or launch with:

`HANA_PLUGIN_MARKETPLACE_FILE=D:\path\to\marketplace.json`

Use `HANA_PLUGIN_MARKETPLACE_URL=https://raw.githubusercontent.com/TomPrestonWernerp/openZetcX/main/marketplace.json` when you specifically want to test the remote GitHub catalog.
