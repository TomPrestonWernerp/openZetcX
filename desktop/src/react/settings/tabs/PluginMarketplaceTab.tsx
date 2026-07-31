import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSettingsStore } from '../store';
import { hanaFetch } from '../api';
import { t } from '../helpers';
import { SettingsSection } from '../components/SettingsSection';
import styles from '../Settings.module.css';

interface YuxiSkill {
  id?: number | string;
  slug: string;
  name?: string;
  description?: string;
  version?: string;
  source_type?: string;
  created_by?: string;
  updated_at?: string;
  enabled?: boolean;
  is_builtin?: boolean;
  can_manage?: boolean;
  tool_dependencies?: string[];
  mcp_dependencies?: string[];
  skill_dependencies?: string[];
  share_config?: {
    access_level?: 'global' | 'department' | 'user' | string;
    department_ids?: Array<number | string>;
    user_uids?: string[];
  };
}

interface YuxiSession {
  authenticated: boolean;
  baseUrl?: string;
  user?: {
    username?: string;
    uid?: string;
    department_name?: string | null;
  } | null;
  access?: {
    permissions: Record<string, 'own' | 'department' | 'global'>;
  } | null;
}

function accessLabel(skill: YuxiSkill, zh: boolean): string {
  switch (skill.share_config?.access_level) {
    case 'global':
      return zh ? '公司 / 全局' : 'Company / Global';
    case 'department':
      return zh ? '部门' : 'Department';
    case 'user':
      return zh ? '个人' : 'Personal';
    default:
      return zh ? '账号可访问' : 'Accessible';
  }
}

function skillDependencies(skill: YuxiSkill): string[] {
  return [
    ...(skill.tool_dependencies || []).map(item => `Tool · ${item}`),
    ...(skill.mcp_dependencies || []).map(item => `MCP · ${item}`),
    ...(skill.skill_dependencies || []).map(item => `Skill · ${item}`),
  ];
}

