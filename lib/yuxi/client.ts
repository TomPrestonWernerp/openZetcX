import fs from "fs";
import path from "path";
import { atomicWriteSync } from "../../shared/safe-fs.ts";

const SESSION_SCHEMA_VERSION = 1;
const DEFAULT_BASE_URL = "http://127.0.0.1:5050";
const DEFAULT_TIMEOUT_MS = 30_000;
const SESSION_FILE = "yuxi.json";

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

type StoredSession = {
  schemaVersion: number;
  baseUrl: string;
  accessToken: string | null;
  user: YuxiUser | null;
  requireLogin: boolean;
  updatedAt: string;
};

export function normalizeYuxiBaseUrl(value: unknown): string {
  const raw = typeof value === "string" && value.trim() ? value.trim() : DEFAULT_BASE_URL;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new YuxiClientError("Yuxi 地址无效", {
      status: 400,
      code: "YUXI_BASE_URL_INVALID",
    });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new YuxiClientError("Yuxi 地址仅支持 http 或 https", {
      status: 400,
      code: "YUXI_BASE_URL_PROTOCOL",
    });
  }
  if (parsed.username || parsed.password) {
    throw new YuxiClientError("Yuxi 地址不能包含用户名或密码", {
      status: 400,
      code: "YUXI_BASE_URL_CREDENTIALS",
    });
  }
  const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (parsed.protocol === "http:" && !loopbackHosts.has(parsed.hostname.toLowerCase())) {
    throw new YuxiClientError("非本机 Yuxi 地址必须使用 https", {
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
      requireLogin: session.requireLogin,
      ...(includeToken ? { accessToken: session.accessToken } : {}),
      updatedAt: session.updatedAt,
    };
  }

  async verifySession() {
    const session = this.readSession();
    if (!session.accessToken) return this.getSession();
    try {
      const user = await this.request<YuxiUser>("/api/auth/me");
      this.writeSession({ ...session, user, updatedAt: new Date().toISOString() });
      return this.getSession();
    } catch (error) {
      if (error instanceof YuxiClientError && error.status === 401) {
        this.writeSession({
          ...session,
          accessToken: null,
          user: null,
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
      throw new YuxiClientError("请输入 Yuxi 账号和密码", {
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
      throw new YuxiClientError("Yuxi 登录响应缺少访问令牌", {
        status: 502,
        code: "YUXI_TOKEN_MISSING",
      });
    }

    const user = await this.request<YuxiUser>("/api/auth/me", {
      baseUrl: normalizedBaseUrl,
      accessToken: token.access_token,
    });
    this.writeSession({
      schemaVersion: SESSION_SCHEMA_VERSION,
      baseUrl: normalizedBaseUrl,
      accessToken: token.access_token,
      user,
      requireLogin: typeof requireLogin === "boolean" ? requireLogin : this.readSession().requireLogin,
      updatedAt: new Date().toISOString(),
    });
    return this.getSession();
  }

  logout() {
    const session = this.readSession();
    this.writeSession({
      ...session,
      accessToken: null,
      user: null,
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
    return this.request<{ agents: any[] }>("/api/agent");
  }

  async getAgent(slug: string) {
    return this.request<{ agent: any }>(`/api/agent/${encodeURIComponent(slug)}`);
  }

  async listSkills() {
    return this.request<{ success: boolean; data: any[] }>("/api/skills/accessible");
  }

  async getSkillTree(slug: string) {
    return this.request<{ success: boolean; data: any[] }>(
      `/api/system/skills/${encodeURIComponent(slug)}/tree`,
    );
  }

  async getSkillFile(slug: string, relativePath: string) {
    const query = new URLSearchParams({ path: relativePath });
    return this.request<{ success: boolean; data: { path: string; content: string } }>(
      `/api/system/skills/${encodeURIComponent(slug)}/file?${query}`,
    );
  }

  async listKnowledgeBases() {
    return this.request<{ databases: any[] }>("/api/knowledge/databases/accessible");
  }

  async queryKnowledgeBase(kbId: string, query: string, meta: Record<string, unknown> = {}) {
    return this.request<any>(`/api/knowledge/databases/${encodeURIComponent(kbId)}/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, meta }),
    });
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
      throw new YuxiClientError("请先登录 Yuxi", {
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
    headers.set("Accept", "application/json");

    let response: Response;
    try {
      response = await this.fetchImpl(`${resolvedBaseUrl}${requestPath}`, {
        ...init,
        headers,
        signal: controller.signal,
      });
    } catch (error) {
      const message = error instanceof Error && error.name === "AbortError"
        ? "连接 Yuxi 超时"
        : `无法连接 Yuxi：${error instanceof Error ? error.message : String(error)}`;
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
            : `Yuxi 请求失败（${response.status}）`;
      throw new YuxiClientError(message, {
        status: response.status,
        code: response.status === 401 ? "YUXI_UNAUTHORIZED" : "YUXI_REQUEST_FAILED",
        details: payload,
      });
    }
    return payload as T;
  }

  private readSession(): StoredSession {
    try {
      const raw = JSON.parse(fs.readFileSync(this.sessionPath, "utf-8"));
      if (raw?.schemaVersion !== SESSION_SCHEMA_VERSION) throw new Error("schemaVersion must be 1");
      return {
        schemaVersion: SESSION_SCHEMA_VERSION,
        baseUrl: normalizeYuxiBaseUrl(raw.baseUrl),
        accessToken: typeof raw.accessToken === "string" && raw.accessToken ? raw.accessToken : null,
        user: raw.user && typeof raw.user === "object" ? raw.user : null,
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
          requireLogin: false,
          updatedAt: new Date(0).toISOString(),
        };
      }
      throw new YuxiClientError("Yuxi 会话文件损坏", {
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
}
