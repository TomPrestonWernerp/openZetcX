import fs from "fs";
import path from "path";
import { atomicWriteSync } from "../../shared/safe-fs.ts";

const SESSION_SCHEMA_VERSION = 2;
const DEFAULT_BASE_URL = "http://127.0.0.1:5050";
const DEFAULT_TIMEOUT_MS = 30_000;
const SESSION_FILE = "yuxi.json";
const KNOWLEDGE_METADATA_CACHE_TTL_MS = 30_000;
const KNOWLEDGE_DOCUMENT_CACHE_TTL_MS = 5 * 60_000;
const MAX_CACHED_KNOWLEDGE_DOCUMENTS = 12;
const MAX_CACHED_KNOWLEDGE_DOCUMENT_BYTES = 4 * 1024 * 1024;

export class YuxiClientError extends Error {
  declare status: number;
  declare code: string;
  declare details: unknown;

  constructor(message: string, {
    status = 500,
    code = "YUXI_REQUEST_FAILED",
    details = null,
  }: { status?: number; code?: string; details?: unknown } = {}) {
    super(message);
    this.name = "YuxiClientError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export type YuxiUser = {
  id?: number;
  user_id?: number;
  username: string;
  uid: string;
  role: string;
  avatar?: string | null;
  department_id?: number | null;
  department_name?: string | null;
};

export type YuxiPermissionScope = "own" | "department" | "global";

export type YuxiRole = {
  id: number;
  code: string;
  name: string;
  description?: string | null;
  department_id?: number | null;
  is_system?: boolean;
};

export type YuxiAccess = {
  user_id: number;
  uid: string;
  legacy_role: string;
  department_id?: number | null;
  roles: YuxiRole[];
  permissions: Record<string, YuxiPermissionScope>;
};

type StoredSession = {
  schemaVersion: number;
  baseUrl: string;
  accessToken: string | null;
  user: YuxiUser | null;
  access: YuxiAccess | null;
  requireLogin: boolean;
  updatedAt: string;
};

export function normalizeYuxiBaseUrl(value: unknown): string {
  const raw = typeof value === "string" && value.trim() ? value.trim() : DEFAULT_BASE_URL;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new YuxiClientError("线上服务地址无效", {
      status: 400,
      code: "YUXI_BASE_URL_INVALID",
    });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new YuxiClientError("线上服务地址仅支持 http 或 https", {
      status: 400,
      code: "YUXI_BASE_URL_PROTOCOL",
    });
  }
  if (parsed.username || parsed.password) {
    throw new YuxiClientError("线上服务地址不能包含用户名或密码", {
      status: 400,
      code: "YUXI_BASE_URL_CREDENTIALS",
    });
  }
  const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (parsed.protocol === "http:" && !loopbackHosts.has(parsed.hostname.toLowerCase())) {
    throw new YuxiClientError("非本机线上服务地址必须使用 https", {
      status: 400,
      code: "YUXI_HTTPS_REQUIRED",
    });
  }
  parsed.hash = "";
  parsed.search = "";
  return parsed.toString().replace(/\/+$/, "");
}

export class YuxiClient {
  private readonly sessionPath: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private knowledgeBasesCache: { scope: string; expiresAt: number; value: { databases: any[] } } | null = null;
  private readonly knowledgeFilesCache = new Map<string, { expiresAt: number; value: any }>();
  private readonly knowledgeDocumentCache = new Map<string, { expiresAt: number; value: string }>();

