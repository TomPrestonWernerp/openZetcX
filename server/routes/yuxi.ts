import { Hono } from "hono";
import { emitAppEvent } from "../app-events.ts";
import { safeJson } from "../hono-helpers.ts";
import { YuxiClientError } from "../../lib/yuxi/client.ts";
import { syncYuxiAgent, syncYuxiSkill } from "../../lib/yuxi/sync.ts";

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

  return route;
}
