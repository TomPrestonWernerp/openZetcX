/**
 * auto-updater.cjs — electron-updater 集成
 *
 * 行为：启动时静默检查 → 静默下载 → renderer 展示状态 → 页内触发安装。
 * Windows 安装前先请求 desktop 有界关闭内置 server，再由 NSIS installer
 * 兜底清理残留进程。这样可避免更新后旧 server 继续占用固定端口。
 * 频道：Stable（allowPrerelease=false）/ Preview（allowPrerelease=true）。
 */
const { ipcMain, app, BrowserWindow } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const fs = require("fs");

const CHECK_INTERVAL = 4 * 60 * 60 * 1000; // 4 小时

let _mainWindow = null;
let _setIsUpdating = null;  // 由 main.cjs 注入
let _openZetcXHome = null;     // 由 main.cjs 注入
let _prepareForInstall = null; // 由 main.cjs 注入（有界关闭内置 server）
let _checkTimer = null;
let _ipcHandlersRegistered = false;
let _updaterConfigured = false;
let _installPromise = null;
let _downloadPromise = null;

/**
 * 读 preferences.json 里的 auto_check_updates，默认 true。
 * 不缓存：每次调用都重新读，用户在设置页改完立刻生效，
 * 不用另起一条 main↔server 的 IPC 通道。
 */
function isAutoCheckEnabled() {
  try {
    const prefsPath = path.join(_openZetcXHome || "", "user", "preferences.json");
    const prefs = JSON.parse(fs.readFileSync(prefsPath, "utf-8"));
    return prefs.auto_check_updates !== false;
  } catch {
    return true;
  }
}

// ── 状态管理（保持与前端 AutoUpdateState 契约一致）──

let _updateState = {
  status: "idle",       // idle | checking | available | downloading | downloaded | installing | error | latest
  version: null,
  releaseNotes: null,
  releaseUrl: null,
  downloadUrl: null,
  progress: null,
  error: null,
};

function getState() {
  return { ..._updateState };
}

function logUpdate(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  try { console.log(`[auto-updater] ${message}`); } catch {}
  if (!_openZetcXHome) return;
  try {
    const logDir = path.join(_openZetcXHome, "logs");
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, "auto-update.log"), line + "\n", "utf-8");
  } catch {}
}

function isMissingLatestMetadataError(err) {
  const message = err?.message || String(err || "");
  return (
    /\blatest(?:-mac)?\.ya?ml\b/i.test(message)
    && /(cannot find|not found|missing|404)/i.test(message)
  );
}

function getRendererWindows() {
  const windows = [];
  try {
    if (BrowserWindow?.getAllWindows) windows.push(...BrowserWindow.getAllWindows());
  } catch {}
  if (windows.length === 0 && _mainWindow) windows.push(_mainWindow);
  return [...new Set(windows)].filter(win => {
    try { return win && !win.isDestroyed?.(); } catch { return false; }
  });
}

function sendToRenderer(channel, data) {
  for (const win of getRendererWindows()) {
    try {
      win.webContents?.send?.(channel, data);
    } catch {}
  }
}

function setState(patch) {
  Object.assign(_updateState, patch);
  sendToRenderer("auto-update-state", getState());
}

function resetState() {
  _updateState = {
    status: "idle", version: null, releaseNotes: null,
    releaseUrl: null, downloadUrl: null, progress: null, error: null,
  };
}

function getQuitAndInstallOptions() {
  return {
    isSilent: process.platform !== "win32",
    isForceRunAfter: true,
  };
}

function invokeQuitAndInstallSoon() {
  return new Promise((resolve) => {
    setImmediate(() => {
      try {
        const { isSilent, isForceRunAfter } = getQuitAndInstallOptions();
        logUpdate(`quitAndInstall invoked: silent=${isSilent}, forceRunAfter=${isForceRunAfter}`);
        autoUpdater.quitAndInstall(isSilent, isForceRunAfter);
        resolve(true);
      } catch (err) {
        const msg = err?.message || String(err);
        logUpdate(`install failed before quitAndInstall: ${msg}`);
        if (_setIsUpdating) _setIsUpdating(false);
        setState({ status: "error", error: msg });
        resolve(false);
      }
    });
  });
}

