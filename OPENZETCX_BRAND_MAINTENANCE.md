# openZetcX 品牌与助手定制维护指南

本文档用于在合并其它 Git 仓库代码、升级上游功能或解决冲突时，稳定保留 openZetcX 中关于助手、Logo、系统名称和企业文化的定制。

## 维护原则

- 系统名统一保持为 `openZetcX`，不要回退成 Hana、Hanako 或其它上游名称。
- GitHub 仓库统一使用 `TomPrestonWernerp/openZetcX`。
- 助手配置必须保留四个 yuan：`butter` 小省、`hanako` 环环、`ming` 小科、`kong` openZetcX。
- `hanako` 与 `kong` 必须使用独立身份简介和意识模板，不能共用。
- 企业文化文案要保留在启动页、欢迎页和 yuan splash 文案中。
- 插件市场、自动更新和 README 链接都要指向 openZetcX 仓库。

## 关键文件清单

| 模块 | 文件 |
|---|---|
| 应用名、版本、打包名、发布仓库 | `package.json` |
| Windows/macOS/Linux 图标 | `desktop/src/icon.ico`, `desktop/src/icon.icns`, `desktop/src/icon.png` |
| README 品牌图 | `.github/assets/banner.jpg`, `.github/assets/openZetcX-280.png`, `.github/assets/screenshot-main.jpg` |
| 助手头像 | `desktop/src/assets/openZetcX.png`, `Butter.png`, `Ming.png`, `Kong.png` |
| 助手卡片名称与顺序 | `desktop/src/react/settings/tabs/agent/YuanSelector.tsx` |
| 助手视觉映射 | `shared/yuan-visuals.js`, `shared/yuan-visuals.d.ts`, `tests/yuan-visuals.test.js` |
| yuan 名称、企业文化、欢迎语 | `desktop/src/locales/zh.json`, `zh-TW.json`, `en.json`, `ja.json`, `ko.json` |
| 身份简介模板 | `lib/identity-templates/*.md`, `lib/identity-templates/en/*.md` |
| 意识模板 | `lib/ishiki-templates/*.md`, `lib/ishiki-templates/en/*.md` |
| yuan 行为模板 | `lib/yuan/*.md`, `lib/yuan/en/*.md` |
| 新建/切换助手模板刷新 | `core/agent-manager.js`, `server/routes/agents.js`, `tests/agents-route.test.js` |
| 首次启动默认助手 | `core/first-run.js`, `lib/config.example.yaml` |
| 关于页、检查更新文案 | `desktop/src/react/settings/tabs/AboutTab.tsx`, `desktop/src/locales/*.json` |
| 插件市场仓库 | `marketplace.json`, `lib/plugin-marketplace.js`, `PLUGIN_MARKETPLACE_MAINTENANCE.md` |

## 助手定制基线

| yuan | 设置页显示名 | 用途 | 头像 | 身份/意识模板 |
|---|---|---|---|---|
| `butter` | 小省 | 更富有感情 | `Butter.png` | `butter.md` |
| `hanako` | 环环 | 均衡的助手 | `openZetcX.png` | `hanako.md` |
| `ming` | 小科 | 更理性冷静 | `Ming.png` | `ming.md` |
| `kong` | openZetcX | 模型原本的样子 | `Kong.png` | `kong.md` |

注意：

- 旧配置中的 `openZetcX` yuan 是兼容别名，应映射到环环视觉或模板，不应顶替 `kong`。
- 设置页右侧卡片显示的 `openZetcX` 是 `kong`，它必须使用 `kong` 的身份简介、意识和 yuan 行为模板。
- `kong.md` 不应包含环环的 MOOD/陪伴型人格规则。

## 企业文化文案

中文企业文化基线位于 `desktop/src/locales/zh.json` 与 `zh-TW.json` 的 `yuan.splash`：

- 专业专注引领绿色发展
- 科技创新促建生态文明
- 成为备受尊敬的环境服务集成商
- 打造中国知名的环保产业集团
- 技术精湛、服务上乘、管理卓越、绩效一流
- 为客户创造价值！
- 专业、诚信、开放、共赢
- 以创新为动力！
- 拼搏、担当、勤学、协作

合并后如果启动页或欢迎页恢复成上游文案，优先检查 `desktop/src/locales/*.json` 的 `splash`、`yuan.splash`、`yuan.welcome` 和 `settings.about`。

## 合并其它 Git 代码后的检查流程

1. 搜索回退痕迹：

```powershell
rg -n "liliMozi|Hanako|Hana|Project Hana|github.com/liliMozi|channel\\.betaTitle|channel\\.betaMessage" .
```

2. 检查 openZetcX 仓库地址：

```powershell
rg -n "TomPrestonWernerp/openZetcX|raw.githubusercontent.com/TomPrestonWernerp/openZetcX|provider.*github|repo.*openZetcX" package.json marketplace.json lib desktop scripts
```

3. 检查助手模板是否完整：

```powershell
Test-Path lib/identity-templates/hanako.md
Test-Path lib/identity-templates/kong.md
Test-Path lib/ishiki-templates/hanako.md
Test-Path lib/ishiki-templates/kong.md
Test-Path lib/yuan/kong.md
```

4. 跑品牌相关测试：

```powershell
npx vitest run tests/agents-route.test.js tests/yuan-visuals.test.js tests/plugin-marketplace.test.js tests/auto-updater.test.js
npm run typecheck
```

5. 构建前确认版本号：

```powershell
node -p "require('./package.json').version"
```

## 发布检查

版本发布前确认：

- `package.json` 的 `version`、`build.productName`、`build.publish.owner/repo` 正确。
- `marketplace.json` 的 `repository` 和 `packageUrl` 指向 openZetcX 仓库。
- Windows 产物命名为 `openZetcX-<version>-Windows-x64.exe`。
- macOS 产物命名为 `openZetcX-<version>-macOS-<arch>.dmg` 和 `.zip`。
- `dist-server/<os>-<arch>/marketplace.json` 与 `plugin-marketplace/` 已随服务端产物打入。

## 推荐 Skill

以后合并上游或其它 Git 代码时，先显式要求：

```text
Use $openzetcx-brand-guard to merge this branch while preserving openZetcX assistant, logo, system name, culture, marketplace, and release settings.
```

