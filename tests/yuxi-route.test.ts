import fs from "fs";
import os from "os";
import path from "path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createYuxiRoute } from "../server/routes/yuxi.ts";

describe("Yuxi resource routes", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openzetc-yuxi-route-"));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("marks cloud agents installed from their local Yuxi source identity", async () => {
    const agentsDir = path.join(tempRoot, "agents");
    const installedDir = path.join(agentsDir, "renamed-local-agent");
    fs.mkdirSync(installedDir, { recursive: true });
    fs.writeFileSync(path.join(installedDir, ".yuxi-source.json"), JSON.stringify({
      provider: "yuxi",
      yuxiAgentSlug: "deep-research",
    }), "utf-8");

    const engine = {
      agentsDir,
      listAgents: () => [
        { id: "renamed-local-agent", name: "深度研究" },
        { id: "ordinary-local-agent", name: "Writer" },
      ],
      yuxiClient: {
        requirePermission: vi.fn(),
        listAgents: vi.fn(async () => ({
          agents: [
            { slug: "deep-research", name: "深度研究" },
            { slug: "writer", name: "写作助手" },
          ],
        })),
      },
    };
    const app = new Hono();
    app.route("/api", createYuxiRoute(engine));

    const response = await app.request("/api/yuxi/agents");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      agents: [
        {
          slug: "deep-research",
          name: "深度研究",
          installed: true,
          local_agent_id: "renamed-local-agent",
        },
        {
          slug: "writer",
          name: "写作助手",
          installed: false,
          local_agent_id: null,
        },
      ],
    });
  });
});
