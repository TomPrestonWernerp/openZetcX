import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHeartbeat } from "../lib/desk/heartbeat.js";

const tempDirs = [];

function makeWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openzetcx-heartbeat-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("heartbeat jian phase", () => {
  it("still processes jian.md when the general patrol phase fails", async () => {
    const workspace = makeWorkspace();
    fs.writeFileSync(path.join(workspace, "jian.md"), "提醒我 15:35 去接水", "utf-8");

    const onJianBeat = vi.fn(async () => {});
    const hb = createHeartbeat({
      getDeskFiles: async () => [],
      getWorkspacePath: () => workspace,
      getAgentName: () => "openZetcX",
      registryPath: path.join(workspace, ".test", "jian-registry.json"),
      onBeat: vi.fn(async () => {
        throw new Error("general patrol failed");
      }),
      onJianBeat,
      intervalMinutes: 31,
      emitDevLog: vi.fn(),
      locale: "zh-CN",
    });

    await hb.beat();

    expect(onJianBeat).toHaveBeenCalledTimes(1);
    expect(onJianBeat.mock.calls[0][1]).toBe(workspace);
  });
});
