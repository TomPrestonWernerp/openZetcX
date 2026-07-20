const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const PATCH_MARKER_NAME = ".openzetcx-dev-icon.json";
const OBSOLETE_EXECUTABLE_NAME = "openZetcX-dev.exe";

function resolveRcedit(rootDir) {
  const candidates = [
    path.join(rootDir, "node_modules", "electron-winstaller", "vendor", "rcedit.exe"),
    path.join(rootDir, "node_modules", "rcedit", "bin", "rcedit-x64.exe"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function readPatchMarker(markerPath) {
  try {
    return JSON.parse(fs.readFileSync(markerPath, "utf8"));
  } catch {
    return null;
  }
}

function removeObsoleteExecutable(electronExecutable) {
  const obsoletePath = path.join(
    path.dirname(electronExecutable),
    OBSOLETE_EXECUTABLE_NAME,
  );
  try {
    fs.unlinkSync(obsoletePath);
  } catch (err) {
    if (err?.code !== "ENOENT" && err?.code !== "EPERM" && err?.code !== "EBUSY") {
      console.warn(`[launch] could not remove obsolete ${OBSOLETE_EXECUTABLE_NAME}:`, err.message);
    }
  }
}

/**
 * Windows uses the executable resource icon for unpackaged Electron apps.
 * Patch electron.exe in place so Electron still recognises the launch as a
 * development/default-app run; renaming the executable makes app.isPackaged
 * true and incorrectly triggers packaged-install integrity checks.
 */
function prepareWindowsDevElectron({ electronExecutable, rootDir }) {
  if (process.platform !== "win32") return electronExecutable;

  removeObsoleteExecutable(electronExecutable);

  const iconPath = path.join(rootDir, "desktop", "src", "icon.ico");
  const rceditPath = resolveRcedit(rootDir);
  if (!fs.existsSync(iconPath) || !rceditPath) {
    console.warn("[launch] Windows dev icon resources are unavailable; using electron.exe");
    return electronExecutable;
  }

  const markerPath = path.join(path.dirname(electronExecutable), PATCH_MARKER_NAME);
  const executableStat = fs.statSync(electronExecutable);
  const iconStat = fs.statSync(iconPath);
  const marker = readPatchMarker(markerPath);
  const isCurrent = marker?.version === 1
    && marker.executableMtimeMs === executableStat.mtimeMs
    && marker.executableSize === executableStat.size
    && marker.iconMtimeMs === iconStat.mtimeMs
    && marker.iconSize === iconStat.size;

  if (isCurrent) return electronExecutable;

  // The bundled legacy rcedit cannot open paths containing CJK characters.
  // Patch in an ASCII-only temp directory, then copy the result back while
  // retaining the required electron.exe filename.
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), "openzetcx-dev-icon-"));
  const stagingOriginal = path.join(stagingDir, "electron-original.exe");
  const stagingExecutable = path.join(stagingDir, "electron.exe");
  const stagingIcon = path.join(stagingDir, "icon.ico");
  try {
    fs.copyFileSync(electronExecutable, stagingOriginal);
    fs.copyFileSync(stagingOriginal, stagingExecutable);
    fs.copyFileSync(iconPath, stagingIcon);
    const result = spawnSync(rceditPath, [
      stagingExecutable,
      "--set-icon", stagingIcon,
      "--set-version-string", "ProductName", "openZetcX",
      "--set-version-string", "FileDescription", "openZetcX (dev)",
    ], {
      encoding: "utf8",
      windowsHide: true,
    });

    if (result.status !== 0) {
      throw new Error(
        (result.stderr || result.stdout || `rcedit exited with ${result.status}`).trim(),
      );
    }

    try {
      fs.copyFileSync(stagingExecutable, electronExecutable);
    } catch (copyError) {
      try {
        fs.copyFileSync(stagingOriginal, electronExecutable);
      } catch {}
      throw copyError;
    }

    const patchedStat = fs.statSync(electronExecutable);
    fs.writeFileSync(markerPath, JSON.stringify({
      version: 1,
      executableMtimeMs: patchedStat.mtimeMs,
      executableSize: patchedStat.size,
      iconMtimeMs: iconStat.mtimeMs,
      iconSize: iconStat.size,
    }, null, 2));
  } catch (err) {
    console.warn(
      `[launch] failed to apply the Windows development icon; using electron.exe: ${err?.message || err}`,
    );
    return electronExecutable;
  } finally {
    const tempRoot = path.resolve(os.tmpdir());
    const resolvedStagingDir = path.resolve(stagingDir);
    if (
      path.basename(resolvedStagingDir).startsWith("openzetcx-dev-icon-")
      && resolvedStagingDir.startsWith(`${tempRoot}${path.sep}`)
    ) {
      fs.rmSync(resolvedStagingDir, { recursive: true, force: true });
    }
  }

  console.log("[launch] applied the enterprise icon to electron.exe");
  return electronExecutable;
}

module.exports = {
  PATCH_MARKER_NAME,
  prepareWindowsDevElectron,
};
