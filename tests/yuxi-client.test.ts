import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { YuxiClient, YuxiClientError, normalizeYuxiBaseUrl } from "../lib/yuxi/client.ts";

describe("YuxiClient", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openzetc-yuxi-client-"));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("normalizes server URLs and rejects embedded credentials", () => {
    expect(normalizeYuxiBaseUrl(undefined)).toBe("https://openzetc.zjshjkj.com");
    expect(normalizeYuxiBaseUrl("http://127.0.0.1:5050///")).toBe("http://127.0.0.1:5050");
    expect(() => normalizeYuxiBaseUrl("ftp://example.com")).toThrow(YuxiClientError);
    expect(() => normalizeYuxiBaseUrl("https://user:password@example.com")).toThrow(YuxiClientError);
    expect(() => normalizeYuxiBaseUrl("http://yuxi.example.com")).toThrowError(
      expect.objectContaining({ code: "YUXI_HTTPS_REQUIRED" }),
    );
  });

  it("uses the online service for knowledge requests and migrates the legacy local default", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ databases: [] }));
    const client = new YuxiClient({ openZetcXHome: tempRoot, fetchImpl: fetchImpl as typeof fetch });
    expect(client.getSession().baseUrl).toBe("https://openzetc.zjshjkj.com");

    fs.mkdirSync(path.join(tempRoot, "integrations"), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, "integrations", "yuxi.json"), JSON.stringify({
      schemaVersion: 2,
      baseUrl: "http://127.0.0.1:5050",
      accessToken: "legacy-token",
      user: { username: "alice", uid: "u-alice", role: "user" },
      access: {
        user_id: 7,
        uid: "u-alice",
        legacy_role: "user",
        roles: [],
        permissions: { "knowledge.view": "global" },
      },
      requireLogin: false,
      updatedAt: new Date().toISOString(),
    }));

    expect(client.getSession().baseUrl).toBe("https://openzetc.zjshjkj.com");
    await expect(client.listKnowledgeBases()).resolves.toEqual({ databases: [] });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://openzetc.zjshjkj.com/api/knowledge/databases/accessible",
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
  });

  it("logs in, persists only the token-backed session, and authenticates later requests", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/api/auth/token")) {
        return Response.json({ access_token: "yuxi-token", token_type: "bearer" });
      }
      if (String(url).endsWith("/api/auth/me")) {
        return Response.json({ username: "alice", uid: "u-alice", role: "user" });
      }
      if (String(url).endsWith("/api/rbac/me")) {
        return Response.json({
          user_id: 7,
          uid: "u-alice",
          legacy_role: "user",
          department_id: 2,
          roles: [{ id: 3, code: "system.member", name: "普通用户" }],
          permissions: {
            "agent.view": "global",
            "skill.view": "global",
            "knowledge.view": "global",
            "knowledge.query": "global",
            "mcp.view": "global",
          },
        });
      }
      if (String(url).endsWith("/api/agent")) {
        return Response.json({ agents: [{ slug: "researcher" }] });
      }
      if (String(url).endsWith("/api/system/mcp-servers")) {
        return Response.json({ success: true, data: [{ slug: "filesystem" }] });
      }
      return Response.json({ detail: "not found" }, { status: 404 });
    });
    const client = new YuxiClient({ openZetcXHome: tempRoot, fetchImpl: fetchImpl as typeof fetch });

    const session = await client.login({
      baseUrl: "http://localhost:5050/",
      username: "alice",
      password: "not-persisted-password",
      requireLogin: true,
    });
    expect(session).toMatchObject({
      authenticated: true,
      baseUrl: "http://localhost:5050",
      user: { uid: "u-alice" },
      access: {
        roles: [{ code: "system.member", name: "普通用户" }],
        permissions: { "agent.view": "global" },
      },
      requireLogin: true,
    });
    expect(session).not.toHaveProperty("accessToken");

    const stored = fs.readFileSync(path.join(tempRoot, "integrations", "yuxi.json"), "utf-8");
    expect(stored).toContain("yuxi-token");
    expect(stored).not.toContain("not-persisted-password");

    await expect(client.listAgents()).resolves.toEqual({ agents: [{ slug: "researcher" }] });
    await expect(client.listMcpServers()).resolves.toEqual({
      success: true,
      data: [{ slug: "filesystem" }],
    });
    expect(calls.at(-1)?.url).toBe("http://localhost:5050/api/system/mcp-servers");
    const requestHeaders = new Headers(calls.at(-1)?.init.headers);
    expect(requestHeaders.get("authorization")).toBe("Bearer yuxi-token");
  });

  it("fails closed before requesting a resource when RBAC permission is absent", async () => {
    fs.mkdirSync(path.join(tempRoot, "integrations"), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, "integrations", "yuxi.json"), JSON.stringify({
      schemaVersion: 3,
      baseUrl: "http://127.0.0.1:5050",
      accessToken: "valid-token",
      user: { username: "alice", uid: "u-alice", role: "user" },
      access: {
        user_id: 7,
        uid: "u-alice",
        legacy_role: "user",
        roles: [],
        permissions: { "knowledge.view": "global" },
      },
      requireLogin: true,
      updatedAt: new Date().toISOString(),
    }));
    const fetchImpl = vi.fn();
    const client = new YuxiClient({ openZetcXHome: tempRoot, fetchImpl: fetchImpl as typeof fetch });

    await expect(client.listAgents()).rejects.toMatchObject({
      status: 403,
      code: "YUXI_PERMISSION_DENIED",
      details: { permission: "agent.view" },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("submits a packaged local resource with the authenticated account", async () => {
    fs.mkdirSync(path.join(tempRoot, "integrations"), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, "integrations", "yuxi.json"), JSON.stringify({
      schemaVersion: 3,
      baseUrl: "http://127.0.0.1:5050",
      accessToken: "submission-token",
      user: { username: "alice", uid: "u-alice", role: "user" },
      access: {
        user_id: 7,
        uid: "u-alice",
        legacy_role: "user",
        roles: [],
        permissions: { "resource_submission.submit": "own" },
      },
      requireLogin: true,
      updatedAt: new Date().toISOString(),
    }));

    const fetchImpl = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
      expect(String(url)).toBe("http://127.0.0.1:5050/api/resource-submissions");
      expect(init.method).toBe("POST");
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer submission-token");
      expect(init.body).toBeInstanceOf(FormData);
      const form = init.body as FormData;
      expect(form.get("resource_type")).toBe("skill");
      expect(JSON.parse(String(form.get("manifest")))).toMatchObject({
        slug: "weekly-report",
        source_id: "weekly-report",
      });
      const uploaded = form.get("package") as File;
      expect(uploaded.name).toBe("weekly-report.zip");
      expect(uploaded.size).toBe(4);
      return Response.json({
        success: true,
        data: { submission_id: "sub-1", status: "pending" },
      });
    });
    const client = new YuxiClient({ openZetcXHome: tempRoot, fetchImpl: fetchImpl as typeof fetch });

    await expect(client.submitResource({
      resourceType: "skill",
      manifest: { slug: "weekly-report", source_id: "weekly-report" },
      packageData: Buffer.from([1, 2, 3, 4]),
      packageFilename: "weekly-report.zip",
    })).resolves.toMatchObject({
      success: true,
      data: { submission_id: "sub-1", status: "pending" },
    });
  });

  it("clears an expired session after Yuxi rejects verification", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ detail: "expired" }, { status: 401 }));
    const client = new YuxiClient({ openZetcXHome: tempRoot, fetchImpl: fetchImpl as typeof fetch });
    fs.mkdirSync(path.join(tempRoot, "integrations"), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, "integrations", "yuxi.json"), JSON.stringify({
      schemaVersion: 1,
      baseUrl: "http://127.0.0.1:5050",
      accessToken: "expired-token",
      user: { username: "alice", uid: "u-alice", role: "user" },
      requireLogin: true,
      updatedAt: new Date().toISOString(),
    }));

    await expect(client.verifySession()).rejects.toMatchObject({ status: 401 });
    expect(client.getSession()).toMatchObject({ authenticated: false, user: null, requireLogin: true });
  });

  it("fails closed when the persisted session file is corrupt", () => {
    fs.mkdirSync(path.join(tempRoot, "integrations"), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, "integrations", "yuxi.json"), "{not-json");
    const client = new YuxiClient({ openZetcXHome: tempRoot });

    expect(() => client.getSession()).toThrowError(
      expect.objectContaining({ code: "YUXI_SESSION_INVALID" }),
    );
  });
});
