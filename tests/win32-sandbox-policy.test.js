import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { deriveSandboxPolicy } from "../lib/sandbox/policy.js";
import {
  buildWin32SandboxGrants,
  externalReadPathsFromSessionFiles,
} from "../lib/sandbox/win32-policy.js";

describe("Windows sandbox policy projection", () => {
  let tempRoot;

  afterEach(() => {
    if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  });

  function makeTree() {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hana-win32-sandbox-"));
    const openZetcXHome = path.join(tempRoot, "hana-home");
    const agentDir = path.join(openZetcXHome, "agents", "hana");
    const workspace = path.join(tempRoot, "workspace");
    const externalDir = path.join(tempRoot, "external");
    for (const dir of [
      openZetcXHome,
      agentDir,
      workspace,
      path.join(workspace, ".git"),
      externalDir,
      path.join(agentDir, "memory"),
      path.join(agentDir, "sessions"),
      path.join(agentDir, "learned-skills"),
      path.join(openZetcXHome, "user"),
      path.join(openZetcXHome, "skills"),
      path.join(openZetcXHome, "session-files"),
    ]) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(path.join(agentDir, "config.yaml"), "agent:\n  name: Hana\n");
    fs.writeFileSync(path.join(agentDir, "pinned.md"), "pinned");
    fs.writeFileSync(path.join(openZetcXHome, "auth.json"), "{}");
    fs.writeFileSync(path.join(externalDir, "reference.md"), "outside");
    return { openZetcXHome, agentDir, workspace, externalDir };
  }

  const real = (p) => fs.realpathSync(p);

  it("projects required command grants separately from optional Hana grants", () => {
    const { openZetcXHome, agentDir, workspace, externalDir } = makeTree();
    const externalFile = path.join(externalDir, "reference.md");
    const policy = deriveSandboxPolicy({
      agentDir,
      workspace,
      workspaceFolders: [],
      openZetcXHome,
      mode: "standard",
    });

    const grants = buildWin32SandboxGrants({
      policy,
      cwd: workspace,
      externalReadPaths: [externalFile],
    });

    expect(grants.writePaths).toEqual([real(workspace)]);
    expect(grants.optionalWritePaths).toEqual(expect.arrayContaining([
      real(path.join(agentDir, "memory")),
      real(path.join(agentDir, "sessions")),
    ]));
    expect(grants.readPaths).toEqual(expect.arrayContaining([
      real(workspace),
      real(externalFile),
    ]));
    expect(grants.optionalReadPaths).toEqual(expect.arrayContaining([
      real(path.join(agentDir, "config.yaml")),
      real(path.join(agentDir, "learned-skills")),
      real(path.join(openZetcXHome, "user")),
    ]));
    expect(grants.writePaths).not.toContain(real(externalFile));
    expect(grants.denyWritePaths).toContain(real(path.join(workspace, ".git")));
    expect(grants.denyWritePaths).not.toContain(real(path.join(openZetcXHome, "session-files")));
    expect(grants.readPaths).not.toContain(path.join(openZetcXHome, "auth.json"));
  });

  it("keeps Hana prompt files optional so a bad ACL cannot block unrelated commands", () => {
    const { openZetcXHome, agentDir, workspace, externalDir } = makeTree();
    const externalFile = path.join(externalDir, "reference.md");
    const optionalPrompt = path.join(agentDir, "config.yaml");
    const missingLegacyPrompt = path.join(agentDir, "yuan.md");
    const policy = deriveSandboxPolicy({
      agentDir,
      workspace,
      workspaceFolders: [],
      openZetcXHome,
      mode: "standard",
    });

    const grants = buildWin32SandboxGrants({
      policy,
      cwd: workspace,
      externalReadPaths: [externalFile],
    });

    expect(grants.readPaths).toEqual(expect.arrayContaining([
      real(workspace),
      real(externalFile),
    ]));
    expect(grants.readPaths).not.toContain(real(optionalPrompt));
    expect(grants.readPaths).not.toContain(path.resolve(missingLegacyPrompt));
    expect(grants.optionalReadPaths).toContain(real(optionalPrompt));
    expect(grants.optionalReadPaths).not.toContain(path.resolve(missingLegacyPrompt));
  });

  it("derives read-only external grants from active session files without re-granting workspace or managed-cache files", () => {
    const { openZetcXHome, workspace, externalDir } = makeTree();
    const externalFile = path.join(externalDir, "reference.md");
    const workspaceFile = path.join(workspace, "owned.md");
    const managedFile = path.join(openZetcXHome, "session-files", "cache", "image.png");
    fs.mkdirSync(path.dirname(managedFile), { recursive: true });
    fs.writeFileSync(workspaceFile, "workspace");
    fs.writeFileSync(managedFile, "cache");

    const grants = externalReadPathsFromSessionFiles([
      { filePath: externalFile, realPath: externalFile, storageKind: "external", status: "available" },
      { filePath: workspaceFile, realPath: workspaceFile, storageKind: "external", status: "available" },
      { filePath: managedFile, realPath: managedFile, storageKind: "managed_cache", status: "available" },
      { filePath: path.join(externalDir, "missing.md"), storageKind: "external", status: "missing" },
    ], {
      workspaceRoots: [workspace],
      openZetcXHome,
    });

    expect(grants).toEqual([real(externalFile)]);
  });
});
