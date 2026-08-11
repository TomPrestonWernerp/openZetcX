import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { hanaFetch } from '../api';
import css from './YuxiTab.module.css';

type YuxiSession = {
  authenticated: boolean;
  baseUrl: string;
  requireLogin: boolean;
  user: {
    username?: string;
    uid?: string;
    role?: string;
    department_name?: string | null;
  } | null;
  access: {
    roles: Array<{ id: number; code: string; name: string }>;
    permissions: Record<string, 'own' | 'department' | 'global'>;
  } | null;
};

type CatalogTab = 'agents' | 'skills' | 'knowledge' | 'mcp';
type LocalResourceType = 'agent' | 'skill' | 'mcp';

type LocalResource = {
  type: LocalResourceType;
  sourceId: string;
  slug: string;
  name: string;
  description?: string;
  transport?: string;
};

type ResourceSubmission = {
  submission_id: string;
  resource_type: LocalResourceType;
  slug: string;
  name: string;
  status: 'pending' | 'reviewing' | 'approved' | 'rejected';
  review_comment?: string | null;
  manifest?: { source_id?: string };
  created_at?: string;
};

type CatalogRequest = {
  id: CatalogTab;
  label: string;
  request: Promise<any>;
};

type ResourcePreview = {
  origin: 'catalog' | 'local';
  type: LocalResourceType;
  item: any;
};

const CATALOG_PERMISSIONS: Record<CatalogTab, string> = {
  agents: 'agent.view',
  skills: 'skill.view',
  knowledge: 'knowledge.view',
  mcp: 'mcp.view',
};

function hasPermission(session: YuxiSession | null, code: string): boolean {
  return Boolean(session?.access?.permissions?.[code]);
}

function accessLabel(item: any, zh: boolean) {
  const level = item?.share_config?.access_level;
  if (level === 'global') return zh ? '全局' : 'Global';
  if (level === 'department') return zh ? '部门' : 'Department';
  if (level === 'user') return zh ? '个人' : 'Personal';
  return zh ? '可访问' : 'Accessible';
}

function resultText(value: any) {
  const result = value?.result ?? value;
  return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
}

function submissionStatusLabel(status: ResourceSubmission['status'], zh: boolean) {
  const labels = zh
    ? { pending: '待部门审核', reviewing: '发布中', approved: '已公开', rejected: '已驳回' }
    : { pending: 'Pending review', reviewing: 'Publishing', approved: 'Published', rejected: 'Rejected' };
  return labels[status] || status;
}

