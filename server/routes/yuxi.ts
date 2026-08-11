import { Hono } from "hono";
import fs from "fs";
import os from "os";
import path from "path";
import { emitAppEvent } from "../app-events.ts";
import { safeJson } from "../hono-helpers.ts";
import { YuxiClientError } from "../../lib/yuxi/client.ts";
import { syncYuxiAgent, syncYuxiSkill } from "../../lib/yuxi/sync.ts";
import { parseSkillMetadata } from "../../lib/skills/skill-metadata.ts";
import { loadConfig } from "../../lib/memory/config-loader.ts";
import { writeZipFromDirectory } from "../../lib/zip-writer.ts";

const LOCAL_RESOURCE_TYPES = new Set(["agent", "skill", "mcp"]);

function readText(filePath: string, maximum = 20_000) {
  try {
    return fs.readFileSync(filePath, "utf-8").slice(0, maximum);
  } catch {
    return "";
  }
}

function readableDescription(value: string) {
  return value.replace(/<!--[\s\S]*?-->/g, "").trim();
}

function localMcpConnectors(engine: any) {
  const entry = engine.pluginManager?.getPlugin?.("mcp");
  const runtime = entry?.instance?.ctx?._mcpRuntime;
  const state = runtime?.getState?.() || {};
  return Array.isArray(state.connectors) ? state.connectors : [];
}

function listLocalResources(engine: any) {
  const agents = (engine.listAgents?.() || []).map((agent: any) => ({
    type: "agent",
    sourceId: agent.id,
    slug: agent.id,
    name: agent.name || agent.id,
    description: readableDescription(readText(path.join(engine.agentsDir, agent.id, "description.md"), 4_000))
      || readableDescription(String(agent.identity || ""))
      || "",
  }));
  const skills = fs.existsSync(engine.userSkillsDir)
    ? fs.readdirSync(engine.userSkillsDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && fs.existsSync(path.join(engine.userSkillsDir, entry.name, "SKILL.md")))
      .map(entry => {
        const metadata = parseSkillMetadata(
          readText(path.join(engine.userSkillsDir, entry.name, "SKILL.md"), 200_000),
          entry.name,
        );
        return {
          type: "skill",
          sourceId: entry.name,
          slug: metadata.name || entry.name,
          name: metadata.name || entry.name,
          description: metadata.description || "",
        };
      })
    : [];
  const mcp = localMcpConnectors(engine).map((connector: any) => ({
    type: "mcp",
    sourceId: connector.id,
    slug: connector.id,
    name: connector.name || connector.id,
    description: connector.description || "",
    transport: connector.transport,
  }));
  return [...agents, ...skills, ...mcp];
}

function findLocalResource(engine: any, resourceType: string, sourceId: string) {
  return listLocalResources(engine).find(item => item.type === resourceType && item.sourceId === sourceId) || null;
}

function agentSubmissionManifest(engine: any, sourceId: string, resource: any) {
  const agentDir = path.join(engine.agentsDir, sourceId);
  const config = loadConfig(path.join(agentDir, "config.yaml")) as any;
  return {
    source_id: sourceId,
    slug: resource.slug,
    name: resource.name,
    description: resource.description,
    identity: readText(path.join(agentDir, "identity.md")),
    skills: Array.isArray(config?.skills?.enabled) ? config.skills.enabled : [],
    mcp: Object.entries(config?.mcp?.connectors || {})
      .filter(([, value]: [string, any]) => value?.enabled !== false)
      .map(([id]) => id),
    source: "openZetcX",
  };
}

function mcpSubmissionManifest(engine: any, sourceId: string, resource: any) {
  const connector = localMcpConnectors(engine).find((item: any) => item.id === sourceId);
  if (!connector) return null;
  const transport = connector.transport === "stdio"
    ? "stdio"
    : connector.transport === "sse"
      ? "sse"
      : "streamable_http";
  return {
    source_id: sourceId,
    slug: resource.slug,
    name: resource.name,
    description: resource.description,
    transport,
    url: connector.url || null,
    command: connector.command || null,
    args: Array.isArray(connector.args) ? connector.args : [],
    timeout: connector.timeout || null,
    env_keys: Object.keys(connector.env || {}),
    header_keys: Object.keys(connector.headers || {}),
    tags: ["openZetcX"],
    source: "openZetcX",
  };
}