export function PluginMarketplaceTab() {
  const showToast = useSettingsStore(state => state.showToast);
  const set = useSettingsStore(state => state.set);
  const zh = (window.i18n?.locale || 'zh-CN').toLowerCase().startsWith('zh');
  const [session, setSession] = useState<YuxiSession | null>(null);
  const [skills, setSkills] = useState<YuxiSkill[] | null>(null);
  const [selectedSlug, setSelectedSlug] = useState('');
  const [loading, setLoading] = useState(false);
  const [installingSlug, setInstallingSlug] = useState('');
  const [syncedSlugs, setSyncedSlugs] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState('');
  const [permissionDenied, setPermissionDenied] = useState(false);

  const selectedSkill = useMemo(
    () => skills?.find(skill => skill.slug === selectedSlug) || skills?.[0] || null,
    [selectedSlug, skills],
  );

  const loadMarketplace = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const sessionResponse = await hanaFetch('/api/yuxi/session?verify=1', { timeout: 8_000 });
      const nextSession = await sessionResponse.json() as YuxiSession;
      setSession(nextSession);
      setPermissionDenied(false);
      if (!nextSession.authenticated) {
        setSkills([]);
        setSelectedSlug('');
        return;
      }
      if (!nextSession.access?.permissions?.['skill.view']) {
        setPermissionDenied(true);
        setSkills([]);
        setSelectedSlug('');
        return;
      }

      const response = await hanaFetch('/api/yuxi/skills');
      const data = await response.json();
      const nextSkills = Array.isArray(data.skills) ? data.skills as YuxiSkill[] : [];
      setSkills(nextSkills);
      setSelectedSlug(current => (
        current && nextSkills.some(skill => skill.slug === current)
          ? current
          : nextSkills[0]?.slug || ''
      ));
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : String(loadError);
      setError(message);
      setSkills([]);
      showToast(`${zh ? 'Skill 市场加载失败' : 'Skill Marketplace failed to load'}: ${message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast, zh]);

  useEffect(() => {
    void loadMarketplace();
  }, [loadMarketplace]);

  async function installSkill(skill: YuxiSkill) {
    setInstallingSlug(skill.slug);
    setError('');
    try {
      const response = await hanaFetch(`/api/yuxi/skills/${encodeURIComponent(skill.slug)}/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        timeout: 120_000,
      });
      const data = await response.json();
      const skillName = data.skill?.name || skill.name || skill.slug;
      setSyncedSlugs(current => new Set(current).add(skill.slug));
      showToast(
        zh ? `Skill“${skillName}”已安装 / 同步到本地` : `Skill “${skillName}” installed / synced locally`,
        'success',
      );
    } catch (installError) {
      const message = installError instanceof Error ? installError.message : String(installError);
      setError(message);
      showToast(`${zh ? 'Skill 安装失败' : 'Skill installation failed'}: ${message}`, 'error');
    } finally {
      setInstallingSlug('');
    }
  }

  const accountName = session?.user?.username || session?.user?.uid || '';
  const statusText = skills
    ? `${skills.length} ${zh ? '个 Skill' : skills.length === 1 ? 'Skill' : 'Skills'}${accountName ? ` · ${accountName}` : ''}`
    : '';

  return (
    <div className={`${styles['settings-tab-content']} ${styles.active}`} data-tab="plugin-marketplace">
      <div className={styles['plugin-marketplace-toolbar']}>
        <button
          type="button"
          className={styles['settings-return-btn']}
          onClick={() => set({ activeTab: 'plugins' })}
          aria-label={t('settings.plugins.marketBack')}
          title={t('settings.plugins.marketBack')}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <span className={styles['skills-list-desc']}>
          {zh
            ? '浏览当前账号有权访问的 Skill，并安装或同步到本地。'
            : 'Browse Skills available to the current account and install or sync them locally.'}
        </span>
        <div className={styles['plugin-marketplace-toolbar-actions']}>
          {skills && (
            <>
              <span className={styles['skills-source-badge']} style={{ marginRight: 0 }}>openZetc</span>
              <span className={styles['skills-source-badge']} style={{ marginRight: 0 }}>{statusText}</span>
            </>
          )}
          <button
            type="button"
            className={styles['settings-icon-btn']}
            title={zh ? '刷新 Skill' : 'Refresh Skills'}
            aria-label={zh ? '刷新 Skill' : 'Refresh Skills'}
            onClick={() => void loadMarketplace()}
            disabled={loading}
          >
            <svg
              width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
              className={loading ? styles.spin : ''}
            >
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          </button>
        </div>
      </div>

      <SettingsSection variant="flush">
        {skills === null ? (
          <p className={`${styles['settings-muted-note']} ${styles['skills-empty']}`}>
            {zh ? '正在读取 Skill 市场…' : 'Loading Skill Marketplace…'}
          </p>
        ) : !session?.authenticated ? (
          <div className={styles['plugin-marketplace-empty-state']}>
            <strong>{zh ? '请先完成线上登录' : 'Sign in online first'}</strong>
            <span>
              {zh
                ? '登录后，这里会显示该账号在公司、部门及个人范围内可访问的 Skill。'
                : 'After sign-in, Skills available at company, department, and personal scopes appear here.'}
            </span>
            <button type="button" className={styles['settings-save-btn-sm']} onClick={() => set({ activeTab: 'yuxi' })}>
              {zh ? '前往登录' : 'Go to sign-in'}
            </button>
          </div>
        ) : permissionDenied ? (
          <div className={styles['plugin-marketplace-empty-state']}>
            <strong>{zh ? '当前角色不能查看 Skill 市场' : 'The current role cannot view the Skill Marketplace'}</strong>
            <span>{zh ? '请联系管理员为账号授予 skill.view 权限。' : 'Ask an administrator to grant the skill.view permission.'}</span>
          </div>
        ) : error ? (
          <div className={styles['plugin-marketplace-empty-state']}>
            <strong>{zh ? 'Skill 加载失败' : 'Failed to load Skills'}</strong>
            <span>{error}</span>
            <button type="button" className={styles['settings-save-btn-sm']} onClick={() => void loadMarketplace()}>
              {zh ? '重试' : 'Retry'}
            </button>
          </div>
        ) : skills.length === 0 ? (
          <p className={`${styles['settings-muted-note']} ${styles['skills-empty']}`}>
            {zh ? '当前账号没有可访问的 Skill。' : 'This account has no accessible Skills.'}
          </p>
        ) : (
          <div className={styles['plugin-marketplace-grid']}>
            <div className={styles['skills-list-block']}>
              {skills.map(skill => (
                <button
                  type="button"
                  key={skill.slug}
                  className={`${styles['skills-list-item']} ${styles['plugin-marketplace-skill-row']}`}
                  onClick={() => setSelectedSlug(skill.slug)}
                  aria-pressed={selectedSkill?.slug === skill.slug}
                  style={selectedSkill?.slug === skill.slug ? { background: 'var(--bg-hover)' } : undefined}
                >
                  <span className={styles['plugin-marketplace-skill-icon']}>S</span>
                  <span className={styles['skills-list-info']}>
                    <span className={styles['plugin-marketplace-skill-title']}>
                      <span className={styles['skills-list-name']}>{skill.name || skill.slug}</span>
                      {skill.version && <span className={styles['skills-list-name-hint']}>v{skill.version}</span>}
                    </span>
                    <span className={styles['skills-list-desc']}>{skill.description || (zh ? '暂无描述' : 'No description')}</span>
                    <span className={styles['skills-list-desc']}>
                      {accessLabel(skill, zh)} · {skill.slug}
                    </span>
                  </span>
                </button>
              ))}
            </div>

            <div className={styles['skills-list-block']}>
              <div className={styles['plugin-marketplace-skill-detail']}>
                {selectedSkill && (
                  <>
                    <div className={styles['plugin-marketplace-detail-header']}>
                      <div style={{ minWidth: 0 }}>
                        <div className={styles['skills-list-name']}>{selectedSkill.name || selectedSkill.slug}</div>
                        <div className={styles['skills-list-desc']}>
                          {selectedSkill.slug}
                          {selectedSkill.version ? ` · v${selectedSkill.version}` : ''}
                        </div>
                      </div>
                      <button
                        type="button"
                        className={styles['settings-save-btn-sm']}
                        disabled={installingSlug === selectedSkill.slug}
                        onClick={() => void installSkill(selectedSkill)}
                      >
                        {installingSlug === selectedSkill.slug
                          ? (zh ? '正在同步…' : 'Syncing…')
                          : syncedSlugs.has(selectedSkill.slug)
                            ? (zh ? '重新同步到本地' : 'Sync again')
                            : (zh ? '安装 / 同步到本地' : 'Install / sync locally')}
                      </button>
                    </div>

                    <div className={styles['plugin-marketplace-scope-row']}>
                      <span className={styles['skills-source-badge']} style={{ marginRight: 0 }}>
                        {accessLabel(selectedSkill, zh)}
                      </span>
                      {selectedSkill.is_builtin && (
                        <span className={styles['skills-source-badge']} style={{ marginRight: 0 }}>
                          {zh ? '平台内置' : 'Built into the platform'}
                        </span>
                      )}
                      {syncedSlugs.has(selectedSkill.slug) && (
                        <span className={styles['skills-source-badge']} style={{ marginRight: 0 }}>
                          {zh ? '本次已同步' : 'Synced'}
                        </span>
                      )}
                    </div>

                    <div className={styles['plugin-marketplace-description']}>
                      {selectedSkill.description || (zh ? '暂无描述' : 'No description')}
                    </div>

                    <div className={styles['plugin-marketplace-metadata']}>
                      <div>
                        <span>{zh ? '发布者' : 'Publisher'}</span>
                        <strong>{selectedSkill.created_by || 'openZetc'}</strong>
                      </div>
                      <div>
                        <span>{zh ? '来源' : 'Source'}</span>
                        <strong>{selectedSkill.source_type || 'openZetc'}</strong>
                      </div>
                      <div>
                        <span>{zh ? '可见范围' : 'Visibility'}</span>
                        <strong>{accessLabel(selectedSkill, zh)}</strong>
                      </div>
                    </div>

                    <div>
                      <div className={styles['plugin-marketplace-section-title']}>
                        {zh ? '运行依赖' : 'Runtime dependencies'}
                      </div>
                      <div className={styles['plugin-marketplace-scope-row']}>
                        {skillDependencies(selectedSkill).length
                          ? skillDependencies(selectedSkill).map(item => (
                              <span key={item} className={styles['skills-source-badge']} style={{ marginRight: 0 }}>{item}</span>
                            ))
                          : <span className={styles['skills-list-desc']}>{zh ? '无额外依赖' : 'No additional dependencies'}</span>}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </SettingsSection>
    </div>
  );
}
