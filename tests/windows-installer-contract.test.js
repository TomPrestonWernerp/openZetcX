import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const root = process.cwd();

function extractMacro(source, name) {
  const match = source.match(new RegExp(`!macro ${name}[\\s\\S]*?!macroend`));
  return match?.[0] || "";
}

describe("Windows NSIS installer contract", () => {
  it("does not let stale old-uninstaller failures abort a Hana-owned overlay", () => {
    const source = fs.readFileSync(path.join(root, "build", "installer.nsh"), "utf-8");
    const macro = extractMacro(source, "customUnInstallCheck");

    expect(macro).toContain("openZetcXPrepareOwnedOverlay");
    expect(macro).toContain("ClearErrors");
    expect(macro).not.toContain("$(uninstallFailed)");
    expect(macro).not.toContain("Quit");
  });

  it("bypasses the previous uninstaller in electron-updater mode", () => {
    const source = fs.readFileSync(path.join(root, "build", "installer.nsh"), "utf-8");
    const bypass = extractMacro(source, "openZetcXBypassOldUninstallerForUpdate");
    const checkRunning = extractMacro(source, "customCheckAppRunning");

    expect(checkRunning).toContain("openZetcXBypassOldUninstallerForUpdate");
    expect(bypass).toContain("${isUpdated}");
    expect(bypass).toContain("openZetcXPrepareOwnedOverlay");
    expect(bypass).toContain('DeleteRegKey SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}"');
  });

  it("cleans the replaceable bundled server tree before overlaying new files", () => {
    const source = fs.readFileSync(path.join(root, "build", "installer.nsh"), "utf-8");

    expect(source).toContain('RMDir /r "$INSTDIR\\resources\\server"');
  });

  it("cleans processes by install-directory ownership, not only fixed image names", () => {
    const source = fs.readFileSync(path.join(root, "build", "installer.nsh"), "utf-8");
    const macro = extractMacro(source, "openZetcXStopInstallDirProcesses");
    const cleaner = extractMacro(source, "openZetcXWriteInstallDirProcessCleaner");

    expect(macro).toContain('-File "$1" "$INSTDIR"');
    expect(macro).toContain("openZetcXWriteInstallDirProcessCleaner");
    expect(cleaner).toContain("Get-CimInstance Win32_Process");
    expect(cleaner).toContain("CommandLine");
    expect(cleaner).toContain("Stop-Process");
  });

  it("escapes PowerShell variables written through NSIS FileWrite", () => {
    const source = fs.readFileSync(path.join(root, "build", "installer.nsh"), "utf-8");
    const cleaner = extractMacro(source, "openZetcXWriteInstallDirProcessCleaner");
    const fileWrites = cleaner
      .split("\n")
      .filter((line) => line.includes("FileWrite"))
      .join("\n");

    expect(fileWrites).toContain("$$_.CommandLine");
    expect(fileWrites).toContain("$$installDir");
    expect(fileWrites).not.toMatch(/(^|[^$])\$(?:_|install|self|PID|false|value|full)/);
  });

  it("does not classify the running installer as a stale app process via the /D argument", () => {
    const source = fs.readFileSync(path.join(root, "build", "installer.nsh"), "utf-8");
    const cleaner = extractMacro(source, "openZetcXWriteInstallDirProcessCleaner");
    const finder = extractMacro(source, "openZetcXWriteInstallDirProcessFinder");

    for (const macro of [cleaner, finder]) {
      expect(macro).toContain("$$installerPid");
      expect(macro).toContain("$$_.ProcessId -ne $$installerPid");
      expect(macro).not.toContain("return $$value.IndexOf($$installFull");
    }
  });

  it("passes the install directory to PowerShell without the NSIS System plugin", () => {
    const source = fs.readFileSync(path.join(root, "build", "installer.nsh"), "utf-8");

    expect(source).toContain('-File "$1" "$INSTDIR"');
    expect(source).toContain("$$args[0]");
    expect(source).not.toContain("System::Call");
  });

  it("future uninstallers remove Hana-owned install surfaces without atomic old-install staging", () => {
    const source = fs.readFileSync(path.join(root, "build", "installer.nsh"), "utf-8");
    const macro = extractMacro(source, "customRemoveFiles");

    expect(macro).toContain("openZetcXRemoveOwnedInstallTrees");
    expect(macro).toContain('Delete "$INSTDIR\\${APP_EXECUTABLE_FILENAME}"');
    expect(macro).not.toContain("old-install");
    expect(macro).not.toContain("un.atomicRMDir");
  });

  it("overrides app-running detection to close openZetcX and its bundled server explicitly", () => {
    const source = fs.readFileSync(path.join(root, "build", "installer.nsh"), "utf-8");
    const macro = extractMacro(source, "customCheckAppRunning");

    expect(macro).toContain("openZetcX.exe");
    expect(macro).toContain("hana-server.exe");
    expect(macro).toContain("appCannotBeClosed");
    expect(macro).toContain("MB_RETRYCANCEL");
    expect(macro).toContain("DetailPrint");
    expect(macro).not.toContain("StartsWith('$INSTDIR'");
  });

  it("keeps silent updater installs eligible to relaunch after install", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8"));

    expect(pkg.build.nsis.runAfterFinish).not.toBe(false);
  });

  it("keeps Windows installs on a stable managed install root", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8"));

    expect(pkg.build.nsis.allowToChangeInstallationDirectory).toBe(false);
  });

  it("uses a dedicated openZetcX installer identity instead of legacy Hanako", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8"));

    expect(pkg.build.appId).toBe("com.openZetcX.app");
    expect(pkg.build.nsis.guid).toBe("0fa98e28-14dd-5f40-8a17-00dd94e6a91b");
    expect(pkg.build.nsis.guid).not.toBe("3802e236-0c74-5d5f-a339-e8fa54299135");
  });
});
