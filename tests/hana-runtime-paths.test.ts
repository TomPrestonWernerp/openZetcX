import { describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

import {
  configureProcessPiSdkEnv,
  ensureHanaPiSdkDirs,
  resolveOpenZetcXHome,
  resolveHanaPiAgentDir,
  resolveHanaPiProjectDir,
  withHanaPiSdkEnv,
} from "../shared/hana-runtime-paths.ts";

describe("Hana runtime path contracts", () => {
  it("derives the Pi SDK agent directory from HANA_HOME", () => {
    const openZetcXHome = path.join(os.tmpdir(), "hana-runtime-paths", ".openZetcX-dev");

    expect(resolveHanaPiAgentDir(openZetcXHome)).toBe(path.join(openZetcXHome, ".pi", "agent"));
    expect(resolveHanaPiProjectDir(openZetcXHome)).toBe(path.join(openZetcXHome, ".pi", "project"));
  });

  it("normalizes HANA_HOME before deriving Pi SDK paths", () => {
    const homeDir = path.join(os.tmpdir(), "hana-runtime-home");

    expect(resolveOpenZetcXHome("~/.openZetcX-dev", homeDir)).toBe(path.join(homeDir, ".openZetcX-dev"));
  });

  it("adds PI_CODING_AGENT_DIR without dropping existing environment", () => {
    const openZetcXHome = path.join(os.tmpdir(), "hana-runtime-env", ".openZetcX");
    const baseEnv = { PATH: "/usr/bin", PI_CODING_AGENT_DIR: "/old-pi" };

    expect(withHanaPiSdkEnv(baseEnv, openZetcXHome)).toEqual({
      PATH: "/usr/bin",
      PI_CODING_AGENT_DIR: path.join(openZetcXHome, ".pi", "agent"),
    });
    expect(baseEnv.PI_CODING_AGENT_DIR).toBe("/old-pi");
  });

  it("can install the Pi SDK agent directory into a process env object", () => {
    const openZetcXHome = path.join(os.tmpdir(), "hana-runtime-process", ".openZetcX");
    const env: any = {};

    expect(configureProcessPiSdkEnv(openZetcXHome, env)).toBe(path.join(openZetcXHome, ".pi", "agent"));
    expect(env.PI_CODING_AGENT_DIR).toBe(path.join(openZetcXHome, ".pi", "agent"));
  });

  it("creates Hana-owned Pi SDK directories explicitly", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hana-runtime-dirs-"));
    const openZetcXHome = path.join(root, ".openZetcX");

    ensureHanaPiSdkDirs(openZetcXHome);

    expect(fs.statSync(path.join(openZetcXHome, ".pi", "agent")).isDirectory()).toBe(true);
    expect(fs.statSync(path.join(openZetcXHome, ".pi", "project")).isDirectory()).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