function errorResponse(c: any, error: unknown) {
  if (error instanceof YuxiClientError) {
    return c.json({
      error: error.message,
      code: error.code,
      ...(error.details ? { details: error.details } : {}),
    }, error.status as any);
  }
  return c.json({
    error: error instanceof Error ? error.message : String(error),
    code: "YUXI_INTEGRATION_FAILED",
  }, 500);
}

export function createYuxiRoute(engine: any) {
  const route = new Hono();
  const client = engine.yuxiClient;
  if (!client) throw new Error("Online resource client unavailable");

  route.get("/yuxi/session", async (c) => {
    try {
      const verify = c.req.query("verify");
      const session = verify === "1" || verify === "true"
        ? await client.verifySession()
        : client.getSession();
      return c.json(session);
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  route.post("/yuxi/login", async (c) => {
    try {
      const body = await safeJson(c);
      return c.json(await client.login({
        baseUrl: body.baseUrl,
        username: body.username,
        password: body.password,
        requireLogin: body.requireLogin,
      }));
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  route.post("/yuxi/logout", (c) => {
    try {
      return c.json(client.logout());
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  route.post("/yuxi/settings", async (c) => {
    try {
      const body = await safeJson(c);
      return c.json(client.setRequireLogin(body.requireLogin === true));
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  route.get("/yuxi/agents", async (c) => {
    try {
      client.requirePermission("agent.view");
      const result = await client.listAgents();
      return c.json({ agents: Array.isArray(result?.agents) ? result.agents : [] });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  route.post("/yuxi/agents/:slug/install", async (c) => {
    try {
      client.requirePermission("agent.view");
      const result = await syncYuxiAgent({
        client,
        engine,
        slug: c.req.param("slug"),
      });
      emitAppEvent(engine, result.created ? "agent-created" : "agent-updated", {
        agentId: result.agent.id,
        name: result.agent.name,
      });
      if (result.installedSkills.length) {
        emitAppEvent(engine, "skills-changed", { agentId: result.agent.id });
      }
      return c.json({ ok: true, ...result });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  route.get("/yuxi/skills", async (c) => {
    try {
      client.requirePermission("skill.view");
      const result = await client.listSkills();
      return c.json({ skills: Array.isArray(result?.data) ? result.data : [] });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  route.post("/yuxi/skills/:slug/install", async (c) => {
    try {
      client.requirePermission("skill.view");
      const body = await safeJson(c);
      const result = await syncYuxiSkill({
        client,
        engine,
        slug: c.req.param("slug"),
        agentId: typeof body.agentId === "string" && body.agentId.trim() ? body.agentId.trim() : null,
      });
      emitAppEvent(engine, "skills-changed", {
        agentId: typeof body.agentId === "string" ? body.agentId : null,
      });
      return c.json({ ok: true, skill: result });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  route.get("/yuxi/knowledge-bases", async (c) => {
    try {
      client.requirePermission("knowledge.view");
      const result = await client.listKnowledgeBases();
      return c.json({
        knowledgeBases: Array.isArray(result?.databases) ? result.databases : [],
      });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  route.post("/yuxi/knowledge-bases/:kbId/query", async (c) => {
    try {
      client.requirePermission("knowledge.query");
      const body = await safeJson(c);
      const query = typeof body.query === "string" ? body.query.trim() : "";
      if (!query) {
        return c.json({ error: "query is required", code: "YUXI_QUERY_REQUIRED" }, 400);
      }
      const result = await client.queryKnowledgeBase(
        c.req.param("kbId"),
        query,
        body.meta && typeof body.meta === "object" && !Array.isArray(body.meta) ? body.meta : {},
      );
      return c.json(result);
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  route.get("/yuxi/knowledge-bases/:kbId/files", async (c) => {
    try {
      client.requirePermission("knowledge.view");
      const kbId = c.req.param("kbId");
      const query = String(c.req.query("query") || "").trim().toLocaleLowerCase();
      const requestedLimit = Number(c.req.query("limit"));
      const limit = Number.isFinite(requestedLimit)
        ? Math.min(Math.max(Math.floor(requestedLimit), 1), 500)
        : 100;
      const result = await client.listKnowledgeFiles(kbId);
      const files = (result.entries || [])
        .filter((entry: any) => (
          !entry.is_dir
          && (!query || String(entry.name || "").toLocaleLowerCase().includes(query))
        ))
        .slice(0, limit);
      return c.json({ files, total: files.length });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  route.get("/yuxi/knowledge-bases/:kbId/files/:fileId/content", async (c) => {
    try {
      client.requirePermission("knowledge.view");
      const kbId = c.req.param("kbId");
      const fileId = c.req.param("fileId");
      const line = Number(c.req.query("line"));
      const offsetParam = Number(c.req.query("offset"));
      const windowSizeParam = Number(c.req.query("windowSize"));
      const offset = Number.isFinite(line) && line >= 1
        ? Math.floor(line) - 1
        : (Number.isFinite(offsetParam) ? Math.max(0, Math.floor(offsetParam)) : 0);
      const windowSize = Number.isFinite(windowSizeParam)
        ? Math.min(Math.max(Math.floor(windowSizeParam), 1), 2_000)
        : 180;
      const [document, fileResult] = await Promise.all([
        client.openKnowledgeDocument(kbId, fileId, { offset, windowSize }),
        client.listKnowledgeFiles(kbId),
      ]);
      const file = (fileResult.entries || []).find((entry: any) => String(entry.file_id || "") === fileId);
      return c.json({
        ...document,
        file_name: file?.name || fileId,
      });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  route.post("/yuxi/knowledge-bases/:kbId/files/:fileId/find", async (c) => {
    try {
      client.requirePermission("knowledge.query");
      const body = await safeJson(c);
      const patterns = Array.isArray(body.patterns)
        ? body.patterns.map((pattern: unknown) => String(pattern || "").trim()).filter(Boolean)
        : [];
      if (!patterns.length) {
        return c.json({ error: "patterns are required", code: "YUXI_PATTERNS_REQUIRED" }, 400);
      }
      const result = await client.findInKnowledgeDocument(
        c.req.param("kbId"),
        c.req.param("fileId"),
        patterns,
        {
          useRegex: body.useRegex === true,
          caseSensitive: body.caseSensitive === true,
          maxWindows: body.maxWindows,
          windowSize: body.windowSize,
        },
      );
      return c.json(result);
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  route.get("/yuxi/mcp-servers", async (c) => {
    try {
      client.requirePermission("mcp.view");
      const result = await client.listMcpServers();
      return c.json({ mcpServers: Array.isArray(result?.data) ? result.data : [] });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  route.get("/yuxi/local-resources", (c) => {
    try {
      client.requirePermission("resource_submission.submit");
      return c.json({ resources: listLocalResources(engine) });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  route.get("/yuxi/resource-submissions", async (c) => {
    try {
      client.requirePermission("resource_submission.submit");
      const result = await client.listMyResourceSubmissions();
      return c.json({ submissions: Array.isArray(result?.data) ? result.data : [] });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  route.post("/yuxi/local-resources/:resourceType/:sourceId/submit", async (c) => {
    try {
      client.requirePermission("resource_submission.submit");
      const resourceType = c.req.param("resourceType");
      const sourceId = c.req.param("sourceId");
      if (!LOCAL_RESOURCE_TYPES.has(resourceType)) {
        return c.json({ error: "unsupported local resource type", code: "LOCAL_RESOURCE_TYPE_INVALID" }, 400);
      }
      const resource = findLocalResource(engine, resourceType, sourceId);
      if (!resource) {
        return c.json({ error: "local resource not found", code: "LOCAL_RESOURCE_NOT_FOUND" }, 404);
      }

      if (resourceType === "agent") {
        const result = await client.submitResource({
          resourceType: "agent",
          manifest: agentSubmissionManifest(engine, sourceId, resource),
        });
        return c.json(result);
      }
      if (resourceType === "mcp") {
        const manifest = mcpSubmissionManifest(engine, sourceId, resource);
        if (!manifest) return c.json({ error: "local MCP not found" }, 404);
        const result = await client.submitResource({ resourceType: "mcp", manifest });
        return c.json(result);
      }

      const skillDir = path.resolve(path.join(engine.userSkillsDir, sourceId));
      const skillsRoot = path.resolve(engine.userSkillsDir);
      if (path.dirname(skillDir) !== skillsRoot || !fs.existsSync(path.join(skillDir, "SKILL.md"))) {
        return c.json({ error: "local skill not found", code: "LOCAL_RESOURCE_NOT_FOUND" }, 404);
      }
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openzetcx-skill-submission-"));
      const zipPath = path.join(tempDir, `${sourceId}.zip`);
      try {
        await writeZipFromDirectory(skillDir, zipPath);
        const result = await client.submitResource({
          resourceType: "skill",
          manifest: {
            source_id: sourceId,
            slug: resource.slug,
            name: resource.name,
            description: resource.description,
            source: "openZetcX",
          },
          packageData: fs.readFileSync(zipPath),
          packageFilename: `${sourceId}.zip`,
        });
        return c.json(result);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  return route;
}
