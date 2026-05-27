# openZetcX 分支同步指南

本文档用于后续从其它 Git 分支或上游仓库同步代码时，稳定保留 openZetcX 的产品名称、企业 Logo、助手配置、插件市场、自动更新和发布配置。它是普通维护文档，不再作为 Codex Skill 展示。

## 同步前准备

1. 确认当前分支和工作区：

```powershell
git branch --show-current
git status --short
```

2. 拉取远端信息：

```powershell
git fetch --all --tags --prune
```

3. 同步前先记录当前 openZetcX 基线：

```powershell
node -p "require('./package.json').version"
git remote -v
rg -n "TomPrestonWernerp/openZetcX|productName|artifactName|marketplace.json" package.json marketplace.json lib/plugin-marketplace.js
```

## 必须保留的 openZetcX 基线

- 产品名保持为 `openZetcX`。
- npm 包名保持为 `openzetcx`。
- GitHub 发布仓库保持为 `TomPrestonWernerp/openZetcX`。
- Windows 产物命名保持为 `openZetcX-<version>-Windows-x64.exe`。
- 企业 Logo 使用 `desktop/src/icon.ico`、`desktop/src/icon.icns`、`desktop/src/icon.png`。
- README 和界面内的 openZetcX 品牌图不回退成上游默认素材。
- 插件市场、自动更新、README 链接继续指向 openZetcX 仓库。
- 助手配置保留 `butter`、`hanako`、`ming`、`kong`。
- `hanako` 和 `kong` 使用独立 identity、ishiki、yuan 模板，不能互相覆盖。

## 关键文件清单

| 范围 | 文件 |
|---|---|
| 应用名、版本、打包名、发布仓库 | `package.json` |
| Windows/macOS/Linux 图标 | `desktop/src/icon.ico`, `desktop/src/icon.icns`, `desktop/src/icon.png` |
| Windows 图标资源写入 | `scripts/fix-modules.cjs`, `tests/windows-icon-contract.test.js` |
| README 品牌图 | `.github/assets/banner.jpg`, `.github/assets/openZetcX-280.png`, `.github/assets/screenshot-main.jpg` |
| 助手头像 | `desktop/src/assets/openZetcX.png`, `desktop/src/assets/Butter.png`, `desktop/src/assets/Ming.png`, `desktop/src/assets/Kong.png` |
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

## 同步其它分支的推荐流程

1. 新建临时同步分支：

```powershell
git checkout release/0.4.0
git pull --ff-only
git checkout -b sync/<source-branch-name>
```

2. 合并目标分支或上游代码：

```powershell
git merge <source-branch-name>
```

如需从其它远端同步，先添加远端再合并：

```powershell
git remote add upstream <repo-url>
git fetch upstream
git merge upstream/<branch-name>
```

3. 解决冲突时遵循规则：

- 命名、Logo、发布仓库、自动更新、插件市场 URL，以 openZetcX 当前分支为准。
- 功能代码、Bug 修复、依赖升级，尽量吸收目标分支内容。
- 如果同一文件同时包含品牌配置和功能改动，先保留 openZetcX 品牌基线，再手动套入功能改动。
- 不要重新引入已删除的品牌保护 Skill 目录。

4. 合并后搜索回退痕迹：

```powershell
rg -n "liliMozi|Hanako|Hana|Project Hana|github.com/liliMozi|channel\\.betaTitle|channel\\.betaMessage" .
```

5. 检查 openZetcX 仓库地址：

```powershell
rg -n "TomPrestonWernerp/openZetcX|raw.githubusercontent.com/TomPrestonWernerp/openZetcX|provider.*github|repo.*openZetcX" package.json marketplace.json lib desktop scripts
```

6. 检查助手模板是否完整：

```powershell
Test-Path lib/identity-templates/hanako.md
Test-Path lib/identity-templates/kong.md
Test-Path lib/ishiki-templates/hanako.md
Test-Path lib/ishiki-templates/kong.md
Test-Path lib/yuan/kong.md
```

## 发布前检查

运行重点测试：

```powershell
npx vitest run tests/agents-route.test.js tests/yuan-visuals.test.js tests/plugin-marketplace.test.js tests/auto-updater.test.js tests/windows-icon-contract.test.js
npm run typecheck
```

确认版本与产物配置：

```powershell
node -p "require('./package.json').version"
node -p "require('./package.json').build.productName"
node -p "require('./package.json').build.win.artifactName"
```

打包后确认 Windows 主程序和安装包图标都是企业 Logo：

```powershell
Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force dist/icon-verify | Out-Null
[System.Drawing.Icon]::ExtractAssociatedIcon((Resolve-Path dist/win-unpacked/openZetcX.exe)).ToBitmap().Save((Resolve-Path dist/icon-verify).Path + '/app-exe.png')
[System.Drawing.Icon]::ExtractAssociatedIcon((Resolve-Path dist/openZetcX-0.4.0-Windows-x64.exe)).ToBitmap().Save((Resolve-Path dist/icon-verify).Path + '/installer-exe.png')
```

## 发布分支收尾

同步验证通过后，把临时分支合回发布分支：

```powershell
git checkout release/0.4.0
git merge --ff-only sync/<source-branch-name>
git push origin release/0.4.0
```

如果需要更新标签：

```powershell
git tag -f v0.4.0
git push origin v0.4.0 --force
```