  constructor({
    openZetcXHome,
    fetchImpl = fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  }: {
    openZetcXHome: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  }) {
    if (!openZetcXHome) throw new Error("openZetcXHome required");
    this.sessionPath = path.join(openZetcXHome, "integrations", SESSION_FILE);
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  getSession({ includeToken = false }: { includeToken?: boolean } = {}) {
    const session = this.readSession();
    return {
      configured: Boolean(session.baseUrl),
      authenticated: Boolean(session.accessToken && session.user),
      baseUrl: session.baseUrl,
      user: session.user,
      access: session.access,
      requireLogin: session.requireLogin,
      ...(includeToken ? { accessToken: session.accessToken } : {}),
      updatedAt: session.updatedAt,
    };
  }

  async verifySession() {
    const session = this.readSession();
    if (!session.accessToken) return this.getSession();
    try {
      const [user, access] = await Promise.all([
        this.request<YuxiUser>("/api/auth/me"),
        this.request<YuxiAccess>("/api/rbac/me"),
      ]);
      this.clearKnowledgeCaches();
      this.writeSession({
        ...session,
        schemaVersion: SESSION_SCHEMA_VERSION,
        user,
        access,
        updatedAt: new Date().toISOString(),
      });
      return this.getSession();
    } catch (error) {
      if (error instanceof YuxiClientError && error.status === 401) {
        this.clearKnowledgeCaches();
        this.writeSession({
          ...session,
          accessToken: null,
          user: null,
          access: null,
          updatedAt: new Date().toISOString(),
        });
      }
      throw error;
    }
  }

  async login({
    baseUrl,
    username,
    password,
    requireLogin,
  }: {
    baseUrl?: string;
    username?: string;
    password?: string;
    requireLogin?: boolean;
  }) {
    const normalizedBaseUrl = normalizeYuxiBaseUrl(baseUrl);
    const loginId = String(username || "").trim();
    if (!loginId || typeof password !== "string" || !password) {
      throw new YuxiClientError("请输入账号和密码", {
        status: 400,
        code: "YUXI_CREDENTIALS_REQUIRED",
      });
    }

    const body = new URLSearchParams({ username: loginId, password });
    const token = await this.request<any>("/api/auth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      baseUrl: normalizedBaseUrl,
      accessToken: null,
    });
    if (typeof token?.access_token !== "string" || !token.access_token) {
      throw new YuxiClientError("登录响应缺少访问令牌", {
        status: 502,
        code: "YUXI_TOKEN_MISSING",
      });
    }

    const [user, access] = await Promise.all([
      this.request<YuxiUser>("/api/auth/me", {
        baseUrl: normalizedBaseUrl,
        accessToken: token.access_token,
      }),
      this.request<YuxiAccess>("/api/rbac/me", {
        baseUrl: normalizedBaseUrl,
        accessToken: token.access_token,
      }),
    ]);
    this.writeSession({
      schemaVersion: SESSION_SCHEMA_VERSION,
      baseUrl: normalizedBaseUrl,
      accessToken: token.access_token,
      user,
      access,
      requireLogin: typeof requireLogin === "boolean" ? requireLogin : this.readSession().requireLogin,
      updatedAt: new Date().toISOString(),
    });
    this.clearKnowledgeCaches();
    return this.getSession();
  }

  logout() {
    const session = this.readSession();
    this.clearKnowledgeCaches();
    this.writeSession({
      ...session,
      accessToken: null,
      user: null,
      access: null,
      updatedAt: new Date().toISOString(),
    });
    return this.getSession();
  }

  setRequireLogin(requireLogin: boolean) {
    const session = this.readSession();
    this.writeSession({
      ...session,
      requireLogin: Boolean(requireLogin),
      updatedAt: new Date().toISOString(),
    });
    return this.getSession();
  }

  async listAgents() {
    this.requirePermission("agent.view");
    return this.request<{ agents: any[] }>("/api/agent");
  }

  async getAgent(slug: string) {
    this.requirePermission("agent.view");
    return this.request<{ agent: any }>(`/api/agent/${encodeURIComponent(slug)}`);
  }

  async listSkills() {
    this.requirePermission("skill.view");
    return this.request<{ success: boolean; data: any[] }>("/api/skills/accessible");
  }

  async listMcpServers() {
    this.requirePermission("mcp.view");
    return this.request<{ success: boolean; data: any[] }>("/api/system/mcp-servers");
  }

  async listMyResourceSubmissions() {
    this.requirePermission("resource_submission.submit");
    return this.request<{ success: boolean; data: any[] }>("/api/resource-submissions/mine");
  }

  async submitResource({
    resourceType,
    manifest,
    packageData,
    packageFilename,
  }: {
    resourceType: "agent" | "skill" | "mcp";
    manifest: Record<string, unknown>;
    packageData?: Buffer | Uint8Array | null;
    packageFilename?: string | null;
  }) {
    this.requirePermission("resource_submission.submit");
    const form = new FormData();
    form.set("resource_type", resourceType);
    form.set("manifest", JSON.stringify(manifest));
    if (packageData) {
      const bytes = new Uint8Array(packageData);
      form.set(
        "package",
        new Blob([bytes], { type: "application/zip" }),
        packageFilename || `${String(manifest.slug || resourceType)}.zip`,
      );
    }
    return this.request<{ success: boolean; data: any }>("/api/resource-submissions", {
      method: "POST",
      body: form,
    });
  }

