# openZetcX 本地二开说明

## 推荐工具

推荐优先使用 VSCode。这个项目是 Electron + React + TypeScript + Vite，前端样式、主进程、服务端代码都在同一个 Node 工程里，VSCode 的 TypeScript、ESLint、终端任务和 Electron 调试更顺手。

IDEA 也能打开，但更适合作为普通代码编辑器使用；如果主要改 React 页面和 CSS，VSCode 更合适。

## 环境要求

- Node.js 20 或更高版本，本机已验证 Node.js v22.15.0 可用。
- npm 11 可用。
- Windows 打包需要 Visual Studio 2022 C++ Build Tools，本机已能成功编译 `hana-win-sandbox.exe`。
- macOS 打包必须在 macOS 上执行；Windows 不能直接产出可签名的 `.app` / `.dmg`。

## 首次安装

```powershell
cd "D:\E\浙江省环境科技项目\openZetcX\openZetcX"
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
npm install
```

仓库内已配置 npm registry 为 npmmirror，可减少国内网络下依赖安装失败。Electron 二进制下载建议通过上面的环境变量指定镜像。

## 本地开发启动

普通开发启动：

```powershell
npm run start:dev
```

需要前端 HMR 时，开两个终端：

```powershell
npm run dev:renderer
```

另一个终端：

```powershell
npm run start:vite
```

VSCode 里也可以直接使用：

- `Terminal > Run Task > start:dev`
- `Run and Debug > Electron: start:dev`
- HMR 模式先运行任务 `dev:renderer`，再运行调试项 `Electron: Vite HMR`

## 常改位置

- 主界面入口：`desktop/src/react/App.tsx`
- React 组件：`desktop/src/react/components/`
- 全局样式：`desktop/src/styles.css`
- 主题样式：`desktop/src/themes/`
- 设置页：`desktop/src/settings-main.tsx` 和 `desktop/src/react/settings/`
- Electron 主进程：`desktop/main.cjs`
- 服务端接口：`server/`
- 多语言文案：`desktop/src/locales/`
- 应用图标：`desktop/src/icon.png`、`desktop/src/icon.ico`、`desktop/src/icon.icns`

## 校验命令

```powershell
npm run typecheck
npm run build:client
```

当前本机已验证这两个命令通过。

`npm test` 当前测试数量很多，且在本机存在 worker 长时间不退出的情况；二开时建议先跑你改动相关的单测文件，例如：

```powershell
npx vitest run tests/某个测试文件.test.js
```

## Windows 打包 exe

推荐命令：

```powershell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
$env:NODE_OPTIONS="--max-old-space-size=8192"
npm run dist:win
```

产物位置通常是：

- 解压版：`dist/win-unpacked/openZetcX.exe`
- 安装包：`dist/openZetcX-版本号-Windows-x64.exe`

如果只想快速确认能不能跑，可先看 `dist/win-unpacked/openZetcX.exe`。安装包生成依赖 electron-builder / NSIS，耗时会明显更长。

如果 `dist:win` 已经生成了 `dist/win-unpacked/`，但完整命令在 NSIS 安装包阶段中断，可以单独补打安装包：

```powershell
$env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
$env:NODE_OPTIONS="--max-old-space-size=8192"
npx electron-builder --win nsis --prepackaged dist\win-unpacked
```

## macOS 打包 app / dmg

需要在 macOS 上执行：

```bash
npm install
npm run dist
```

产物通常在：

- `dist/mac-arm64/openZetcX.app` 或 `dist/mac/openZetcX.app`
- `dist/openZetcX-版本号-macOS-arm64.dmg`

如果没有 Apple Developer ID，只能做本地未公证包；给别人分发时，macOS 可能提示安全风险。正式分发需要配置 Apple 签名和 notarize 环境变量。
