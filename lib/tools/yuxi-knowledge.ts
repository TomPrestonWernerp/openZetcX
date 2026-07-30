import { Type } from "../pi-sdk/index.ts";
import type { YuxiClient } from "../yuxi/client.ts";

type KnowledgeBaseInfo = {
  kb_id?: string;
  name?: string;
  description?: string;
};

type KnowledgeCitation = {
  citationId: string;
  kbId: string;
  kbName: string;
  fileId: string;
  fileName: string;
  chunkId?: string;
  chunkIndex?: number;
  page?: number | string;
  startLine?: number;
  endLine?: number;
  matchedLines?: number[];
  score?: number;
  evidence: string;
};

function toolError(error: unknown) {
  return {
    content: [{
      type: "text",
      text: `知识库调用失败：${error instanceof Error ? error.message : String(error)}`,
    }],
    details: {
      knowledgeError: error instanceof Error ? error.message : String(error),
    },
  };
}

function getClientOrThrow(getClient: () => YuxiClient | null | undefined): YuxiClient {
  const client = getClient();
  if (!client) throw new Error("线上知识库服务不可用");
  return client;
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function normalizedKnowledgeBases(value: unknown): KnowledgeBaseInfo[] {
  const record = asRecord(value);
  return Array.isArray(record.databases) ? record.databases : [];
}

function normalizeEvidence(value: unknown, maxLength = 1_600): string {
  const text = String(value || "").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function citationPrefix(toolCallId: string): string {
  const compact = String(toolCallId || "call").replace(/[^a-zA-Z0-9]/g, "").slice(-6);
  return `KB-${compact || "SOURCE"}`;
}

function numberFromMetadata(metadata: Record<string, any>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = metadata[key];
    const numeric = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return undefined;
}

function queryResults(value: unknown, kbId: string): Array<Record<string, any>> {
  const response = asRecord(value);
  const raw = response.result ?? value;
  if (Array.isArray(raw)) {
    return raw.map((chunk, index) => {
      const record = asRecord(chunk);
      const metadata = asRecord(record.metadata);
      return {
        id: String(metadata.chunk_id || record.chunk_id || record.id || `${kbId}:${index + 1}`),
        kb_id: kbId,
        file_id: String(metadata.file_id || record.file_id || record.full_doc_id || ""),
        content: String(record.content || ""),
        metadata: {
          ...metadata,
          ...(record.score !== undefined ? { score: record.score } : {}),
          ...(record.distance !== undefined ? { distance: record.distance } : {}),
        },
      };
    });
  }
  const rawRecord = asRecord(raw);
  return Array.isArray(rawRecord.results) ? rawRecord.results.map(asRecord) : [];
}

function sourceName(metadata: Record<string, any>, fileId: string): string {
  const candidate = metadata.filename
    || metadata.file_name
    || metadata.source
    || metadata.title;
  const normalized = String(candidate || "").trim();
  return normalized && normalized !== "未知来源" ? normalized : (fileId || "未知文件");
}

function citationsFromQuery({
  toolCallId,
  kbId,
  kbName,
  results,
}: {
  toolCallId: string;
  kbId: string;
  kbName: string;
  results: Array<Record<string, any>>;
}): KnowledgeCitation[] {
  const prefix = citationPrefix(toolCallId);
  return results.flatMap((result, index) => {
    const metadata = asRecord(result.metadata);
    const fileId = String(result.file_id || metadata.file_id || "").trim();
    const evidence = normalizeEvidence(result.content);
    if (!fileId || !evidence) return [];
    const chunkIndex = numberFromMetadata(metadata, ["chunk_index", "paragraph", "paragraph_index"]);
    const page = metadata.page_number ?? metadata.page_num ?? metadata.page ?? metadata.pdf_page;
    const score = numberFromMetadata(metadata, ["score", "similarity"]);
    return [{
      citationId: `${prefix}-${index + 1}`,
      kbId,
      kbName,
      fileId,
      fileName: sourceName(metadata, fileId),
      chunkId: String(result.id || metadata.chunk_id || "").trim() || undefined,
      ...(chunkIndex !== undefined ? { chunkIndex } : {}),
      ...(page !== undefined && page !== null && String(page).trim() ? { page } : {}),
      ...(score !== undefined ? { score } : {}),
      evidence,
    }];
  });
}

function formatLocation(citation: KnowledgeCitation): string {
  const locations: string[] = [];
  if (citation.page !== undefined) locations.push(`第 ${citation.page} 页`);
  if (citation.startLine !== undefined && citation.endLine !== undefined) {
    locations.push(`第 ${citation.startLine}-${citation.endLine} 行`);
  } else if (citation.matchedLines?.length) {
    locations.push(`第 ${citation.matchedLines.join("、")} 行`);
  } else if (citation.chunkIndex !== undefined) {
    locations.push(`分块 ${citation.chunkIndex}`);
  }
  return locations.length ? ` · ${locations.join(" · ")}` : "";
}

function formatCitationsForModel(citations: KnowledgeCitation[]): string {
  if (!citations.length) return "没有检索到可引用的知识库证据。";
  return citations.map(citation => [
    `[${citation.citationId}] ${citation.kbName} · ${citation.fileName}${formatLocation(citation)}`,
    `file_id=${citation.fileId}${citation.chunkId ? ` · chunk_id=${citation.chunkId}` : ""}`,
    citation.evidence,
  ].join("\n")).join("\n\n");
}

async function resolveKb(
  client: YuxiClient,
  kbId: string,
): Promise<{ kbId: string; kbName: string; knowledgeBases: KnowledgeBaseInfo[] }> {
  const result = await client.listKnowledgeBases();
  const knowledgeBases = normalizedKnowledgeBases(result);
  const knowledgeBase = knowledgeBases.find(item => String(item.kb_id || "") === kbId);
  if (!knowledgeBase) {
    throw new Error(`知识库 ${kbId} 不存在或当前账号无权访问`);
  }
  return {
    kbId,
    kbName: String(knowledgeBase.name || kbId),
    knowledgeBases,
  };
}

async function resolveFileName(client: YuxiClient, kbId: string, fileId: string): Promise<string> {
  const result = await client.listKnowledgeFiles(kbId);
  const entry = (result.entries || []).find(item => String(item.file_id || "") === fileId);
  return String(entry?.name || fileId);
}

export function createYuxiKnowledgeTools({
  getClient,
}: {
  getClient: () => YuxiClient | null | undefined;
}) {
  const listTool = {
    name: "yuxi_list_knowledge_bases",
    label: "Knowledge Bases",
    description: "List knowledge bases accessible to the current account. In knowledge conversation mode, use this first when the knowledge-base id is unknown.",
    parameters: Type.Object({}),
    execute: async () => {
      try {
        const client = getClientOrThrow(getClient);
        const result = await client.listKnowledgeBases();
        const knowledgeBases = normalizedKnowledgeBases(result);
        return {
          content: [{
            type: "text",
            text: knowledgeBases.length
              ? knowledgeBases
                .map(item => `- ${item.name || item.kb_id} (${item.kb_id})${item.description ? `：${item.description}` : ""}`)
                .join("\n")
              : "当前账号没有可访问的知识库。",
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
    label: "Query Knowledge Base",
    description: "Run a read-only semantic query against a knowledge base. Results include traceable citation ids, file ids, filenames, chunks, scores and evidence. In knowledge conversation mode, open or find the strongest source before the final answer whenever line-level evidence is needed.",
    parameters: Type.Object({
      kb_id: Type.String({ description: "Knowledge-base id returned by yuxi_list_knowledge_bases" }),
      query: Type.String({ description: "Focused search phrase or question" }),
    }),
    execute: async (toolCallId: string, params: { kb_id?: string; query?: string }) => {
      const kbId = String(params.kb_id || "").trim();
      const query = String(params.query || "").trim();
      if (!kbId || !query) {
        return {
          content: [{ type: "text", text: "kb_id 和 query 都不能为空。" }],
          details: {},
        };
      }
      try {
        const client = getClientOrThrow(getClient);
        const { kbName } = await resolveKb(client, kbId);
        // Balanced native Yuxi RAG: dense vectors + BM25 fusion + graph expansion.
        // Keep candidate windows deliberately bounded so graph retrieval improves
        // multi-hop recall without turning every desktop question into a large scan.
        const retrievalMeta = {
          search_mode: "hybrid",
          final_top_k: 8,
          recall_top_k: 24,
          bm25_top_k: 24,
          vector_weight: 0.7,
          bm25_weight: 0.3,
          bm25_drop_ratio_search: 0.1,
          include_distances: true,
          use_graph_retrieval: true,
          graph_entity_top_k: 6,
          graph_triple_top_k: 6,
          graph_top_k: 12,
          graph_max_nodes: 3_000,
          graph_weight: 1,
        };
        const response = await client.queryKnowledgeBase(kbId, query, retrievalMeta);
        const results = queryResults(response, kbId);
        const knowledgeCitations = citationsFromQuery({
          toolCallId,
          kbId,
          kbName,
          results,
        });
        return {
          content: [{ type: "text", text: formatCitationsForModel(knowledgeCitations) }],
          details: {
            kbId,
            kbName,
            query,
            retrievalStrategy: {
              rag: true,
              vector: true,
              keyword: true,
              graph: true,
              reranker: false,
              meta: retrievalMeta,
            },
            resultCount: results.length,
            knowledgeCitations,
          },
        };
      } catch (error) {
        return toolError(error);
      }
    },
  };

  const searchFilesTool = {
    name: "yuxi_search_knowledge_files",
    label: "Search Knowledge Files",
    description: "Search filenames in one or all knowledge bases accessible to the current account. Use this when the user refers to a document by name.",
    parameters: Type.Object({
      query: Type.String({ description: "Filename keyword" }),
      kb_id: Type.Optional(Type.String({ description: "Optional knowledge-base id; omit to search all accessible knowledge bases" })),
      limit: Type.Optional(Type.Number({ description: "Maximum files to return, default 50" })),
    }),
    execute: async (_toolCallId: string, params: { query?: string; kb_id?: string; limit?: number }) => {
      const query = String(params.query || "").trim();
      if (!query) {
        return { content: [{ type: "text", text: "query 不能为空。" }], details: {} };
      }
      try {
        const client = getClientOrThrow(getClient);
        const kbResult = await client.listKnowledgeBases();
        const allKnowledgeBases = normalizedKnowledgeBases(kbResult);
        const knowledgeBases = params.kb_id
          ? allKnowledgeBases.filter(item => String(item.kb_id || "") === String(params.kb_id))
          : allKnowledgeBases;
        if (!knowledgeBases.length) throw new Error("没有匹配且可访问的知识库");
        const fileResults = await Promise.all(knowledgeBases.map(async knowledgeBase => {
          const kbId = String(knowledgeBase.kb_id || "");
          const result = await client.listKnowledgeFiles(kbId);
          return (result.entries || [])
            .filter(entry => !entry.is_dir && String(entry.name || "").toLocaleLowerCase().includes(query.toLocaleLowerCase()))
            .map(entry => ({
              kb_id: kbId,
              kb_name: String(knowledgeBase.name || kbId),
              file_id: String(entry.file_id || ""),
              filename: String(entry.name || entry.file_id || ""),
              status: entry.status,
              has_parsed_markdown: entry.has_parsed_markdown,
              modified_at: entry.modified_at,
            }));
        }));
        const limit = Math.min(Math.max(Math.floor(Number(params.limit) || 50), 1), 200);
        const files = fileResults.flat().slice(0, limit);
        return {
          content: [{
            type: "text",
            text: files.length
              ? files.map(file => `- ${file.kb_name} · ${file.filename} (file_id=${file.file_id})`).join("\n")
              : `没有找到文件名包含“${query}”的知识库文件。`,
          }],
          details: { query, files },
        };
      } catch (error) {
        return toolError(error);
      }
    },
  };

  const openDocumentTool = {
    name: "yuxi_open_knowledge_document",
    label: "Open Knowledge Document",
    description: "Open a line-numbered window from the parsed source document. Use this after semantic retrieval to verify surrounding context and produce line-level citations.",
    parameters: Type.Object({
      kb_id: Type.String({ description: "Knowledge-base id" }),
      file_id: Type.String({ description: "File id returned by query or file search" }),
      file_name: Type.Optional(Type.String({
        description: "Filename returned by query or file search. Pass it when available to avoid an extra metadata request.",
      })),
      line: Type.Optional(Type.Number({ description: "Optional 1-based starting line" })),
      offset: Type.Optional(Type.Number({ description: "Optional 0-based starting offset; line takes precedence" })),
      window_size: Type.Optional(Type.Number({ description: "Lines to return, default 180, max 2000" })),
    }),
    execute: async (toolCallId: string, params: {
      kb_id?: string;
      file_id?: string;
      file_name?: string;
      line?: number;
      offset?: number;
      window_size?: number;
    }) => {
      const kbId = String(params.kb_id || "").trim();
      const fileId = String(params.file_id || "").trim();
      if (!kbId || !fileId) {
        return { content: [{ type: "text", text: "kb_id 和 file_id 都不能为空。" }], details: {} };
      }
      try {
        const client = getClientOrThrow(getClient);
        const suppliedFileName = String(params.file_name || "").trim();
        const [{ kbName }, fileName] = await Promise.all([
          resolveKb(client, kbId),
          suppliedFileName
            ? Promise.resolve(suppliedFileName)
            : resolveFileName(client, kbId, fileId),
        ]);
        const offset = params.line !== undefined
          ? Math.max(0, Math.floor(params.line) - 1)
          : Math.max(0, Math.floor(params.offset || 0));
        const document = await client.openKnowledgeDocument(kbId, fileId, {
          offset,
          windowSize: params.window_size,
        });
        const knowledgeCitations: KnowledgeCitation[] = document.content ? [{
          citationId: `${citationPrefix(toolCallId)}-1`,
          kbId,
          kbName,
          fileId,
          fileName,
          startLine: document.start_line,
          endLine: document.end_line,
          evidence: normalizeEvidence(document.content, 6_000),
        }] : [];
        return {
          content: [{ type: "text", text: formatCitationsForModel(knowledgeCitations) }],
          details: {
            kbId,
            kbName,
            fileId,
            fileName,
            document: {
              start_line: document.start_line,
              end_line: document.end_line,
              total_lines: document.total_lines,
              offset: document.offset,
              window_size: document.window_size,
              has_more_before: document.has_more_before,
              has_more_after: document.has_more_after,
              next_offset: document.next_offset,
            },
            knowledgeCitations,
          },
        };
      } catch (error) {
        return toolError(error);
      }
    },
  };

  const findDocumentTool = {
    name: "yuxi_find_in_knowledge_document",
    label: "Find in Knowledge Document",
    description: "Locate keywords or regex patterns in a parsed knowledge document and return line-numbered evidence windows. Use this for exact terms, metrics, clauses, sections and entities.",
    parameters: Type.Object({
      kb_id: Type.String({ description: "Knowledge-base id" }),
      file_id: Type.String({ description: "File id returned by query or file search" }),
      file_name: Type.Optional(Type.String({
        description: "Filename returned by query or file search. Pass it when available to avoid an extra metadata request.",
      })),
      patterns: Type.Array(Type.String(), { description: "Keywords or regular expressions" }),
      use_regex: Type.Optional(Type.Boolean({ description: "Interpret patterns as regular expressions" })),
      case_sensitive: Type.Optional(Type.Boolean({ description: "Use case-sensitive matching" })),
      max_windows: Type.Optional(Type.Number({ description: "Maximum evidence windows, default 5" })),
      window_size: Type.Optional(Type.Number({ description: "Approximate lines per window, default 40" })),
    }),
    execute: async (toolCallId: string, params: {
      kb_id?: string;
      file_id?: string;
      file_name?: string;
      patterns?: string[];
      use_regex?: boolean;
      case_sensitive?: boolean;
      max_windows?: number;
      window_size?: number;
    }) => {
      const kbId = String(params.kb_id || "").trim();
      const fileId = String(params.file_id || "").trim();
      const patterns = Array.isArray(params.patterns) ? params.patterns : [];
      if (!kbId || !fileId || !patterns.length) {
        return { content: [{ type: "text", text: "kb_id、file_id 和 patterns 都不能为空。" }], details: {} };
      }
      try {
        const client = getClientOrThrow(getClient);
        const suppliedFileName = String(params.file_name || "").trim();
        const [{ kbName }, fileName] = await Promise.all([
          resolveKb(client, kbId),
          suppliedFileName
            ? Promise.resolve(suppliedFileName)
            : resolveFileName(client, kbId, fileId),
        ]);
        const found = await client.findInKnowledgeDocument(kbId, fileId, patterns, {
          useRegex: params.use_regex,
          caseSensitive: params.case_sensitive,
          maxWindows: params.max_windows,
          windowSize: params.window_size,
        });
        const prefix = citationPrefix(toolCallId);
        const knowledgeCitations: KnowledgeCitation[] = (found.windows || []).map((window, index) => ({
          citationId: `${prefix}-${index + 1}`,
          kbId,
          kbName,
          fileId,
          fileName,
          startLine: window.start_line,
          endLine: window.end_line,
          matchedLines: window.matched_lines,
          evidence: normalizeEvidence(window.content, 6_000),
        }));
        return {
          content: [{
            type: "text",
            text: knowledgeCitations.length
              ? formatCitationsForModel(knowledgeCitations)
              : `文件 ${fileName} 中没有找到：${patterns.join("、")}`,
          }],
          details: {
            kbId,
            kbName,
            fileId,
            fileName,
            patterns,
            found: {
              semantic: found.semantic,
              match_mode: found.match_mode,
              total_matches: found.total_matches,
              windowCount: found.windows?.length || 0,
            },
            knowledgeCitations,
          },
        };
      } catch (error) {
        return toolError(error);
      }
    },
  };

  return [
    listTool,
    queryTool,
    searchFilesTool,
    openDocumentTool,
    findDocumentTool,
  ];
}
