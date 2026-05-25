# openZetcX Brand Map

Use this reference when a merge or refactor touches brand-sensitive files.

## Product Name And Release

- `package.json`
  - `name`: `openzetcx`
  - `version`: release version, currently `0.3.0`
  - `build.productName`: `openZetcX`
  - `build.publish.owner`: `TomPrestonWernerp`
  - `build.publish.repo`: `openZetcX`
  - `build.mac.artifactName`: `${productName}-${version}-macOS-${arch}.${ext}`
  - `build.win.artifactName`: `${productName}-${version}-Windows-${arch}.${ext}`
- `desktop/main.cjs`
  - Window titles, tray labels, crash/update dialogs use `openZetcX`.
- `desktop/auto-updater.cjs`
  - Keep update provider compatible with package publish config.

## Logos And Assets

- App icons:
  - `desktop/src/icon.ico`
  - `desktop/src/icon.icns`
  - `desktop/src/icon.png`
- Assistant avatars:
  - `desktop/src/assets/openZetcX.png`
  - `desktop/src/assets/Butter.png`
  - `desktop/src/assets/Ming.png`
  - `desktop/src/assets/Kong.png`
- README/marketing assets:
  - `.github/assets/banner.jpg`
  - `.github/assets/openZetcX-280.png`
  - `.github/assets/screenshot-main.jpg`

## Assistant And Yuan Mapping

- `desktop/src/react/settings/tabs/agent/YuanSelector.tsx`
  - `hanako`: display `环环`
  - `openZetcX`: legacy display `环环`
  - `butter`: display `小省`
  - `ming`: display `小科`
  - `kong`: display `openZetcX`
- `shared/yuan-visuals.js`
  - `hanako` and legacy `openZetcX` should point to the ring/assistant avatar.
  - `kong` should point to `Kong.png` and use raw-model visual metadata.
- `tests/yuan-visuals.test.js`
  - Update when changing yuan visuals.

## Persona Templates

- Identity:
  - `lib/identity-templates/hanako.md`
  - `lib/identity-templates/kong.md`
  - `lib/identity-templates/en/hanako.md`
  - `lib/identity-templates/en/kong.md`
- Ishiki:
  - `lib/ishiki-templates/hanako.md`
  - `lib/ishiki-templates/kong.md`
  - `lib/ishiki-templates/en/hanako.md`
  - `lib/ishiki-templates/en/kong.md`
- Yuan behavior:
  - `lib/yuan/openZetcX.md`: legacy/ring behavior
  - `lib/yuan/kong.md`: raw openZetcX model behavior
  - `lib/yuan/en/openZetcX.md`
  - `lib/yuan/en/kong.md`

`server/routes/agents.js` and `core/agent-manager.js` copy these templates when yuan changes or a new assistant is created.

## Enterprise Culture

Locale files:

- `desktop/src/locales/zh.json`
- `desktop/src/locales/zh-TW.json`
- `desktop/src/locales/en.json`
- `desktop/src/locales/ja.json`
- `desktop/src/locales/ko.json`

Check keys:

- `yuan.types`
- `yuan.splash`
- `yuan.welcome`
- `splash`
- `settings.about`
- `dialog`, `tray`, and update strings

Chinese culture lines to preserve:

- 专业专注引领绿色发展
- 科技创新促建生态文明
- 成为备受尊敬的环境服务集成商
- 打造中国知名的环保产业集团
- 技术精湛、服务上乘、管理卓越、绩效一流
- 为客户创造价值！
- 专业、诚信、开放、共赢
- 以创新为动力！
- 拼搏、担当、勤学、协作

## Plugin Marketplace

- `marketplace.json`
- `lib/plugin-marketplace.js`
- `PLUGIN_MARKETPLACE_MAINTENANCE.md`
- `plugin-marketplace/examples/**`
- `plugin-marketplace/packages/**`

All public URLs should point to `TomPrestonWernerp/openZetcX`.