export function YuxiTab() {
  const zh = (window.i18n?.locale || 'zh-CN').toLowerCase().startsWith('zh');
  const [session, setSession] = useState<YuxiSession | null>(null);
  const [baseUrl, setBaseUrl] = useState('http://127.0.0.1:5050');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [requireLogin, setRequireLogin] = useState(true);
  const [activeCatalog, setActiveCatalog] = useState<CatalogTab>('agents');
  const [activeLocalResourceType, setActiveLocalResourceType] = useState<LocalResourceType>('agent');
  const [agents, setAgents] = useState<any[]>([]);
  const [skills, setSkills] = useState<any[]>([]);
  const [knowledgeBases, setKnowledgeBases] = useState<any[]>([]);
  const [mcpServers, setMcpServers] = useState<any[]>([]);
  const [localResources, setLocalResources] = useState<LocalResource[]>([]);
  const [resourceSubmissions, setResourceSubmissions] = useState<ResourceSubmission[]>([]);
  const [selectedKb, setSelectedKb] = useState('');
  const [query, setQuery] = useState('');
  const [queryResult, setQueryResult] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [resourcePreview, setResourcePreview] = useState<ResourcePreview | null>(null);

  const loadCatalogs = useCallback(async (currentSession: YuxiSession) => {
    const requests: CatalogRequest[] = [
      {
        id: 'agents',
        label: 'Agent',
        request: hasPermission(currentSession, 'agent.view')
          ? hanaFetch('/api/yuxi/agents').then(res => res.json())
          : Promise.resolve({ agents: [] }),
      },
      {
        id: 'skills',
        label: 'Skill',
        request: hasPermission(currentSession, 'skill.view')
          ? hanaFetch('/api/yuxi/skills').then(res => res.json())
          : Promise.resolve({ skills: [] }),
      },
      {
        id: 'knowledge',
        label: zh ? '知识库' : 'Knowledge bases',
        request: hasPermission(currentSession, 'knowledge.view')
          ? hanaFetch('/api/yuxi/knowledge-bases').then(res => res.json())
          : Promise.resolve({ knowledgeBases: [] }),
      },
      {
        id: 'mcp',
        label: 'MCP',
        request: hasPermission(currentSession, 'mcp.view')
          ? hanaFetch('/api/yuxi/mcp-servers').then(res => res.json())
          : Promise.resolve({ mcpServers: [] }),
      },
    ];
    const results = await Promise.allSettled(requests.map(item => item.request));
    const payload = (id: CatalogTab) => {
      const index = requests.findIndex(item => item.id === id);
      const result = results[index];
      return result?.status === 'fulfilled' ? result.value : {};
    };
    const agentResponse = payload('agents');
    const skillResponse = payload('skills');
    const kbResponse = payload('knowledge');
    const mcpResponse = payload('mcp');
    setAgents(agentResponse.agents || []);
    setSkills(skillResponse.skills || []);
    setKnowledgeBases(kbResponse.knowledgeBases || []);
    setMcpServers(mcpResponse.mcpServers || []);
    setSelectedKb(current => (
      kbResponse.knowledgeBases?.some((kb: any) => kb.kb_id === current)
        ? current
        : (kbResponse.knowledgeBases?.[0]?.kb_id || '')
    ));

    const failures = results.flatMap((result, index) => {
      if (result.status === 'fulfilled') return [];
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
      return [`${requests[index].label}${reason ? `（${reason}）` : ''}`];
    });
    if (hasPermission(currentSession, 'resource_submission.submit')) {
      try {
        const [localResponse, submissionResponse] = await Promise.all([
          hanaFetch('/api/yuxi/local-resources').then(res => res.json()),
          hanaFetch('/api/yuxi/resource-submissions').then(res => res.json()),
        ]);
        setLocalResources(Array.isArray(localResponse.resources) ? localResponse.resources : []);
        setResourceSubmissions(Array.isArray(submissionResponse.submissions) ? submissionResponse.submissions : []);
      } catch {
        setLocalResources([]);
        setResourceSubmissions([]);
        failures.push(zh ? '本地资源投稿状态' : 'Local submission status');
      }
    } else {
      setLocalResources([]);
      setResourceSubmissions([]);
    }
    setError(failures.length
      ? (zh
          ? `部分资源暂时无法加载：${failures.join('、')}。其他可用资源已正常显示。`
          : `Some resources could not be loaded: ${failures.join(', ')}. Other available resources are still shown.`)
      : '');
    return failures;
  }, [zh]);

  const loadSession = useCallback(async (verify = false) => {
    setError('');
    try {
      const response = await hanaFetch(`/api/yuxi/session${verify ? '?verify=1' : ''}`, { timeout: 8_000 });
      const nextSession = await response.json() as YuxiSession;
      setSession(nextSession);
      setBaseUrl(nextSession.baseUrl || 'http://127.0.0.1:5050');
      setRequireLogin(nextSession.requireLogin ?? true);
      if (nextSession.authenticated) await loadCatalogs(nextSession);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
      setSession(current => current || {
        authenticated: false,
        baseUrl: 'http://127.0.0.1:5050',
        requireLogin: false,
        user: null,
        access: null,
      });
    }
  }, [loadCatalogs]);

  useEffect(() => {
    void loadSession(true);
  }, [loadSession]);

  async function refreshCatalogs() {
    setBusy('refresh');
    setError('');
    setNotice('');
    try {
      if (session) await loadCatalogs(session);
      setNotice(zh ? '资源列表已刷新。' : 'Resources refreshed.');
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    } finally {
      setBusy('');
    }
  }

  async function login(event: FormEvent) {
    event.preventDefault();
    setBusy('login');
    setError('');
    setNotice('');
    try {
      const response = await hanaFetch('/api/yuxi/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl, username, password, requireLogin }),
        timeout: 20_000,
      });
      const nextSession = await response.json() as YuxiSession;
      setSession(nextSession);
      setPassword('');
      window.dispatchEvent(new CustomEvent('yuxi-session-changed'));
      await loadCatalogs(nextSession);
      setNotice(zh ? '登录成功，账号资源已同步。' : 'Signed in and synced account resources.');
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : String(loginError));
    } finally {
      setBusy('');
    }
  }

  async function logout() {
    setBusy('logout');
    setError('');
    try {
      const response = await hanaFetch('/api/yuxi/logout', { method: 'POST' });
      setSession(await response.json());
      window.dispatchEvent(new CustomEvent('yuxi-session-changed'));
      setAgents([]);
      setSkills([]);
      setKnowledgeBases([]);
      setMcpServers([]);
      setLocalResources([]);
      setResourceSubmissions([]);
      setNotice(zh ? '已退出登录。' : 'Signed out.');
    } catch (logoutError) {
      setError(logoutError instanceof Error ? logoutError.message : String(logoutError));
    } finally {
      setBusy('');
    }
  }

  async function updateLoginPolicy(nextValue: boolean) {
    setBusy('policy');
    setError('');
    setNotice('');
    try {
      const response = await hanaFetch('/api/yuxi/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requireLogin: nextValue }),
      });
      const nextSession = await response.json() as YuxiSession;
      setSession(nextSession);
      setRequireLogin(nextSession.requireLogin);
      window.dispatchEvent(new CustomEvent('yuxi-session-changed'));
      setNotice(nextValue
        ? (zh ? '已启用启动登录验证。' : 'Sign-in verification enabled at startup.')
        : (zh ? '已关闭启动登录验证。' : 'Sign-in verification disabled at startup.'));
    } catch (policyError) {
      setError(policyError instanceof Error ? policyError.message : String(policyError));
    } finally {
      setBusy('');
    }
  }

  async function installAgent(slug: string) {
    setBusy(`agent:${slug}`);
    setError('');
    setNotice('');
    try {
      const response = await hanaFetch(`/api/yuxi/agents/${encodeURIComponent(slug)}/install`, {
        method: 'POST',
        timeout: 120_000,
      });
      const data = await response.json();
      const failed = data.skillErrors?.length || 0;
      setNotice(zh
        ? `${data.created ? '已安装' : '已同步'} Agent“${data.agent.name}”${failed ? `，${failed} 个 Skill 未能同步` : ''}。`
        : `${data.created ? 'Installed' : 'Synced'} agent “${data.agent.name}”${failed ? `; ${failed} skill(s) could not be synced` : ''}.`);
    } catch (installError) {
      setError(installError instanceof Error ? installError.message : String(installError));
    } finally {
      setBusy('');
    }
  }

  async function installSkill(slug: string) {
    setBusy(`skill:${slug}`);
    setError('');
    setNotice('');
    try {
      const response = await hanaFetch(`/api/yuxi/skills/${encodeURIComponent(slug)}/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        timeout: 120_000,
      });
      const data = await response.json();
      const skipped = data.skill?.skippedFiles?.length || 0;
      setNotice(zh
        ? `Skill“${data.skill.name}”已安装/同步${skipped ? `，跳过 ${skipped} 个非文本资源` : ''}。`
        : `Skill “${data.skill.name}” installed/synced${skipped ? `; skipped ${skipped} non-text asset(s)` : ''}.`);
    } catch (installError) {
      setError(installError instanceof Error ? installError.message : String(installError));
    } finally {
      setBusy('');
    }
  }

  async function submitLocalResource(resource: LocalResource) {
    setBusy(`submit:${resource.type}:${resource.sourceId}`);
    setError('');
    setNotice('');
    try {
      const response = await hanaFetch(
        `/api/yuxi/local-resources/${encodeURIComponent(resource.type)}/${encodeURIComponent(resource.sourceId)}/submit`,
        { method: 'POST', timeout: 120_000 },
      );
      const data = await response.json();
      if (data?.data) {
        setResourceSubmissions(current => [data.data, ...current]);
      }
      setNotice(zh
        ? `“${resource.name}”已提交，需由所属部门管理员审核后才会公开。`
        : `“${resource.name}” was submitted and will become public after department review.`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setBusy('');
    }
  }

  function latestSubmission(resource: LocalResource) {
    return resourceSubmissions.find(item => (
      item.resource_type === resource.type
      && (item.manifest?.source_id === resource.sourceId || item.slug === resource.slug)
    ));
  }

  async function runKnowledgeQuery(event: FormEvent) {
    event.preventDefault();
    if (!selectedKb || !query.trim()) return;
    setBusy('query');
    setError('');
    setQueryResult('');
    try {
      const response = await hanaFetch(`/api/yuxi/knowledge-bases/${encodeURIComponent(selectedKb)}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim(), meta: {} }),
        timeout: 120_000,
      });
      setQueryResult(resultText(await response.json()));
    } catch (queryError) {
      setError(queryError instanceof Error ? queryError.message : String(queryError));
    } finally {
      setBusy('');
    }
  }

  const catalogTabs = useMemo(() => ([
    ['agents', zh ? 'Agent 商店' : 'Agent Store', agents.length],
    ['skills', zh ? 'Skill 商店' : 'Skill Store', skills.length],
    ['knowledge', zh ? '知识库' : 'Knowledge Bases', knowledgeBases.length],
    ['mcp', 'MCP', mcpServers.length],
  ] as Array<[CatalogTab, string, number]>).filter(([id]) => (
    hasPermission(session, CATALOG_PERMISSIONS[id])
  )), [agents.length, knowledgeBases.length, mcpServers.length, session, skills.length, zh]);

  const localResourceCounts = useMemo(() => {
    const counts: Record<LocalResourceType, number> = { agent: 0, skill: 0, mcp: 0 };
    for (const resource of localResources) counts[resource.type] += 1;
    return counts;
  }, [localResources]);

  const visibleLocalResources = useMemo(
    () => localResources.filter(resource => resource.type === activeLocalResourceType),
    [activeLocalResourceType, localResources],
  );

  useEffect(() => {
    if (!session?.authenticated || catalogTabs.some(([id]) => id === activeCatalog)) return;
    if (catalogTabs[0]) setActiveCatalog(catalogTabs[0][0]);
  }, [activeCatalog, catalogTabs, session?.authenticated]);

  if (!session) {
    return <div className={css.loading}>{zh ? '正在检查账号登录状态…' : 'Checking account session…'}</div>;
  }

  return (
    <div className={css.root}>
      <section className={css.accountCard}>
        <div>
          <div className={css.eyebrow}>openZetc</div>
          <h2>{zh ? '统一账号' : 'Unified account'}</h2>
        </div>
        {session.authenticated && (
          <div className={css.accountIdentity}>
            <span className={css.avatar}>{(session.user?.username || session.user?.uid || 'Y').slice(0, 1).toUpperCase()}</span>
            <span>
              <strong>{session.user?.username || session.user?.uid}</strong>
              <small>{[
                session.user?.department_name,
                session.access?.roles?.map(role => role.name).join(' / ') || session.user?.role,
                `${Object.keys(session.access?.permissions || {}).length} ${zh ? '项权限' : 'permissions'}`,
              ].filter(Boolean).join(' · ')}</small>
            </span>
            <button type="button" className={css.secondaryButton} onClick={logout} disabled={busy === 'logout'}>
              {zh ? '退出登录' : 'Sign out'}
            </button>
            <label className={css.policyToggle}>
              <input
                type="checkbox"
                checked={requireLogin}
                onChange={event => void updateLoginPolicy(event.target.checked)}
                disabled={Boolean(busy)}
              />
              <span>{zh ? '启动时验证登录' : 'Require sign-in at startup'}</span>
            </label>
          </div>
        )}
      </section>

      {error && <div className={css.error} role="alert">{error}</div>}
      {notice && <div className={css.notice} role="status">{notice}</div>}

      {!session.authenticated ? (
        <form className={css.loginForm} onSubmit={login}>
          <label>
            <span>{zh ? '线上服务地址' : 'Online service URL'}</span>
            <input value={baseUrl} onChange={event => setBaseUrl(event.target.value)} placeholder="http://127.0.0.1:5050" />
          </label>
          <div className={css.loginGrid}>
            <label>
              <span>{zh ? '账号 / 用户 ID / 手机号' : 'Account / user ID / phone'}</span>
              <input value={username} onChange={event => setUsername(event.target.value)} autoComplete="username" />
            </label>
            <label>
              <span>{zh ? '密码' : 'Password'}</span>
              <input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" />
            </label>
          </div>
          <button type="submit" className={css.primaryButton} disabled={busy === 'login'}>
            {busy === 'login' ? (zh ? '正在验证…' : 'Signing in…') : (zh ? '登录' : 'Sign in')}
          </button>
          <label className={css.policyToggle}>
            <input type="checkbox" checked={requireLogin} onChange={event => setRequireLogin(event.target.checked)} />
            <span>{zh ? '将线上登录作为 openZetc 启动验证' : 'Use online sign-in to unlock openZetc at startup'}</span>
          </label>
        </form>
      ) : (
        <>
          {hasPermission(session, 'resource_submission.submit') && (
            <section className={css.submissionSection}>
              <div className={css.sectionHeading}>
                <div>
                  <h3>{zh ? '本地资源投稿' : 'Submit local resources'}</h3>
                  <p>{zh
                    ? '将本地 Agent、Skill 或 MCP 一键投稿到平台。部门管理员审核通过后，才会进入公共市场。MCP 密钥不会上传。'
                    : 'Submit a local Agent, Skill, or MCP. It enters the public catalog only after department approval; MCP secrets are never uploaded.'}</p>
                </div>
              </div>
              <div className={css.localResourceTabs} role="tablist" aria-label={zh ? '本地资源类型' : 'Local resource type'}>
                {(['agent', 'skill', 'mcp'] as const).map(resourceType => (
                  <button
                    type="button"
                    role="tab"
                    aria-label={`${resourceType === 'agent' ? 'Agent' : resourceType === 'skill' ? 'Skill' : 'MCP'} (${localResourceCounts[resourceType]})`}
                    aria-selected={activeLocalResourceType === resourceType}
                    className={activeLocalResourceType === resourceType ? css.activeLocalResourceTab : ''}
                    key={resourceType}
                    onClick={() => setActiveLocalResourceType(resourceType)}
                  >
                    {resourceType === 'agent' ? 'Agent' : resourceType === 'skill' ? 'Skill' : 'MCP'}
                    <span>{localResourceCounts[resourceType]}</span>
                  </button>
                ))}
              </div>
              <div className={css.localResourceGrid}>
                {visibleLocalResources.map(resource => {
                  const submission = latestSubmission(resource);
                  const locked = submission?.status === 'pending'
                    || submission?.status === 'reviewing'
                    || submission?.status === 'approved';
                  const busyKey = `submit:${resource.type}:${resource.sourceId}`;
                  return (
                    <article className={css.localResourceCard} key={`${resource.type}:${resource.sourceId}`}>
                      <div className={css.localResourceTitle}>
                        <span className={css.resourceIcon}>{resource.type === 'agent' ? 'A' : resource.type === 'skill' ? 'S' : 'M'}</span>
                        <span>
                          <strong>{resource.name}</strong>
                          <small>{resource.type.toUpperCase()} · {resource.sourceId}</small>
                        </span>
                      </div>
                      <p>{resource.description || (zh ? '暂无描述' : 'No description')}</p>
                      <div className={css.submissionActions}>
                        <div className={css.submissionActionLead}>
                          <button
                            type="button"
                            className={css.viewButton}
                            onClick={() => setResourcePreview({ origin: 'local', type: resource.type, item: resource })}
                          >
                            {zh ? '查看' : 'View'}
                          </button>
                          {submission && (
                            <span className={`${css.submissionStatus} ${css[`status_${submission.status}`] || ''}`}>
                              {submissionStatusLabel(submission.status, zh)}
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          className={css.primaryButton}
                          onClick={() => void submitLocalResource(resource)}
                          disabled={Boolean(busy) || locked}
                        >
                          {busy === busyKey
                            ? (zh ? '提交中…' : 'Submitting…')
                            : submission?.status === 'approved'
                              ? (zh ? '已公开' : 'Published')
                            : submission?.status === 'rejected'
                              ? (zh ? '重新提交' : 'Resubmit')
                              : (zh ? '提交部门审核' : 'Submit for review')}
                        </button>
                      </div>
                      {submission?.review_comment && (
                        <div className={css.reviewComment}>{submission.review_comment}</div>
                      )}
                    </article>
                  );
                })}
                {!visibleLocalResources.length && (
                  <div className={css.empty}>
                    {zh
                      ? `当前没有可投稿的本地 ${activeLocalResourceType === 'agent' ? 'Agent' : activeLocalResourceType === 'skill' ? 'Skill' : 'MCP'}。`
                      : `No local ${activeLocalResourceType === 'agent' ? 'Agent' : activeLocalResourceType === 'skill' ? 'Skill' : 'MCP'} resources are available to submit.`}
                  </div>
                )}
              </div>
            </section>
          )}

          <div className={css.catalogTabs} role="tablist">
            {catalogTabs.map(([id, label, count]) => (
              <button
                type="button"
                role="tab"
                aria-selected={activeCatalog === id}
                className={activeCatalog === id ? css.activeTab : ''}
                key={id}
                onClick={() => setActiveCatalog(id)}
              >
                {label}<span>{count}</span>
              </button>
            ))}
            <button type="button" className={css.refreshButton} onClick={() => void refreshCatalogs()} disabled={Boolean(busy)}>
              {busy === 'refresh' ? (zh ? '刷新中…' : 'Refreshing…') : (zh ? '刷新' : 'Refresh')}
            </button>
          </div>

          {activeCatalog === 'agents' && (
            <div className={css.cardGrid}>
              {agents.map(agent => (
                <article className={css.resourceCard} key={agent.slug}>
                  <div className={css.cardHeader}>
                    <span className={css.resourceIcon}>{agent.icon || 'A'}</span>
                    <span className={css.badge}>{accessLabel(agent, zh)}</span>
                  </div>
                  <h3>{agent.name || agent.slug}</h3>
                  <p>{agent.description || (zh ? '暂无描述' : 'No description')}</p>
                  <div className={css.meta}>{agent.backend_id} · {agent.slug}</div>
                  <div className={css.resourceActions}>
                    <button
                      type="button"
                      className={css.viewButton}
                      onClick={() => setResourcePreview({ origin: 'catalog', type: 'agent', item: agent })}
                    >
                      {zh ? '查看' : 'View'}
                    </button>
                    <button type="button" className={css.primaryButton} onClick={() => void installAgent(agent.slug)} disabled={Boolean(busy)}>
                      {busy === `agent:${agent.slug}` ? (zh ? '正在同步…' : 'Syncing…') : (zh ? '安装 / 同步到本地' : 'Install / sync locally')}
                    </button>
                  </div>
                </article>
              ))}
              {!agents.length && <div className={css.empty}>{zh ? '当前账号没有可访问的 Agent。' : 'No accessible agents for this account.'}</div>}
            </div>
          )}

          {activeCatalog === 'skills' && (
            <div className={css.cardGrid}>
              {skills.map(skill => (
                <article className={css.resourceCard} key={skill.slug}>
                  <div className={css.cardHeader}>
                    <span className={css.resourceIcon}>S</span>
                    <span className={css.badge}>{accessLabel(skill, zh)}</span>
                  </div>
                  <h3>{skill.name || skill.slug}</h3>
                  <p>{skill.description || (zh ? '暂无描述' : 'No description')}</p>
                  <div className={css.meta}>{skill.slug}{skill.version ? ` · v${skill.version}` : ''}</div>
                  <div className={css.resourceActions}>
                    <button
                      type="button"
                      className={css.viewButton}
                      onClick={() => setResourcePreview({ origin: 'catalog', type: 'skill', item: skill })}
                    >
                      {zh ? '查看' : 'View'}
                    </button>
                    <button type="button" className={css.primaryButton} onClick={() => void installSkill(skill.slug)} disabled={Boolean(busy)}>
                      {busy === `skill:${skill.slug}` ? (zh ? '正在同步…' : 'Syncing…') : (zh ? '安装 / 同步到本地' : 'Install / sync locally')}
                    </button>
                  </div>
                </article>
              ))}
              {!skills.length && <div className={css.empty}>{zh ? '当前账号没有可访问的 Skill。' : 'No accessible skills for this account.'}</div>}
            </div>
          )}

          {activeCatalog === 'knowledge' && (
            <div className={css.knowledgeLayout}>
              <div className={css.knowledgeList}>
                {knowledgeBases.map(kb => (
                  <button
                    type="button"
                    key={kb.kb_id}
                    className={selectedKb === kb.kb_id ? css.selectedKb : ''}
                    onClick={() => setSelectedKb(kb.kb_id)}
                  >
                    <strong>{kb.name || kb.kb_id}</strong>
                    <span>{kb.description || kb.kb_type || ''}</span>
                  </button>
                ))}
                {!knowledgeBases.length && <div className={css.empty}>{zh ? '当前账号没有可访问的知识库。' : 'No accessible knowledge bases.'}</div>}
              </div>
              <form className={css.queryPanel} onSubmit={runKnowledgeQuery}>
                <h3>{zh ? '验证知识库调用' : 'Test knowledge-base query'}</h3>
                <p>{zh
                  ? '这里与 Agent 内置的知识库工具使用同一个账号会话和权限。'
                  : 'This uses the same account session and permissions as the built-in knowledge tools.'}</p>
                <textarea value={query} onChange={event => setQuery(event.target.value)} placeholder={zh ? '输入要检索的问题…' : 'Enter a question…'} />
                <button
                  type="submit"
                  className={css.primaryButton}
                  disabled={!hasPermission(session, 'knowledge.query') || !selectedKb || !query.trim() || Boolean(busy)}
                >
                  {busy === 'query' ? (zh ? '查询中…' : 'Querying…') : (zh ? '查询选中的知识库' : 'Query selected knowledge base')}
                </button>
                {queryResult && <pre className={css.queryResult}>{queryResult}</pre>}
                {!hasPermission(session, 'knowledge.query') && (
                  <div className={css.empty}>{zh ? '当前角色只有知识库查看权限，不能执行检索。' : 'The current role can view knowledge bases but cannot query them.'}</div>
                )}
              </form>
            </div>
          )}

          {activeCatalog === 'mcp' && (
            <div className={css.cardGrid}>
              {mcpServers.map(server => (
                <article className={css.resourceCard} key={server.slug}>
                  <div className={css.cardHeader}>
                    <span className={css.resourceIcon}>{server.icon || 'M'}</span>
                    <span className={css.badge}>{server.access?.can_use ? (zh ? '可使用' : 'Usable') : (zh ? '仅查看' : 'View only')}</span>
                  </div>
                  <h3>{server.name || server.slug}</h3>
                  <p>{server.description || (zh ? '暂无描述' : 'No description')}</p>
                  <div className={css.meta}>{server.slug} · {server.enabled === false ? (zh ? '已停用' : 'Disabled') : (zh ? '线上托管' : 'Hosted online')}</div>
                  <div className={css.meta}>{zh ? 'MCP 凭据由线上平台保管，本地不复制。' : 'MCP credentials remain managed by the online platform.'}</div>
                </article>
              ))}
              {!mcpServers.length && <div className={css.empty}>{zh ? '当前账号没有可访问的 MCP。' : 'No accessible MCP servers for this account.'}</div>}
            </div>
          )}

          {resourcePreview && createPortal(
            <div
              className={css.detailOverlay}
              role="presentation"
              onMouseDown={event => {
                if (event.target === event.currentTarget) setResourcePreview(null);
              }}
            >
              <section
                className={css.detailDialog}
                role="dialog"
                aria-modal="true"
                aria-labelledby="resource-detail-title"
              >
                <div className={css.detailHeader}>
                  <div>
                    <span className={css.detailType}>
                      {resourcePreview.origin === 'local' ? (zh ? '本地资源' : 'Local resource') : (zh ? '线上资源' : 'Online resource')}
                      {' · '}{resourcePreview.type === 'agent' ? 'Agent' : resourcePreview.type === 'skill' ? 'Skill' : 'MCP'}
                    </span>
                    <h3 id="resource-detail-title">
                      {resourcePreview.item.name || resourcePreview.item.slug}
                    </h3>
                  </div>
                  <button type="button" className={css.closeButton} onClick={() => setResourcePreview(null)} aria-label={zh ? '关闭资源详情' : 'Close resource details'}>
                    ×
                  </button>
                </div>
                <div className={css.detailBody}>
                  <p className={css.detailDescription}>
                    {resourcePreview.item.description || (zh ? '暂无描述' : 'No description')}
                  </p>
                  <dl className={css.detailMeta}>
                    <div>
                      <dt>{zh ? '标识' : 'Identifier'}</dt>
                      <dd>{resourcePreview.item.sourceId || resourcePreview.item.slug}</dd>
                    </div>
                    {resourcePreview.origin === 'catalog' && resourcePreview.type === 'agent' && resourcePreview.item.backend_id && (
                      <div><dt>{zh ? '类型' : 'Type'}</dt><dd>{resourcePreview.item.backend_id}</dd></div>
                    )}
                    {resourcePreview.origin === 'catalog' && resourcePreview.type === 'skill' && resourcePreview.item.version && (
                      <div><dt>{zh ? '版本' : 'Version'}</dt><dd>{resourcePreview.item.version}</dd></div>
                    )}
                    {resourcePreview.origin === 'local' && resourcePreview.item.transport && (
                      <div><dt>{zh ? '传输方式' : 'Transport'}</dt><dd>{resourcePreview.item.transport}</dd></div>
                    )}
                    {resourcePreview.origin === 'catalog' && (
                      <div><dt>{zh ? '访问范围' : 'Access'}</dt><dd>{accessLabel(resourcePreview.item, zh)}</dd></div>
                    )}
                  </dl>
                </div>
                <div className={css.detailActions}>
                  <button type="button" className={css.secondaryButton} onClick={() => setResourcePreview(null)}>
                    {zh ? '关闭' : 'Close'}
                  </button>
                  {resourcePreview.origin === 'catalog' && resourcePreview.type !== 'mcp' && (
                    <button
                      type="button"
                      className={css.primaryButton}
                      disabled={Boolean(busy)}
                      onClick={() => {
                        const item = resourcePreview.item;
                        const type = resourcePreview.type;
                        setResourcePreview(null);
                        if (type === 'agent') void installAgent(item.slug);
                        else void installSkill(item.slug);
                      }}
                    >
                      {zh ? '安装 / 同步到本地' : 'Install / sync locally'}
                    </button>
                  )}
                </div>
              </section>
            </div>,
            document.body,
          )}
        </>
      )}
    </div>
  );
}
