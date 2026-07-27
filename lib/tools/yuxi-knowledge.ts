import { Type } from "../pi-sdk/index.ts";
import type { YuxiClient } from "../yuxi/client.ts";

function toolError(error: unknown) {
  return {
    content: [{
      type: "text",
      text: `Yuxi 知识库调用失败：${error instanceof Error ? error.message : String(error)}`,
    }],
    details: {},
  };
}

function readableResult(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function createYuxiKnowledgeTools({
  getClient,
}: {
  getClient: () => YuxiClient | null | undefined;
}) {
  const listTool = {
    name: "yuxi_list_knowledge_bases",
    label: "Yuxi Knowledge Bases",
    description: "List the Yuxi knowledge bases accessible to the currently signed-in Yuxi account. Use this before querying when the knowledge-base id is unknown.",
    parameters: Type.Object({}),
    execute: async () => {
      try {
        const client = getClient();
        if (!client) throw new Error("Yuxi 集成不可用");
        const result = await client.listKnowledgeBases();
        const knowledgeBases = Array.isArray(result?.databases) ? result.databases : [];
        return {
          content: [{
            type: "text",
            text: knowledgeBases.length
              ? knowledgeBases
                .map(item => `- ${item.name || item.kb_id} (${item.kb_id})${item.description ? `：${item.description}` : ""}`)
                .join("\n")
              : "当前 Yuxi 账号没有可访问的知识库。",
          }],
          details: { knowledgeBases },
        };
      } catch (error) {
        return toolError(error);
      }
    },
  };

  const queryTool = {
    name: "yuxi_query_knowledge_base",
    label: "Query Yuxi Knowledge Base",
    description: "Run a read-only semantic query against a Yuxi knowledge base accessible to the currently signed-in Yuxi account.",
    parameters: Type.Object({
      kb_id: Type.String({ description: "Knowledge-base id returned by yuxi_list_knowledge_bases" }),
      query: Type.String({ description: "Question or search text" }),
    }),
    execute: async (_toolCallId: string, params: { kb_id?: string; query?: string }) => {
      const kbId = String(params.kb_id || "").trim();
      const query = String(params.query || "").trim();
      if (!kbId || !query) {
        return {
          content: [{ type: "text", text: "kb_id 和 query 都不能为空。" }],
          details: {},
        };
      }
      try {
        const client = getClient();
        if (!client) throw new Error("Yuxi 集成不可用");
        const response = await client.queryKnowledgeBase(kbId, query);
        const result = response?.result ?? response;
        return {
          content: [{ type: "text", text: readableResult(result) }],
          details: { kbId, result },
        };
      } catch (error) {
        return toolError(error);
      }
    },
  };

  return [listTool, queryTool];
}