async function installDownloadedUpdate(source = "manual") {
  if (_updateState.status === "installing") return true;
  if (_updateState.status !== "downloaded") {
    logUpdate(`install ignored: status=${_updateState.status}, source=${source}`);
    return false;
  }
  if (_installPromise) return _installPromise;

  _installPromise = (async () => {
    const version = _updateState.version;
    logUpdate(`install requested: source=${source}, version=${version || "unknown"}`);
    if (_setIsUpdating) _setIsUpdating(true);
    setState({ status: "installing", version, progress: null, error: null });

    try {
      if (_prepareForInstall) {
        try {
          logUpdate("preparing runtime for update install");
          await _prepareForInstall();
          logUpdate("runtime prepared for update install");
        } catch (err) {
          // The NSIS process cleanup remains the final fallback. Do not strand
          // a fully downloaded update if graceful server shutdown failed.
          logUpdate(`runtime prepare failed; continuing with installer cleanup: ${err?.message || String(err)}`);
        }
      }
      // Defer one tick so the IPC/state handoff finishes before electron-updater
      // closes windows and starts the NSIS installer.
      return await invokeQuitAndInstallSoon();
    } finally {
      _installPromise = null;
    }
  })();

  return _installPromise;
}

// ── 磁盘空间检查 ──

async function hasSufficientDiskSpace(checkPath, minMB) {
  try {
    const stats = await fs.promises.statfs(checkPath);
    const availableBytes = stats.bavail * stats.bsize;
    return availableBytes >= minMB * 1024 * 1024;
  } catch {
    return true; // statfs 失败时不阻塞更新
  }
}

// ── macOS DMG 挂载检测 ──

function isRunningFromDmg() {
  if (process.platform !== "darwin") return false;
  return app.getPath("exe").startsWith("/Volumes/");
}

// ── 缓存清理 ──

async function cleanUpdateCache() {
  const dataDir = _openZetcXHome;
  const versionFile = path.join(dataDir, "last-update-version");

  // 迁移：旧版 bug 把 last-update-version 写到了 ~/.openZetcX-dev/（生产环境误用）
  // 搬过来后尝试清理孤儿目录
  try {
    const wrongDir = path.join(require("os").homedir(), ".openZetcX-dev");
    if (wrongDir !== dataDir) {
      const wrongFile = path.join(wrongDir, "last-update-version");
      if (fs.existsSync(wrongFile)) {
        if (!fs.existsSync(versionFile)) {
          fs.mkdirSync(path.dirname(versionFile), { recursive: true });
          fs.renameSync(wrongFile, versionFile);
        } else {
          fs.unlinkSync(wrongFile);
        }
        // 目录空了就删掉
        try { fs.rmdirSync(wrongDir); } catch {} // rmdirSync 非空会失败，正好
        console.log("[auto-updater] 已清理旧版误写的 ~/.openZetcX-dev/last-update-version");
      }
    }
  } catch {}
  const currentVersion = app.getVersion();

  let shouldClean = false;

  // 条件 1：版本变化（刚完成更新）
  try {
    const lastVersion = fs.readFileSync(versionFile, "utf-8").trim();
    if (lastVersion !== currentVersion) shouldClean = true;
  } catch {
    // 文件不存在，首次运行
  }

  // 写入当前版本
  try {
    fs.mkdirSync(path.dirname(versionFile), { recursive: true });
    fs.writeFileSync(versionFile, currentVersion);
  } catch {}

  // 条件 2：缓存过大（> 500MB）
  if (!shouldClean) {
    const cacheDir = path.join(app.getPath("userData"), "pending");
    try {
      const size = await dirSize(cacheDir);
      if (size > 500 * 1024 * 1024) shouldClean = true;
    } catch {}
  }

  if (shouldClean) {
    const cacheDir = path.join(app.getPath("userData"), "pending");
    try {
      await fs.promises.rm(cacheDir, { recursive: true, force: true });
      console.log("[auto-updater] 已清理更新缓存");
    } catch {}
  }
}

