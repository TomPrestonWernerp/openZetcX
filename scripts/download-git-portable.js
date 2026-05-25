#!/usr/bin/env node
/**
 * download-git-portable.js — CI 用，下载 PortableGit 到 vendor/git-portable/
 *
 * Windows 打包前运行：node scripts/download-git-portable.js
 * electron-builder 的 extraResources 会把 vendor/git-portable/ 打进安装包的 resources/git/
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const VENDOR_DIR = path.join(ROOT, "vendor", "git-portable");

// 官方 Git for Windows PortableGit（thumbdrive edition），包含完整 Git Bash/MSYS2 runtime。
const PORTABLE_GIT_VERSION = "2.54.0";
const PORTABLE_GIT_RELEASE = `v${PORTABLE_GIT_VERSION}.windows.1`;
const PORTABLE_GIT_SHA256 = "bea006a6cc69673f27b1647e84ab3a68e912fbc175ab6320c5987e012897f311";
const PORTABLE_GIT_URL = `https://github.com/git-for-windows/git/releases/download/${PORTABLE_GIT_RELEASE}/PortableGit-${PORTABLE_GIT_VERSION}-64-bit.7z.exe`;
const ARCHIVE_PATH = path.join(ROOT, "vendor", `portablegit-${PORTABLE_GIT_VERSION}.7z.exe`);
const VERSION_MARKER_PATH = path.join(VENDOR_DIR, ".openzetcx-portablegit-version");

const PORTABLE_GIT_PRUNE_PATHS = [
  "dev",
  "git-bash.exe",
  "git-cmd.exe",
  "ReleaseNotes.html",
  "unins000.dat",
  "unins000.exe",
  "unins000.msg",
  path.join("cmd", "git-gui.exe"),
  path.join("cmd", "gitk.exe"),
  path.join("cmd", "scalar.exe"),
  path.join("mingw64", "bin", "git-gui.exe"),
  path.join("mingw64", "bin", "gitk.exe"),
  path.join("mingw64", "bin", "wish.exe"),
  path.join("mingw64", "lib", "tcl8.6"),
  path.join("mingw64", "lib", "tk8.6"),
  path.join("mingw64", "share", "doc"),
  path.join("mingw64", "share", "git-doc"),
  path.join("mingw64", "share", "git-gui"),
  path.join("mingw64", "share", "gitk"),
  path.join("mingw64", "share", "gitweb"),
  path.join("mingw64", "share", "info"),
  path.join("mingw64", "share", "man"),
  path.join("mingw64", "share", "vim"),
  path.join("usr", "share", "doc"),
  path.join("usr", "share", "info"),
  path.join("usr", "share", "man"),
  path.join("usr", "share", "vim"),
];

function hasPortableGitRuntime() {
  let installedVersion = null;
  try {
    installedVersion = fs.readFileSync(VERSION_MARKER_PATH, "utf8").trim();
  } catch {}

  return installedVersion === PORTABLE_GIT_VERSION &&
    fs.existsSync(path.join(VENDOR_DIR, "cmd", "git.exe")) &&
    (
      fs.existsSync(path.join(VENDOR_DIR, "bin", "bash.exe")) ||
      fs.existsSync(path.join(VENDOR_DIR, "usr", "bin", "bash.exe"))
    );
}

function verifySha256(filePath, expected) {
  const actual = crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
  if (actual !== expected) {
    throw new Error(`PortableGit checksum mismatch: expected ${expected}, got ${actual}`);
  }
}

function extractPortableGitArchive() {
  fs.mkdirSync(VENDOR_DIR, { recursive: true });

  if (process.platform === "win32") {
    execFileSync(ARCHIVE_PATH, ["-y", `-o${VENDOR_DIR}`], { stdio: "inherit", windowsHide: true });
    return;
  }

  for (const sevenZip of ["7zz", "7z"]) {
    try {
      execFileSync(sevenZip, ["x", "-y", `-o${VENDOR_DIR}`, ARCHIVE_PATH], { stdio: "inherit" });
      return;
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
  }
  throw new Error("extracting PortableGit on non-Windows hosts requires 7zz or 7z");
}

function directoryStats(rootDir) {
  let files = 0;
  let bytes = 0;

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        files += 1;
        try {
          bytes += fs.statSync(fullPath).size;
        } catch {}
      }
    }
  }

  walk(rootDir);
  return { files, mb: Math.round((bytes / 1024 / 1024) * 10) / 10 };
}

function prunePortableGitRuntime() {
  const before = fs.existsSync(VENDOR_DIR) ? directoryStats(VENDOR_DIR) : null;
  for (const relativePath of PORTABLE_GIT_PRUNE_PATHS) {
    fs.rmSync(path.join(VENDOR_DIR, relativePath), { recursive: true, force: true });
  }

  const requiredFiles = [
    path.join("cmd", "git.exe"),
    path.join("bin", "bash.exe"),
    path.join("usr", "bin", "bash.exe"),
    path.join("mingw64", "bin", "git.exe"),
  ];
  const missing = requiredFiles.filter((relativePath) => !fs.existsSync(path.join(VENDOR_DIR, relativePath)));
  if (missing.length > 0) {
    throw new Error(`PortableGit prune removed required runtime files: ${missing.join(", ")}`);
  }

  const after = directoryStats(VENDOR_DIR);
  if (before) {
    console.log(
      `[download-git-portable] Pruned PortableGit: ${before.files} files/${before.mb} MB -> ${after.files} files/${after.mb} MB.`,
    );
  }
}

async function main() {
  // 已存在则跳过
  if (hasPortableGitRuntime()) {
    console.log(`[download-git-portable] PortableGit ${PORTABLE_GIT_VERSION} already present, pruning.`);
    prunePortableGitRuntime();
    return;
  }

  fs.rmSync(VENDOR_DIR, { recursive: true, force: true });
  fs.mkdirSync(path.join(ROOT, "vendor"), { recursive: true });

  // 下载
  console.log(`[download-git-portable] Downloading PortableGit ${PORTABLE_GIT_VERSION}...`);
  fs.rmSync(ARCHIVE_PATH, { force: true });
  execFileSync(
    "curl",
    [
      "--fail",
      "-L",
      "--retry",
      "5",
      "--retry-all-errors",
      "--connect-timeout",
      "30",
      "--speed-time",
      "60",
      "--speed-limit",
      "1024",
      "-o",
      ARCHIVE_PATH,
      PORTABLE_GIT_URL,
    ],
    { stdio: "inherit" },
  );
  verifySha256(ARCHIVE_PATH, PORTABLE_GIT_SHA256);

  // 解压
  console.log("[download-git-portable] Extracting...");
  extractPortableGitArchive();

  // 清理 archive
  fs.unlinkSync(ARCHIVE_PATH);
  prunePortableGitRuntime();
  fs.writeFileSync(VERSION_MARKER_PATH, `${PORTABLE_GIT_VERSION}\n`);

  console.log(`[download-git-portable] PortableGit ${PORTABLE_GIT_VERSION} ready at ${VENDOR_DIR}`);
}

main().catch((err) => {
  console.error("[download-git-portable] Failed:", err.message);
  process.exit(1);
});
