import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "module";
import fs from "fs";
import os from "os";
import path from "path";

const require = createRequire(import.meta.url);

const {
  applyGpuStartupPolicy,
  buildGpuStartupDiagnostics,
  markGpuStartupFailed,
  markGpuStartupPending,
  markGpuStartupPhase,
  markGpuStartupReady,
  recordGpuChildProcessGone,
  resolveGpuStartupPolicy,
} = require("../desktop/src/shared/gpu-startup-policy.cjs");

let root;

function makeHome() {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "hana-gpu-policy-"));
  return root;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function writePrefs(openZetcXHome, prefs) {
  const prefsPath = path.join(openZetcXHome, "user", "preferences.json");
  fs.mkdirSync(path.dirname(prefsPath), { recursive: true });
  fs.writeFileSync(prefsPath, JSON.stringify(prefs, null, 2) + "\n", "utf-8");
}

function writeGpuState(openZetcXHome, state) {
  const statePath = path.join(openZetcXHome, "user", "gpu-startup.json");
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n", "utf-8");
}

function readPrefs(openZetcXHome) {
  try {
    return readJson(path.join(openZetcXHome, "user", "preferences.json"));
  } catch {
    return {};
  }
}

describe("desktop GPU startup policy", () => {
  beforeEach(() => {
    root = null;
  });

  afterEach(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it("keeps hardware acceleration enabled by default", () => {
    const openZetcXHome = makeHome();

    const policy = resolveGpuStartupPolicy({
      openZetcXHome,
      platform: "win32",
      argv: ["Hanako.exe"],
      env: {},
    });

    expect(policy.hardwareAccelerationEnabled).toBe(true);
    expect(policy.shouldDisableHardwareAcceleration).toBe(false);
    expect(policy.reason).toBe("default");
  });

  it("honors the user hardware acceleration preference", () => {
    const openZetcXHome = makeHome();
    writePrefs(openZetcXHome, { hardware_acceleration: false });

    const policy = resolveGpuStartupPolicy({
      openZetcXHome,
      platform: "win32",
      argv: ["Hanako.exe"],
      env: {},
    });

    expect(policy.hardwareAccelerationEnabled).toBe(false);
    expect(policy.shouldDisableHardwareAcceleration).toBe(true);
    expect(policy.reason).toBe("preference");
  });

  it("migrates legacy automatic safe mode preferences into GPU sandbox compatibility", () => {
    const openZetcXHome = makeHome();
    writePrefs(openZetcXHome, { locale: "zh-CN", hardware_acceleration: false });
    writeGpuState(openZetcXHome, {
      version: 1,
      safeMode: {
        enabled: true,
        reason: "previous-startup-incomplete",
        previousStartup: { status: "pending", phase: "launching-splash" },
        updatedAt: "2026-05-19T01:00:00.000Z",
      },
    });

    const policy = resolveGpuStartupPolicy({
      openZetcXHome,
      platform: "win32",
      argv: ["Hanako.exe"],
      env: {},
      now: "2026-05-21T01:00:00.000Z",
    });

    expect(policy.mode).toBe("gpu-sandbox-compat");
    expect(policy.hardwareAccelerationEnabled).toBe(true);
    expect(policy.reason).toBe("legacy-auto-safe-mode-migration");
    expect(readPrefs(openZetcXHome)).toEqual({ locale: "zh-CN" });
    expect(readJson(path.join(openZetcXHome, "user", "gpu-startup.json")).autoGpuMode).toMatchObject({
      mode: "gpu-sandbox-compat",
      reason: "legacy-auto-safe-mode-migration",
      previousMode: "software-safe",
    });
  });

  it("turns on GPU sandbox compatibility on Windows after an incomplete early startup", () => {
    const openZetcXHome = makeHome();
    markGpuStartupPending({
      openZetcXHome,
      platform: "win32",
      phase: "launching-splash",
      startupId: "previous-launch",
      now: "2026-05-19T01:00:00.000Z",
    });

    const policy = resolveGpuStartupPolicy({
      openZetcXHome,
      platform: "win32",
      argv: ["Hanako.exe"],
      env: {},
      now: "2026-05-19T01:01:00.000Z",
    });

    expect(policy.hardwareAccelerationEnabled).toBe(true);
    expect(policy.shouldDisableHardwareAcceleration).toBe(false);
    expect(policy.shouldApplyGpuSandboxCompatSwitches).toBe(true);
    expect(policy.mode).toBe("gpu-sandbox-compat");
    expect(policy.reason).toBe("previous-startup-incomplete");
    expect(readPrefs(openZetcXHome).hardware_acceleration).toBeUndefined();
    const state = readJson(path.join(openZetcXHome, "user", "gpu-startup.json"));
    expect(state.autoGpuMode).toMatchObject({
      mode: "gpu-sandbox-compat",
      reason: "previous-startup-incomplete",
    });
  });

  it("does not turn a stale server startup marker into GPU recovery", () => {
    const openZetcXHome = makeHome();
    markGpuStartupPending({
      openZetcXHome,
      platform: "win32",
      phase: "electron-starting",
      startupId: "previous-launch",
      now: "2026-05-19T01:00:00.000Z",
    });
    const statePath = path.join(openZetcXHome, "user", "gpu-startup.json");
    const state = readJson(statePath);
    state.startup.phase = "server-starting";
    delete state.startup.gpuRecovery;
    writeGpuState(openZetcXHome, state);

    const policy = resolveGpuStartupPolicy({
      openZetcXHome,
      platform: "win32",
      argv: ["Hanako.exe"],
      env: {},
      now: "2026-05-19T01:01:00.000Z",
    });

    expect(policy.mode).toBe("hardware");
    expect(policy.hardwareAccelerationEnabled).toBe(true);
    expect(policy.reason).toBe("default");
    expect(readJson(statePath).autoGpuMode).toBeUndefined();
  });

  it("clears pre-UI GPU recovery eligibility when startup reaches server without visible UI", () => {
    const openZetcXHome = makeHome();
    markGpuStartupPending({
      openZetcXHome,
      platform: "win32",
      phase: "electron-starting",
      startupId: "previous-launch",
      now: "2026-05-19T01:00:00.000Z",
    });
    markGpuStartupPhase({
      openZetcXHome,
      platform: "win32",
      phase: "server-starting",
      startupId: "previous-launch",
      now: "2026-05-19T01:00:01.000Z",
    });

    const policy = resolveGpuStartupPolicy({
      openZetcXHome,
      platform: "win32",
      argv: ["Hanako.exe"],
      env: {},
      now: "2026-05-19T01:01:00.000Z",
    });

    const state = readJson(path.join(openZetcXHome, "user", "gpu-startup.json"));
    expect(policy.mode).toBe("hardware");
    expect(policy.reason).toBe("default");
    expect(state.startup.gpuRecovery).toMatchObject({
      eligible: false,
      phase: null,
    });
    expect(state.autoGpuMode).toBeUndefined();
  });

  it("preserves GPU recovery eligibility when server startup follows a visible splash", () => {
    const openZetcXHome = makeHome();
    markGpuStartupPending({
      openZetcXHome,
      platform: "win32",
      phase: "electron-starting",
      startupId: "previous-launch",
      now: "2026-05-19T01:00:00.000Z",
    });
    markGpuStartupPhase({
      openZetcXHome,
      platform: "win32",
      phase: "launching-splash",
      startupId: "previous-launch",
      now: "2026-05-19T01:00:01.000Z",
    });
    markGpuStartupPhase({
      openZetcXHome,
      platform: "win32",
      phase: "splash-ready",
      startupId: "previous-launch",
      now: "2026-05-19T01:00:02.000Z",
    });
    markGpuStartupPhase({
      openZetcXHome,
      platform: "win32",
      phase: "server-starting",
      startupId: "previous-launch",
      now: "2026-05-19T01:00:03.000Z",
    });
    markGpuStartupPhase({
      openZetcXHome,
      platform: "win32",
      phase: "server-ready",
      startupId: "previous-launch",
      now: "2026-05-19T01:00:04.000Z",
    });

    const policy = resolveGpuStartupPolicy({
      openZetcXHome,
      platform: "win32",
      argv: ["Hanako.exe"],
      env: {},
      now: "2026-05-19T01:01:00.000Z",
    });

    const state = readJson(path.join(openZetcXHome, "user", "gpu-startup.json"));
    expect(policy.mode).toBe("gpu-sandbox-compat");
    expect(policy.reason).toBe("previous-startup-incomplete");
    expect(state.autoGpuMode).toMatchObject({
      mode: "gpu-sandbox-compat",
      reason: "previous-startup-incomplete",
      previousStartup: expect.objectContaining({
        phase: "server-ready",
        gpuRecovery: expect.objectContaining({
          eligible: true,
          phase: "splash-ready",
        }),
      }),
    });
  });

  it("re-enables GPU recovery eligibility when hidden startup creates the main window after server boot", () => {
    const openZetcXHome = makeHome();
    markGpuStartupPending({
      openZetcXHome,
      platform: "win32",
      phase: "electron-starting",
      startupId: "hidden-launch",
      now: "2026-05-19T01:00:00.000Z",
    });
    markGpuStartupPhase({
      openZetcXHome,
      platform: "win32",
      phase: "server-starting",
      startupId: "hidden-launch",
      now: "2026-05-19T01:00:01.000Z",
    });
    markGpuStartupPhase({
      openZetcXHome,
      platform: "win32",
      phase: "server-ready",
      startupId: "hidden-launch",
      now: "2026-05-19T01:00:02.000Z",
    });
    markGpuStartupPhase({
      openZetcXHome,
      platform: "win32",
      phase: "main-window-created",
      startupId: "hidden-launch",
      now: "2026-05-19T01:00:03.000Z",
    });

    const policy = resolveGpuStartupPolicy({
      openZetcXHome,
      platform: "win32",
      argv: ["Hanako.exe"],
      env: {},
      now: "2026-05-19T01:01:00.000Z",
    });

    const state = readJson(path.join(openZetcXHome, "user", "gpu-startup.json"));
    expect(policy.mode).toBe("gpu-sandbox-compat");
    expect(policy.reason).toBe("previous-startup-incomplete");
    expect(state.autoGpuMode).toMatchObject({
      mode: "gpu-sandbox-compat",
      reason: "previous-startup-incomplete",
      previousStartup: expect.objectContaining({
        phase: "main-window-created",
        gpuRecovery: expect.objectContaining({
          eligible: true,
          phase: "main-window-created",
        }),
      }),
    });
  });

  it.each([
    ["gpu-sandbox-compat", true, false],
    ["gpu-backend-compat", true, true],
    ["software-safe", false, false],
    ["deep-compat", false, false],
    ["diagnostic-failed", false, false],
  ])("still applies existing auto GPU mode %s when a server marker is stale", (mode, hardwareAccelerationEnabled, backendCompat) => {
    const openZetcXHome = makeHome();
    writeGpuState(openZetcXHome, {
      version: 2,
      autoGpuMode: {
        mode,
        reason: "gpu-child-process-gone",
        previousMode: "hardware",
        updatedAt: "2026-05-19T01:00:00.000Z",
      },
      startup: {
        status: "pending",
        startupId: "server-launch",
        phase: "server-ready",
        platform: "win32",
        startedAt: "2026-05-19T01:00:00.000Z",
        updatedAt: "2026-05-19T01:00:00.000Z",
      },
    });

    const policy = resolveGpuStartupPolicy({
      openZetcXHome,
      platform: "win32",
      argv: ["Hanako.exe"],
      env: {},
      now: "2026-05-19T01:01:00.000Z",
    });

    expect(policy.mode).toBe(mode);
    expect(policy.reason).toBe("gpu-child-process-gone");
    expect(policy.hardwareAccelerationEnabled).toBe(hardwareAccelerationEnabled);
    expect(policy.shouldApplyGpuBackendCompatSwitches).toBe(backendCompat);
    expect(readJson(path.join(openZetcXHome, "user", "gpu-startup.json")).autoGpuMode).toMatchObject({
      mode,
      reason: "gpu-child-process-gone",
    });
  });

  it("escalates a stale pending GPU sandbox launch into backend compatibility", () => {
    const openZetcXHome = makeHome();
    const compatPolicy = resolveGpuStartupPolicy({
      openZetcXHome,
      platform: "win32",
      argv: ["Hanako.exe", "--hana-gpu-sandbox-compat"],
      env: {},
    });

    markGpuStartupPending({
      openZetcXHome,
      platform: "win32",
      phase: "electron-starting",
      startupId: "compat-launch",
      policy: compatPolicy,
      now: "2026-05-19T01:00:00.000Z",
    });

    const policy = resolveGpuStartupPolicy({
      openZetcXHome,
      platform: "win32",
      argv: ["Hanako.exe"],
      env: {},
      now: "2026-05-19T01:01:00.000Z",
    });

    expect(policy.mode).toBe("gpu-backend-compat");
    expect(policy.hardwareAccelerationEnabled).toBe(true);
    expect(policy.shouldApplyGpuBackendCompatSwitches).toBe(true);
    expect(policy.reason).toBe("previous-startup-incomplete");
    expect(readJson(path.join(openZetcXHome, "user", "gpu-startup.json")).autoGpuMode).toMatchObject({
      mode: "gpu-backend-compat",
      reason: "previous-startup-incomplete",
      previousMode: "gpu-sandbox-compat",
      previousStartup: expect.objectContaining({
        policy: expect.objectContaining({
          mode: "gpu-sandbox-compat",
        }),
      }),
    });
  });

  it("escalates a stale pending GPU backend compatibility launch into software safe mode", () => {
    const openZetcXHome = makeHome();
    const backendPolicy = resolveGpuStartupPolicy({
      openZetcXHome,
      platform: "win32",
      argv: ["Hanako.exe", "--hana-gpu-backend-compat"],
      env: {},
    });

    markGpuStartupPending({
      openZetcXHome,
      platform: "win32",
      phase: "electron-starting",
      startupId: "backend-launch",
      policy: backendPolicy,
      now: "2026-05-19T01:00:00.000Z",
    });

    const policy = resolveGpuStartupPolicy({
      openZetcXHome,
      platform: "win32",
      argv: ["Hanako.exe"],
      env: {},
      now: "2026-05-19T01:01:00.000Z",
    });

    expect(policy.mode).toBe("software-safe");
    expect(policy.hardwareAccelerationEnabled).toBe(false);
    expect(policy.shouldDisableHardwareAcceleration).toBe(true);
    expect(policy.reason).toBe("previous-startup-incomplete");
    expect(readJson(path.join(openZetcXHome, "user", "gpu-startup.json")).autoGpuMode).toMatchObject({
      mode: "software-safe",
      reason: "previous-startup-incomplete",
      previousMode: "gpu-backend-compat",
      previousStartup: expect.objectContaining({
        policy: expect.objectContaining({
          mode: "gpu-backend-compat",
        }),
      }),
    });
  });

  it("escalates a stale deep compatibility startup into diagnostic failed mode", () => {
    const openZetcXHome = makeHome();
    writeGpuState(openZetcXHome, {
      version: 2,
      autoGpuMode: {
        mode: "deep-compat",
        reason: "gpu-child-process-gone",
        previousMode: "software-safe",
        updatedAt: "2026-05-19T01:00:00.000Z",
      },
      startup: {
        status: "pending",
        startupId: "deep-launch",
        phase: "electron-starting",
        platform: "win32",
        startedAt: "2026-05-19T01:00:00.000Z",
        updatedAt: "2026-05-19T01:00:00.000Z",
        policy: {
          mode: "deep-compat",
          reason: "gpu-child-process-gone",
          hardwareAccelerationEnabled: false,
          shouldDisableHardwareAcceleration: true,
          shouldApplyGpuSandboxCompatSwitches: false,
          shouldApplyDeepCompatSwitches: true,
          shouldApplyUnsafeNoSandboxSwitch: false,
        },
      },
    });

    const policy = resolveGpuStartupPolicy({
      openZetcXHome,
      platform: "win32",
      argv: ["Hanako.exe"],
      env: {},
      now: "2026-05-19T01:01:00.000Z",
    });

    expect(policy.mode).toBe("diagnostic-failed");
    expect(policy.hardwareAccelerationEnabled).toBe(false);
    expect(policy.shouldApplyDeepCompatSwitches).toBe(true);
    expect(readJson(path.join(openZetcXHome, "user", "gpu-startup.json")).autoGpuMode).toMatchObject({
      mode: "diagnostic-failed",
      reason: "previous-startup-incomplete",
      previousMode: "deep-compat",
    });
  });

  it("does not auto-disable hardware acceleration for non-Windows stale startup markers", () => {
    const openZetcXHome = makeHome();
    markGpuStartupPending({
      openZetcXHome,
      platform: "darwin",
      phase: "launching-splash",
      startupId: "previous-launch",
      now: "2026-05-19T01:00:00.000Z",
    });

    const policy = resolveGpuStartupPolicy({
      openZetcXHome,
      platform: "darwin",
      argv: ["Hanako"],
      env: {},
    });

    expect(policy.hardwareAccelerationEnabled).toBe(true);
    expect(policy.shouldDisableHardwareAcceleration).toBe(false);
  });

  it("records GPU child process crashes as next-launch GPU sandbox compatibility", () => {
    const openZetcXHome = makeHome();

    recordGpuChildProcessGone({
      openZetcXHome,
      platform: "win32",
      details: { type: "GPU", reason: "crashed", exitCode: -2147483645 },
      now: "2026-05-19T01:02:00.000Z",
    });

    const policy = resolveGpuStartupPolicy({
      openZetcXHome,
      platform: "win32",
      argv: ["Hanako.exe"],
      env: {},
    });

    expect(policy.hardwareAccelerationEnabled).toBe(true);
    expect(policy.shouldDisableHardwareAcceleration).toBe(false);
    expect(policy.shouldApplyGpuSandboxCompatSwitches).toBe(true);
    expect(policy.reason).toBe("gpu-child-process-gone");
    expect(policy.mode).toBe("gpu-sandbox-compat");
    expect(readPrefs(openZetcXHome).hardware_acceleration).toBeUndefined();
  });

  it("escalates a GPU crash from sandbox compatibility into backend compatibility", () => {
    const openZetcXHome = makeHome();
    const policy = resolveGpuStartupPolicy({
      openZetcXHome,
      platform: "win32",
      argv: ["Hanako.exe", "--hana-gpu-sandbox-compat"],
      env: {},
    });

    recordGpuChildProcessGone({
      openZetcXHome,
      platform: "win32",
      policy,
      details: { type: "GPU", reason: "crashed", exitCode: -2147483645 },
      now: "2026-05-19T01:02:00.000Z",
    });

    const nextPolicy = resolveGpuStartupPolicy({
      openZetcXHome,
      platform: "win32",
      argv: ["Hanako.exe"],
      env: {},
    });

    expect(nextPolicy.hardwareAccelerationEnabled).toBe(true);
    expect(nextPolicy.mode).toBe("gpu-backend-compat");
    expect(nextPolicy.shouldApplyGpuBackendCompatSwitches).toBe(true);
    expect(readJson(path.join(openZetcXHome, "user", "gpu-startup.json")).autoGpuMode).toMatchObject({
      mode: "gpu-backend-compat",
      reason: "gpu-child-process-gone",
      previousMode: "gpu-sandbox-compat",
    });
  });

  it("escalates a GPU crash from backend compatibility into software safe mode", () => {
    const openZetcXHome = makeHome();
    const policy = resolveGpuStartupPolicy({
      openZetcXHome,
      platform: "win32",
      argv: ["Hanako.exe", "--hana-gpu-backend-compat"],
      env: {},
    });

    recordGpuChildProcessGone({
      openZetcXHome,
      platform: "win32",
      policy,
      details: { type: "GPU", reason: "crashed", exitCode: -2147483645 },
      now: "2026-05-19T01:02:00.000Z",
    });

    const nextPolicy = resolveGpuStartupPolicy({
      openZetcXHome,
      platform: "win32",
      argv: ["Hanako.exe"],
      env: {},
    });

    expect(nextPolicy.hardwareAccelerationEnabled).toBe(false);
    expect(nextPolicy.mode).toBe("software-safe");
    expect(nextPolicy.shouldDisableHardwareAcceleration).toBe(true);
    expect(readJson(path.join(openZetcXHome, "user", "gpu-startup.json")).autoGpuMode).toMatchObject({
      mode: "software-safe",
      reason: "gpu-child-process-gone",
      previousMode: "gpu-backend-compat",
    });
  });

  it("escalates a software-safe GPU crash to deep compatibility without changing the user preference", () => {
    const openZetcXHome = makeHome();
    writePrefs(openZetcXHome, { hardware_acceleration: false });
    const policy = resolveGpuStartupPolicy({
      openZetcXHome,
      platform: "win32",
      argv: ["Hanako.exe"],
      env: {},
    });

    recordGpuChildProcessGone({
      openZetcXHome,
      platform: "win32",
      policy,
      details: { type: "GPU", reason: "crashed", exitCode: -2147483645 },
      now: "2026-05-19T01:02:00.000Z",
    });

    const nextPolicy = resolveGpuStartupPolicy({
      openZetcXHome,
      platform: "win32",
      argv: ["Hanako.exe"],
      env: {},
    });

    expect(nextPolicy.hardwareAccelerationEnabled).toBe(false);
    expect(nextPolicy.mode).toBe("deep-compat");
    expect(nextPolicy.shouldApplyDeepCompatSwitches).toBe(true);
    expect(readPrefs(openZetcXHome).hardware_acceleration).toBe(false);
    expect(readJson(path.join(openZetcXHome, "user", "gpu-startup.json")).autoGpuMode).toMatchObject({
      mode: "deep-compat",
      reason: "gpu-child-process-gone",
      previousMode: "software-safe",
    });
  });

  it("clears the pending marker when startup reaches app-ready", () => {
    const openZetcXHome = makeHome();
    markGpuStartupPending({
      openZetcXHome,
      platform: "win32",
      phase: "launching-splash",
      startupId: "launch-1",
    });

    markGpuStartupReady({
      openZetcXHome,
      platform: "win32",
      startupId: "launch-1",
      phase: "app-ready",
    });

    const state = readJson(path.join(openZetcXHome, "user", "gpu-startup.json"));
    expect(state.startup.status).toBe("ready");
    expect(state.startup.phase).toBe("app-ready");
  });

  it("marks startup failures without converting them into GPU safe mode", () => {
    const openZetcXHome = makeHome();
    markGpuStartupPending({
      openZetcXHome,
      platform: "win32",
      phase: "server-starting",
      startupId: "launch-1",
    });
    markGpuStartupFailed({
      openZetcXHome,
      platform: "win32",
      startupId: "launch-1",
      reason: "server-start-failed",
    });

    const policy = resolveGpuStartupPolicy({
      openZetcXHome,
      platform: "win32",
      argv: ["Hanako.exe"],
      env: {},
    });

    expect(policy.hardwareAccelerationEnabled).toBe(true);
    expect(policy.reason).toBe("default");
  });

  it("uses Electron's hardware acceleration API without unsafe GPU fallback switches", () => {
    const app = {
      disableHardwareAcceleration: vi.fn(),
      commandLine: { appendSwitch: vi.fn() },
    };

    applyGpuStartupPolicy(app, {
      shouldDisableHardwareAcceleration: true,
      reason: "preference",
    });

    expect(app.disableHardwareAcceleration).toHaveBeenCalledTimes(1);
    expect(app.commandLine.appendSwitch).not.toHaveBeenCalledWith("disable-software-rasterizer", expect.anything());
    expect(app.commandLine.appendSwitch).not.toHaveBeenCalledWith("disable-gpu-sandbox");
    expect(app.commandLine.appendSwitch).not.toHaveBeenCalledWith("disable-gpu-sandbox", expect.anything());
    expect(app.commandLine.appendSwitch).not.toHaveBeenCalledWith("no-sandbox");
    expect(app.commandLine.appendSwitch).not.toHaveBeenCalledWith("no-sandbox", expect.anything());
  });

  it("applies GPU sandbox compatibility switches without disabling hardware acceleration or global sandbox", () => {
    const app = {
      disableHardwareAcceleration: vi.fn(),
      commandLine: {
        appendSwitch: vi.fn(),
        hasSwitch: vi.fn((name) => name === "disable-features"),
        getSwitchValue: vi.fn((name) => name === "disable-features" ? "Vulkan" : ""),
      },
    };

    applyGpuStartupPolicy(app, {
      mode: "gpu-sandbox-compat",
      shouldApplyGpuSandboxCompatSwitches: true,
      shouldDisableHardwareAcceleration: false,
      reason: "gpu-child-process-gone",
    });

    expect(app.disableHardwareAcceleration).not.toHaveBeenCalled();
    expect(app.commandLine.appendSwitch).toHaveBeenCalledWith("disable-gpu-sandbox");
    expect(app.commandLine.appendSwitch).toHaveBeenCalledWith("disable-features", "Vulkan,GpuSandbox");
    expect(app.commandLine.appendSwitch).not.toHaveBeenCalledWith("no-sandbox");
    expect(app.commandLine.appendSwitch).not.toHaveBeenCalledWith("no-sandbox", expect.anything());
  });

  it("applies backend compatibility switches without disabling hardware acceleration", () => {
    const app = {
      disableHardwareAcceleration: vi.fn(),
      commandLine: {
        appendSwitch: vi.fn(),
        hasSwitch: vi.fn((name) => name === "disable-features"),
        getSwitchValue: vi.fn((name) => name === "disable-features" ? "GpuSandbox" : ""),
      },
    };

    applyGpuStartupPolicy(app, {
      mode: "gpu-backend-compat",
      shouldApplyGpuBackendCompatSwitches: true,
      shouldDisableHardwareAcceleration: false,
      reason: "gpu-child-process-gone",
    });

    expect(app.disableHardwareAcceleration).not.toHaveBeenCalled();
    expect(app.commandLine.appendSwitch).toHaveBeenCalledWith("disable-gpu-sandbox");
    expect(app.commandLine.appendSwitch).toHaveBeenCalledWith("disable-features", "GpuSandbox,Vulkan,SkiaGraphite");
    expect(app.commandLine.appendSwitch).toHaveBeenCalledWith("use-angle", "d3d11");
    expect(app.commandLine.appendSwitch).toHaveBeenCalledWith("disable-direct-composition");
    expect(app.commandLine.appendSwitch).not.toHaveBeenCalledWith("no-sandbox");
    expect(app.commandLine.appendSwitch).not.toHaveBeenCalledWith("no-sandbox", expect.anything());
  });

  it("allows explicit GPU backend compatibility without global no-sandbox", () => {
    const openZetcXHome = makeHome();
    const policy = resolveGpuStartupPolicy({
      openZetcXHome,
      platform: "win32",
      argv: ["Hanako.exe", "--hana-gpu-backend-compat"],
      env: {},
    });

    expect(policy.mode).toBe("gpu-backend-compat");
    expect(policy.hardwareAccelerationEnabled).toBe(true);
    expect(policy.shouldApplyGpuBackendCompatSwitches).toBe(true);
    expect(policy.shouldApplyUnsafeNoSandboxSwitch).toBe(false);
  });

  it("allows explicit GPU sandbox compatibility without global no-sandbox", () => {
    const openZetcXHome = makeHome();
    const policy = resolveGpuStartupPolicy({
      openZetcXHome,
      platform: "win32",
      argv: ["Hanako.exe", "--hana-gpu-sandbox-compat"],
      env: {},
    });

    expect(policy.mode).toBe("gpu-sandbox-compat");
    expect(policy.hardwareAccelerationEnabled).toBe(true);
    expect(policy.shouldApplyGpuSandboxCompatSwitches).toBe(true);
    expect(policy.shouldApplyUnsafeNoSandboxSwitch).toBe(false);
  });

  it("applies global no-sandbox only for explicit unsafe GPU diagnostics", () => {
    const openZetcXHome = makeHome();
    const policy = resolveGpuStartupPolicy({
      openZetcXHome,
      platform: "win32",
      argv: ["Hanako.exe", "--hana-gpu-unsafe-no-sandbox"],
      env: {},
    });
    const app = {
      disableHardwareAcceleration: vi.fn(),
      commandLine: { appendSwitch: vi.fn() },
    };

    applyGpuStartupPolicy(app, policy);

    expect(policy.mode).toBe("gpu-sandbox-compat");
    expect(policy.hardwareAccelerationEnabled).toBe(true);
    expect(policy.shouldApplyGpuSandboxCompatSwitches).toBe(true);
    expect(policy.shouldApplyUnsafeNoSandboxSwitch).toBe(true);
    expect(app.disableHardwareAcceleration).not.toHaveBeenCalled();
    expect(app.commandLine.appendSwitch).toHaveBeenCalledWith("disable-gpu-sandbox");
    expect(app.commandLine.appendSwitch).toHaveBeenCalledWith("disable-features", "GpuSandbox");
    expect(app.commandLine.appendSwitch).toHaveBeenCalledWith("no-sandbox");
  });

  it("does not persist explicit unsafe no-sandbox after a GPU crash", () => {
    const openZetcXHome = makeHome();
    const policy = resolveGpuStartupPolicy({
      openZetcXHome,
      platform: "win32",
      argv: ["Hanako.exe", "--hana-gpu-unsafe-no-sandbox"],
      env: {},
    });

    recordGpuChildProcessGone({
      openZetcXHome,
      platform: "win32",
      policy,
      details: { type: "GPU", reason: "crashed", exitCode: -2147483645 },
      now: "2026-05-19T01:02:00.000Z",
    });

    const nextPolicy = resolveGpuStartupPolicy({
      openZetcXHome,
      platform: "win32",
      argv: ["Hanako.exe"],
      env: {},
    });

    expect(nextPolicy.mode).toBe("gpu-backend-compat");
    expect(nextPolicy.shouldApplyUnsafeNoSandboxSwitch).toBe(false);
    expect(readJson(path.join(openZetcXHome, "user", "gpu-startup.json")).autoGpuMode).toMatchObject({
      mode: "gpu-backend-compat",
      reason: "gpu-child-process-gone",
      previousMode: "gpu-sandbox-compat",
    });
  });

  it("applies deep compatibility switches without disabling software rasterizer or sandbox", () => {
    const app = {
      disableHardwareAcceleration: vi.fn(),
      commandLine: { appendSwitch: vi.fn() },
    };

    applyGpuStartupPolicy(app, {
      shouldDisableHardwareAcceleration: true,
      shouldApplyDeepCompatSwitches: true,
      mode: "deep-compat",
      reason: "gpu-child-process-gone",
    });

    expect(app.disableHardwareAcceleration).toHaveBeenCalledTimes(1);
    expect(app.commandLine.appendSwitch).toHaveBeenCalledWith("disable-gpu");
    expect(app.commandLine.appendSwitch).toHaveBeenCalledWith("disable-gpu-compositing");
    expect(app.commandLine.appendSwitch).toHaveBeenCalledWith("disable-gpu-rasterization");
    expect(app.commandLine.appendSwitch).not.toHaveBeenCalledWith("disable-software-rasterizer", expect.anything());
    expect(app.commandLine.appendSwitch).not.toHaveBeenCalledWith("disable-gpu-sandbox");
    expect(app.commandLine.appendSwitch).not.toHaveBeenCalledWith("disable-gpu-sandbox", expect.anything());
    expect(app.commandLine.appendSwitch).not.toHaveBeenCalledWith("no-sandbox");
    expect(app.commandLine.appendSwitch).not.toHaveBeenCalledWith("no-sandbox", expect.anything());
  });

  it("records backend policy and recovery classification in diagnostics", () => {
    const openZetcXHome = makeHome();
    const policy = resolveGpuStartupPolicy({
      openZetcXHome,
      platform: "win32",
      argv: ["Hanako.exe", "--hana-gpu-backend-compat"],
      env: {},
    });

    markGpuStartupPending({
      openZetcXHome,
      platform: "win32",
      phase: "launching-splash",
      startupId: "backend-launch",
      policy,
      now: "2026-05-19T01:00:00.000Z",
    });

    const state = readJson(path.join(openZetcXHome, "user", "gpu-startup.json"));
    expect(state.startup.policy).toMatchObject({
      mode: "gpu-backend-compat",
      shouldApplyGpuBackendCompatSwitches: true,
      shouldApplyUnsafeNoSandboxSwitch: false,
    });

    const diagnostics = buildGpuStartupDiagnostics({ openZetcXHome, policy });
    expect(diagnostics).toContain("GPU backend compatibility switches enabled: true");
    expect(diagnostics).toContain("GPU sandbox disabled by policy: true");
    expect(diagnostics).toContain("Incomplete startup classification: gpu-recovery");
  });

  it("classifies suspected sandbox init failure without persisting unsafe no-sandbox", () => {
    const openZetcXHome = makeHome();
    const statePath = path.join(openZetcXHome, "user", "gpu-startup.json");
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify({
      version: 2,
      autoGpuMode: {
        mode: "diagnostic-failed",
        reason: "gpu-child-process-gone",
        previousMode: "deep-compat",
        updatedAt: "2026-05-19T01:02:00.000Z",
      },
    }, null, 2));

    const policy = resolveGpuStartupPolicy({
      openZetcXHome,
      platform: "win32",
      argv: ["Hanako.exe"],
      env: {},
    });
    const diagnostics = buildGpuStartupDiagnostics({ openZetcXHome, policy });

    expect(policy.mode).toBe("diagnostic-failed");
    expect(policy.shouldApplyUnsafeNoSandboxSwitch).toBe(false);
    expect(diagnostics).toContain("GPU sandbox diagnostic classification: sandbox-init-failure-suspected");
    expect(diagnostics).toContain("Unsafe no-sandbox note: only enabled by --hana-gpu-unsafe-no-sandbox for one diagnostic launch");
  });
});
