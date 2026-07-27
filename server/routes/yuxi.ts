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
  if (!client) throw new Error("Yuxi client unavailable");

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
      const result = await client.listAgents();
      return c.json({ agents: Array.isArray(result?.agents) ? result.agents : [] });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  route.post("/yuxi/agents/:slug/install", async (c) => {
    try {
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
      const result = await client.listSkills();
      return c.json({ skills: Array.isArray(result?.data) ? result.data : [] });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  route.post("/yuxi/skills/:slug/install", async (c) => {
    try {
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

  return route;
}