async function dirSize(dir) {
  let total = 0;
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isFile()) {
        const stat = await fs.promises.stat(full);
        total += stat.size;
      } else if (entry.isDirectory()) {
        total += await dirSize(full);
      }
    }
  } catch {}
  return total;
}

// ── electron-updater 配置 ──

function setupAutoUpdater() {
  // 显式设置 feed URL，不依赖 app-update.yml（electron-builder --dir 不生成该文件）
  autoUpdater.setFeedURL({
    provider: "github",
    owner: "TomPrestonWernerp",
    repo: "openZetcX",
  });

  autoUpdater.autoDownload = false;          // 由我们控制（磁盘空间检查后手动触发）
  autoUpdater.autoInstallOnAppQuit = false;  // 只在用户明确点击"重启更新"时安装
  autoUpdater.allowPrerelease = false;       // 由频道控制
  // 开发版也允许真实访问 GitHub Release。发现更新后沿用自动下载流程，
  // 下载完成后仍由用户确认，再立即安装并重启。
  autoUpdater.forceDevUpdateConfig = !app.isPackaged;
  autoUpdater.disableDifferentialDownload = true;
  if (process.platform === "win32") {
    autoUpdater.installDirectory = path.dirname(app.getPath("exe"));
  }

  // ── 事件 → 状态映射 ──

  autoUpdater.on("checking-for-update", () => {
    logUpdate("checking for update");
    setState({ status: "checking", progress: null, error: null });
  });

  autoUpdater.on("update-available", (info) => {
    logUpdate(`update available: version=${info.version || "unknown"}`);
    setState({
      status: "available",
      version: info.version,
      progress: null,
      error: null,
      releaseNotes: typeof info.releaseNotes === "string"
        ? info.releaseNotes
        : Array.isArray(info.releaseNotes)
          ? info.releaseNotes.map(n => n.note || n).join("\n")
          : null,
    });

    downloadAvailableUpdate("automatic").catch(() => {});
  });

  autoUpdater.on("download-progress", (progress) => {
    setState({
      status: "downloading",
      progress: {
        percent: Math.round(progress.percent),
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total,
      },
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    logUpdate(`update downloaded: version=${info.version || "unknown"}`);
    setState({
      status: "downloaded",
      version: info.version,
      progress: null,
    });
  });

  autoUpdater.on("update-not-available", () => {
    logUpdate("update not available");
    setState({ status: "latest" });
  });

  autoUpdater.on("error", (err) => {
    if (isMissingLatestMetadataError(err)) {
      logUpdate(`update metadata not ready; treating as no update available: ${err?.message || String(err)}`);
      if (_updateState.status === "installing" && _setIsUpdating) _setIsUpdating(false);
      setState({ status: "latest", error: null, progress: null });
      return;
    }
    // 下载中出错才设 error，idle/latest 状态的检查失败静默忽略
    if (_updateState.status !== "idle" && _updateState.status !== "latest") {
      logUpdate(`error: ${err?.message || String(err)}`);
      if (_updateState.status === "installing" && _setIsUpdating) _setIsUpdating(false);
      setState({ status: "error", error: err?.message || String(err) });
    }
  });
}

async function downloadAvailableUpdate(source = "manual") {
  if (_updateState.status === "downloading" || _updateState.status === "downloaded") return true;
  if (_updateState.status !== "available") {
    logUpdate(`download ignored: status=${_updateState.status}, source=${source}`);
    return false;
  }
  if (_downloadPromise) return _downloadPromise;

  _downloadPromise = (async () => {
    const version = _updateState.version;
    const ok = await hasSufficientDiskSpace(app.getPath("userData"), 500);
    if (!ok) {
      logUpdate(`download blocked: insufficient disk space, version=${version || "unknown"}`);
      setState({ status: "error", error: "disk_space_insufficient", version });
      return false;
    }

    logUpdate(`download requested: source=${source}, version=${version || "unknown"}`);
    setState({
      status: "downloading",
      version,
      error: null,
      progress: {
        percent: 0,
        bytesPerSecond: 0,
        transferred: 0,
        total: 0,
      },
    });

    try {
      await autoUpdater.downloadUpdate();
      return true;
    } catch (err) {
      const message = err?.message || String(err);
      logUpdate(`download failed: ${message}`);
      setState({ status: "error", error: message, version, progress: null });
      return false;
    }
  })().finally(() => {
    _downloadPromise = null;
  });

  return _downloadPromise;
}

// ── IPC handlers ──

function registerIpcHandlers() {
  if (_ipcHandlersRegistered) return;
  _ipcHandlersRegistered = true;
  ipcMain.handle("auto-update-check", async () => {
    if (_updateState.status === "installing") return getState();
    resetState();
    setState({ status: "checking", error: null, progress: null });
    try {
      const result = await autoUpdater.checkForUpdates();
      if (!result && _updateState.status === "checking") {
        setState({ status: "latest", error: null, progress: null });
      }
    } catch (err) {
      if (isMissingLatestMetadataError(err)) {
        setState({ status: "latest", error: null, progress: null });
      } else {
        setState({ status: "error", error: err?.message || String(err) });
      }
    }
    return getState();
  });

  ipcMain.handle("auto-update-download", async () => {
    return downloadAvailableUpdate("manual");
  });

  ipcMain.handle("auto-update-install", async () => {
    return installDownloadedUpdate("manual");
  });

  ipcMain.handle("auto-update-state", () => getState());

  ipcMain.handle("auto-update-set-channel", (_event, channel) => {
    autoUpdater.allowPrerelease = (channel === "beta");
  });
}

// ── 定时轮询 ──

function startPolling() {
  if (_checkTimer) return;
  _checkTimer = setInterval(() => {
    // 每 tick 都重新读 preferences：用户关掉开关后，下一 tick 就不再自动查
    if (!isAutoCheckEnabled()) return;
    autoUpdater.checkForUpdates().catch(() => {});
  }, CHECK_INTERVAL);
}

// ── 公共 API ──

function initAutoUpdater(mainWindow, {
  setIsUpdating, openZetcXHome, prepareForInstall,
} = {}) {
  _mainWindow = mainWindow;
  _setIsUpdating = setIsUpdating;
  _openZetcXHome = openZetcXHome;
  if (prepareForInstall !== undefined) {
    _prepareForInstall = typeof prepareForInstall === "function" ? prepareForInstall : null;
  }

  registerIpcHandlers(); // IPC handlers 是进程级单例，重复 init 时直接复用

  // macOS：从 DMG 直接运行时禁用
  if (isRunningFromDmg()) {
    setState({ status: "error", error: "running_from_dmg" });
    return;
  }

  if (_updaterConfigured) return;
  _updaterConfigured = true;

  // 缓存清理（异步，不阻塞启动）
  cleanUpdateCache().catch(() => {});

  setupAutoUpdater();
  // 定时轮询 handler 自己判断开关，直接起 timer 不需要外层判断
  startPolling();
}

async function checkForUpdatesAuto() {
  if (isRunningFromDmg()) return;
  // 用户关了自动检查开关：启动时也不自动 check
  if (!isAutoCheckEnabled()) return;
  try {
    await autoUpdater.checkForUpdates();
  } catch {}
}

function setUpdateChannel(channel) {
  autoUpdater.allowPrerelease = (channel === "beta");
}

function setMainWindow(win) {
  _mainWindow = win;
}

module.exports = {
  initAutoUpdater,
  checkForUpdatesAuto,
  setMainWindow,
  setUpdateChannel,
  getState,
  downloadAvailableUpdate,
  installDownloadedUpdate,
};
