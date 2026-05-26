# openZetcX Brand Guard

这个目录是一套用于保护 openZetcX 品牌定制的 Codex Skill。它的目标不是新增业务功能，而是在合并上游代码、处理冲突、重构品牌相关文件、准备发布版本时，提醒 Codex 保留 openZetcX 自己的命名、助手设定、图标资产、插件市场地址和 GitHub 发布配置。

## 适用场景

在下面这些任务中应该启用这个 skill：

- 合并外部仓库或上游分支代码。
- 解决涉及品牌、助手、启动页、欢迎页、图标、发布配置的冲突。
- 修改 `package.json`、自动更新、GitHub Release、插件市场相关配置。
- 调整 yuan/助手模板、头像、默认助手、企业文化文案。
- 发布前做版本、产物命名、仓库地址、插件市场 URL 的检查。

典型提示词：

```text
Use $openzetcx-brand-guard to merge this branch while preserving openZetcX assistant, logo, system name, culture, marketplace, and release settings.
```

## 目录结构

```text
openzetcx-brand-guard/
├─ SKILL.md
├─ README.md
├─ agents/
│  └─ openai.yaml
└─ references/
   └─ brand-map.md
```

- `SKILL.md`：Codex 实际加载的工作说明，包含触发描述、核心流程、冲突处理原则和发布前检查命令。
- `references/brand-map.md`：品牌敏感文件地图，列出产品名、发布配置、图标、助手/yuan 映射、模板、企业文化文案、插件市场等关键位置。
- `agents/openai.yaml`：给 skill 列表/卡片展示用的 UI 元数据。
- `README.md`：给维护者看的说明文档，不参与 Codex 运行时触发。

## 核心保护项

这个 skill 主要保护以下不变量：

- 应用/产品名保持为 `openZetcX`。
- GitHub 仓库保持为 `TomPrestonWernerp/openZetcX`。
- yuan 集合保留 `butter`、`hanako`、`ming`、`kong`。
- `hanako` 和 `kong` 必须使用独立的 identity、ishiki、yuan 模板，不能互相覆盖。
- `kong` 在设置页显示为 `openZetcX`，但它代表的是独立的 raw/model 风格助手，不等同于旧的 `openZetcX` 兼容别名。
- 图标、头像、README 展示图继续使用 openZetcX 资产。
- 启动页、欢迎页、关于页、yuan 文案中的企业文化内容不能被上游文案覆盖。
- 插件市场 URL、更新配置、发布产物命名必须指向 openZetcX 仓库与 openZetcX 产品名。

## 推荐工作流程

1. 先阅读仓库根目录的 `OPENZETCX_BRAND_MAINTENANCE.md`。
2. 查看当前工作区差异：

```powershell
git status --short
git diff -- <file>
```

3. 如果改动涉及品牌敏感文件，再加载 `references/brand-map.md` 对照检查。
4. 冲突处理时，以 openZetcX 当前品牌基线为准，再把上游的功能性改动重新套回去。
5. 发布前执行针对性检查，确认版本、远端、产物名、市场配置没有回退。

## 重点文件范围

优先检查这些区域：

- `package.json`
- `desktop/main.cjs`
- `desktop/auto-updater.cjs`
- `desktop/src/icon.ico`
- `desktop/src/icon.icns`
- `desktop/src/icon.png`
- `desktop/src/assets/openZetcX.png`
- `desktop/src/assets/Butter.png`
- `desktop/src/assets/Ming.png`
- `desktop/src/assets/Kong.png`
- `desktop/src/react/settings/tabs/agent/YuanSelector.tsx`
- `shared/yuan-visuals.js`
- `desktop/src/locales/*.json`
- `lib/identity-templates/**`
- `lib/ishiki-templates/**`
- `lib/yuan/**`
- `core/agent-manager.js`
- `server/routes/agents.js`
- `marketplace.json`
- `lib/plugin-marketplace.js`
- `PLUGIN_MARKETPLACE_MAINTENANCE.md`

完整文件地图以 `references/brand-map.md` 为准。

## 检查命令

品牌相关改动后，建议先跑：

```powershell
npx vitest run tests/agents-route.test.js tests/yuan-visuals.test.js tests/plugin-marketplace.test.js tests/auto-updater.test.js
npm run typecheck
```

发布前再确认：

```powershell
node -p "require('./package.json').version"
git remote -v
rg -n "TomPrestonWernerp/openZetcX|productName|artifactName|marketplace.json" package.json marketplace.json lib/plugin-marketplace.js
```

## 维护建议

- 如果新增品牌敏感文件，先更新 `references/brand-map.md`，再补充 `SKILL.md` 的关键规则。
- 如果改了 skill 的定位或触发场景，需要同步更新 `SKILL.md` frontmatter 的 `description`。
- 如果 `SKILL.md` 的展示名称或默认提示词变化，需要同步检查 `agents/openai.yaml`。
- `README.md` 只作为人工审阅说明；真正给 Codex 执行的规则仍以 `SKILL.md` 和 `references/brand-map.md` 为准。

