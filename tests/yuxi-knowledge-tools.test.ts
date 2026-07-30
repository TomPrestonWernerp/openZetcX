import { describe, expect, it, vi } from "vitest";
import { createYuxiKnowledgeTools } from "../lib/tools/yuxi-knowledge.ts";
import { buildYuxiKnowledgeTurnContext } from "../lib/yuxi/knowledge-turn-context.ts";

function toolByName(tools: any[], name: string) {
  const tool = tools.find(candidate => candidate.name === name);
  if (!tool) throw new Error(`missing tool ${name}`);
  return tool;
}

describe("Yuxi native knowledge tools", () => {
  it("uses hybrid vector/BM25 retrieval with graph expansion and returns traceable citations", async () => {
    const client = {
      listKnowledgeBases: vi.fn(async () => ({
        databases: [{ kb_id: "kb-1", name: "公司制度库" }],
      })),
      queryKnowledgeBase: vi.fn(async () => ({
        result: [{
          content: "差旅报销应在十五个工作日内提交。",
          metadata: {
            file_id: "file-1",
            chunk_id: "chunk-7",
            chunk_index: 7,
            source: "差旅管理办法.pdf",
            page_number: 4,
          },
          score: 0.91,
        }],
      })),
    };
    const tools = createYuxiKnowledgeTools({ getClient: () => client as any });

    const result = await toolByName(tools, "yuxi_query_knowledge_base").execute("call-abc123", {
      kb_id: "kb-1",
      query: "差旅报销期限",
    });

    expect(client.queryKnowledgeBase).toHaveBeenCalledWith(
      "kb-1",
      "差旅报销期限",
      expect.objectContaining({
        search_mode: "hybrid",
        use_graph_retrieval: true,
        vector_weight: 0.7,
        bm25_weight: 0.3,
      }),
    );
    expect(result.details.retrievalStrategy).toMatchObject({
      rag: true,
      vector: true,
      keyword: true,
      graph: true,
    });
    expect(result.details.knowledgeCitations).toEqual([
      expect.objectContaining({
        citationId: "KB-abc123-1",
        kbName: "公司制度库",
        fileName: "差旅管理办法.pdf",
        fileId: "file-1",
        chunkId: "chunk-7",
        page: 4,
        evidence: "差旅报销应在十五个工作日内提交。",
      }),
    ]);
    expect(result.content[0].text).toContain("[KB-abc123-1]");
  });

  it("opens parsed source windows and exposes line-level evidence", async () => {
    const client = {
      listKnowledgeBases: vi.fn(async () => ({
        databases: [{ kb_id: "kb-1", name: "项目知识库" }],
      })),
      listKnowledgeFiles: vi.fn(async () => ({
        entries: [{ file_id: "file-9", name: "验收报告.docx" }],
      })),
      openKnowledgeDocument: vi.fn(async () => ({
        start_line: 21,
        end_line: 24,
        content: "    21\t第一条证据\n    22\t第二条证据",
      })),
    };
    const tools = createYuxiKnowledgeTools({ getClient: () => client as any });

    const result = await toolByName(tools, "yuxi_open_knowledge_document").execute("tool-open77", {
      kb_id: "kb-1",
      file_id: "file-9",
      line: 21,
      window_size: 40,
    });

    expect(client.openKnowledgeDocument).toHaveBeenCalledWith("kb-1", "file-9", {
      offset: 20,
      windowSize: 40,
    });
    expect(result.details.knowledgeCitations[0]).toMatchObject({
      citationId: "KB-open77-1",
      fileName: "验收报告.docx",
      startLine: 21,
      endLine: 24,
    });
  });

  it("injects knowledge instructions only when the conversation switch is enabled", () => {
    expect(buildYuxiKnowledgeTurnContext(false)).toBeUndefined();
    expect(buildYuxiKnowledgeTurnContext(true)).toMatchObject({
      metadata: {
        yuxiKnowledgeMode: true,
        citationPolicy: "required",
      },
    });
    expect(buildYuxiKnowledgeTurnContext(true)?.system.text).toContain("yuxi_open_knowledge_document");
  });
});