  async getSkillTree(slug: string) {
    this.requirePermission("skill.view");
    return this.request<{ success: boolean; data: any[] }>(
      `/api/system/skills/${encodeURIComponent(slug)}/tree`,
    );
  }

  async getSkillFile(slug: string, relativePath: string) {
    this.requirePermission("skill.view");
    const query = new URLSearchParams({ path: relativePath });
    return this.request<{ success: boolean; data: { path: string; content: string } }>(
      `/api/system/skills/${encodeURIComponent(slug)}/file?${query}`,
    );
  }

  async listKnowledgeBases() {
    this.requirePermission("knowledge.view");
    const scope = this.knowledgeCacheScope();
    if (
      this.knowledgeBasesCache
      && this.knowledgeBasesCache.scope === scope
      && this.knowledgeBasesCache.expiresAt > Date.now()
    ) {
      return this.knowledgeBasesCache.value;
    }
    const value = await this.request<{ databases: any[] }>("/api/knowledge/databases/accessible");
    this.knowledgeBasesCache = {
      scope,
      expiresAt: Date.now() + KNOWLEDGE_METADATA_CACHE_TTL_MS,
      value,
    };
    return value;
  }

  async queryKnowledgeBase(kbId: string, query: string, meta: Record<string, unknown> = {}) {
    this.requirePermission("knowledge.query");
    return this.request<any>(`/api/knowledge/databases/${encodeURIComponent(kbId)}/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, meta }),
    });
  }

  async listKnowledgeFiles(kbId: string, {
    page = 1,
    pageSize = 500,
    recursive = true,
    filesOnly = true,
  }: {
    page?: number;
    pageSize?: number;
    recursive?: boolean;
    filesOnly?: boolean;
  } = {}) {
    this.requirePermission("knowledge.view");
    const query = new URLSearchParams({
      kb_id: kbId,
      page: String(Math.max(1, Math.floor(page))),
      page_size: String(Math.min(500, Math.max(1, Math.floor(pageSize)))),
      recursive: recursive ? "true" : "false",
      files_only: filesOnly ? "true" : "false",
    });
    const cacheKey = `${this.knowledgeCacheScope()}:${kbId}:${query.toString()}`;
    const cached = this.knowledgeFilesCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const value = await this.request<{
      entries: Array<{
        kb_id?: string;
        file_id?: string;
        name?: string;
        is_dir?: boolean;
        size?: number;
        modified_at?: string;
        status?: string;
        has_parsed_markdown?: boolean;
      }>;
      page: number;
      page_size: number;
      total: number;
      has_more: boolean;
    }>(`/api/workspace/knowledge/tree?${query}`);
    this.knowledgeFilesCache.set(cacheKey, {
      expiresAt: Date.now() + KNOWLEDGE_METADATA_CACHE_TTL_MS,
      value,
    });
    return value;
  }

  async getKnowledgeDocumentMarkdown(kbId: string, fileId: string) {
    this.requirePermission("knowledge.view");
    const cacheKey = `${this.knowledgeCacheScope()}:${kbId}:${fileId}`;
    const cached = this.knowledgeDocumentCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      this.knowledgeDocumentCache.delete(cacheKey);
      this.knowledgeDocumentCache.set(cacheKey, cached);
      return cached.value;
    }
    const query = new URLSearchParams({
      kb_id: kbId,
      file_id: fileId,
      variant: "parsed",
    });
    const result = await this.request<unknown>(`/api/workspace/knowledge/download?${query}`, {
      headers: { Accept: "text/markdown, text/plain;q=0.9, application/json;q=0.5" },
    });
    if (typeof result !== "string") {
      throw new YuxiClientError("知识库文件没有可读取的解析文本", {
        status: 422,
        code: "YUXI_KNOWLEDGE_DOCUMENT_UNREADABLE",
        details: result,
      });
    }
    if (Buffer.byteLength(result, "utf8") <= MAX_CACHED_KNOWLEDGE_DOCUMENT_BYTES) {
      this.knowledgeDocumentCache.set(cacheKey, {
        expiresAt: Date.now() + KNOWLEDGE_DOCUMENT_CACHE_TTL_MS,
        value: result,
      });
      while (this.knowledgeDocumentCache.size > MAX_CACHED_KNOWLEDGE_DOCUMENTS) {
        const oldestKey = this.knowledgeDocumentCache.keys().next().value;
        if (!oldestKey) break;
        this.knowledgeDocumentCache.delete(oldestKey);
      }
    }
    return result;
  }

  async openKnowledgeDocument(kbId: string, fileId: string, {
    offset = 0,
    windowSize = 180,
  }: {
    offset?: number;
    windowSize?: number;
  } = {}) {
    const content = await this.getKnowledgeDocumentMarkdown(kbId, fileId);
    const lines = content.split(/\r?\n/);
    const start = Math.min(Math.max(Math.floor(offset), 0), lines.length);
    const limit = Math.min(Math.max(Math.floor(windowSize), 1), 2_000);
    const selected = lines.slice(start, start + limit);
    const end = start + selected.length;
    return {
      kb_id: kbId,
      file_id: fileId,
      start_line: selected.length ? start + 1 : 0,
      end_line: end,
      total_lines: lines.length,
      offset: start,
      window_size: limit,
      has_more_before: start > 0,
      has_more_after: end < lines.length,
      next_offset: end < lines.length ? end : null,
      content: selected
        .map((line, index) => `${String(start + index + 1).padStart(6, " ")}\t${line}`)
        .join("\n"),
    };
  }

  async findInKnowledgeDocument(kbId: string, fileId: string, patterns: string[], {
    useRegex = false,
    caseSensitive = false,
    maxWindows = 5,
    windowSize = 40,
  }: {
    useRegex?: boolean;
    caseSensitive?: boolean;
    maxWindows?: number;
    windowSize?: number;
  } = {}) {
    this.requirePermission("knowledge.query");
    const normalizedPatterns = patterns
      .map(pattern => String(pattern || "").trim())
      .filter(Boolean);
    if (!normalizedPatterns.length) {
      throw new YuxiClientError("patterns 至少需要一个有效关键词", {
        status: 400,
        code: "YUXI_KNOWLEDGE_PATTERNS_REQUIRED",
      });
    }
    const content = await this.getKnowledgeDocumentMarkdown(kbId, fileId);
    const lines = content.split(/\r?\n/);
    const flags = caseSensitive ? "" : "i";
    const matchers = useRegex
      ? normalizedPatterns.map(pattern => new RegExp(pattern, flags))
      : null;
    const comparablePatterns = caseSensitive
      ? normalizedPatterns
      : normalizedPatterns.map(pattern => pattern.toLocaleLowerCase());
    const matchedIndexes: number[] = [];
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const matched = matchers
        ? matchers.some(matcher => {
          matcher.lastIndex = 0;
          return matcher.test(line);
        })
        : comparablePatterns.some(pattern => (
          (caseSensitive ? line : line.toLocaleLowerCase()).includes(pattern)
        ));
      if (matched) matchedIndexes.push(index);
    }

    const halfWindow = Math.max(0, Math.floor(Math.min(Math.max(windowSize, 1), 200) / 2));
    const windows: Array<{
      start_line: number;
      end_line: number;
      matched_lines: number[];
      content: string;
    }> = [];
    for (const matchedIndex of matchedIndexes) {
      if (windows.length >= Math.min(Math.max(maxWindows, 1), 20)) break;
      const start = Math.max(0, matchedIndex - halfWindow);
      const end = Math.min(lines.length, matchedIndex + halfWindow + 1);
      const previous = windows[windows.length - 1];
      if (previous && start + 1 <= previous.end_line) {
        if (!previous.matched_lines.includes(matchedIndex + 1)) {
          previous.matched_lines.push(matchedIndex + 1);
        }
        continue;
      }
      windows.push({
        start_line: start + 1,
        end_line: end,
        matched_lines: [matchedIndex + 1],
        content: lines
          .slice(start, end)
          .map((line, index) => `${String(start + index + 1).padStart(6, " ")}\t${line}`)
          .join("\n"),
      });
    }
    return {
      kb_id: kbId,
      file_id: fileId,
      semantic: false,
      match_mode: useRegex ? "regex" : "keyword",
      total_matches: matchedIndexes.length,
      windows,
    };
  }

  async request<T>(requestPath: string, {
    baseUrl,
    accessToken,
    signal,
    ...init
  }: RequestInit & {
    baseUrl?: string;
    accessToken?: string | null;
  } = {}): Promise<T> {
    const session = this.readSession();
    const resolvedBaseUrl = normalizeYuxiBaseUrl(baseUrl || session.baseUrl);
    const resolvedToken = accessToken === undefined ? session.accessToken : accessToken;
    if (accessToken === undefined && !resolvedToken) {
      throw new YuxiClientError("请先完成线上登录", {
        status: 401,
        code: "YUXI_NOT_AUTHENTICATED",
      });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener("abort", () => controller.abort(), { once: true });
    }

    const headers = new Headers(init.headers);
    if (resolvedToken) headers.set("Authorization", `Bearer ${resolvedToken}`);
    if (!headers.has("Accept")) headers.set("Accept", "application/json");

    let response: Response;
    try {
      response = await this.fetchImpl(`${resolvedBaseUrl}${requestPath}`, {
        ...init,
        headers,
        signal: controller.signal,
      });
    } catch (error) {
      const message = error instanceof Error && error.name === "AbortError"
        ? "连接线上服务超时"
        : `无法连接线上服务：${error instanceof Error ? error.message : String(error)}`;
      throw new YuxiClientError(message, {
        status: 503,
        code: "YUXI_UNREACHABLE",
      });
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    let payload: any = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }
    if (!response.ok) {
      const detail = payload?.detail;
      const message = typeof detail === "string"
        ? detail
        : typeof detail?.message === "string"
          ? detail.message
          : typeof payload?.message === "string"
            ? payload.message
            : `线上服务请求失败（${response.status}）`;
      throw new YuxiClientError(message, {
        status: response.status,
        code: response.status === 401 ? "YUXI_UNAUTHORIZED" : "YUXI_REQUEST_FAILED",
        details: payload,
      });
    }
    return payload as T;
  }

  permissionScope(code: string): YuxiPermissionScope | null {
    return this.readSession().access?.permissions?.[code] || null;
  }

  hasPermission(code: string): boolean {
    return this.permissionScope(code) !== null;
  }

  requirePermission(code: string): YuxiPermissionScope {
    const scope = this.permissionScope(code);
    if (!scope) {
      throw new YuxiClientError(`当前账号缺少权限：${code}`, {
        status: 403,
        code: "YUXI_PERMISSION_DENIED",
        details: { permission: code },
      });
    }
    return scope;
  }

  private readSession(): StoredSession {
    try {
      const raw = JSON.parse(fs.readFileSync(this.sessionPath, "utf-8"));
      if (raw?.schemaVersion !== 1 && raw?.schemaVersion !== SESSION_SCHEMA_VERSION) {
        throw new Error("unsupported schemaVersion");
      }
      return {
        schemaVersion: SESSION_SCHEMA_VERSION,
        baseUrl: normalizeYuxiBaseUrl(raw.baseUrl),
        accessToken: typeof raw.accessToken === "string" && raw.accessToken ? raw.accessToken : null,
        user: raw.user && typeof raw.user === "object" ? raw.user : null,
        access: raw.access && typeof raw.access === "object" ? raw.access : null,
        requireLogin: raw.requireLogin === true,
        updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date(0).toISOString(),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
        return {
          schemaVersion: SESSION_SCHEMA_VERSION,
          baseUrl: DEFAULT_BASE_URL,
          accessToken: null,
          user: null,
          access: null,
          requireLogin: false,
          updatedAt: new Date(0).toISOString(),
        };
      }
      throw new YuxiClientError("账号会话文件损坏", {
        status: 500,
        code: "YUXI_SESSION_INVALID",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private writeSession(session: StoredSession) {
    fs.mkdirSync(path.dirname(this.sessionPath), { recursive: true });
    atomicWriteSync(this.sessionPath, `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 });
  }

  private knowledgeCacheScope(): string {
    const session = this.readSession();
    return `${session.baseUrl}:${session.user?.uid || "anonymous"}`;
  }

  private clearKnowledgeCaches() {
    this.knowledgeBasesCache = null;
    this.knowledgeFilesCache.clear();
    this.knowledgeDocumentCache.clear();
  }
}
