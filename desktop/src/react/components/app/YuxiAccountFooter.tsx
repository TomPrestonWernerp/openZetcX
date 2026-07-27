import { useCallback, useEffect, useRef, useState } from 'react';
import { hanaFetch } from '../../hooks/use-hana-fetch';
import { openSettingsModal } from '../../stores/settings-modal-actions';
import type { AutoUpdateState } from '../../types';
import styles from './YuxiAccountFooter.module.css';

interface YuxiSession {
  authenticated: boolean;
  user: {
    username?: string;
    uid?: string;
    role?: string;
    department_name?: string | null;
  } | null;
}

function updateMessage(state: AutoUpdateState | undefined, zh: boolean): string {
  if (!state) return zh ? 'Yuxi 会话已刷新' : 'Yuxi session refreshed';
  if (state.status === 'latest') return zh ? '已是最新版本' : 'You are up to date';
  if (state.status === 'available' || state.status === 'downloading' || state.status === 'downloaded') {
    return state.version
      ? (zh ? `发现新版本 v${state.version}` : `Version v${state.version} is available`)
      : (zh ? '发现新版本' : 'An update is available');
  }
  if (state.status === 'error') return state.error || (zh ? '检查更新失败' : 'Update check failed');
  return zh ? '已完成更新检查' : 'Update check complete';
}

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      className={spinning ? styles.spin : undefined}
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}

export function YuxiAccountFooter() {
  const zh = (window.i18n?.locale || 'zh-CN').toLowerCase().startsWith('zh');
  const [session, setSession] = useState<YuxiSession | null>(null);
  const [checking, setChecking] = useState(false);
  const [feedback, setFeedback] = useState('');
  const feedbackTimer = useRef<number | null>(null);

  const loadSession = useCallback(async (verify = false) => {
    const response = await hanaFetch(`/api/yuxi/session${verify ? '?verify=1' : ''}`, { timeout: 8_000 });
    const nextSession = await response.json() as YuxiSession;
    setSession(nextSession);
    return nextSession;
  }, []);

  useEffect(() => {
    let alive = true;
    void loadSession().catch(() => {
      if (alive) setSession({ authenticated: false, user: null });
    });

    const handleSessionChanged = () => {
      void loadSession(true).catch(() => setSession({ authenticated: false, user: null }));
    };
    window.addEventListener('yuxi-session-changed', handleSessionChanged);
    return () => {
      alive = false;
      window.removeEventListener('yuxi-session-changed', handleSessionChanged);
      if (feedbackTimer.current !== null) window.clearTimeout(feedbackTimer.current);
    };
  }, [loadSession]);

  const showFeedback = useCallback((message: string) => {
    setFeedback(message);
    if (feedbackTimer.current !== null) window.clearTimeout(feedbackTimer.current);
    feedbackTimer.current = window.setTimeout(() => {
      setFeedback('');
      feedbackTimer.current = null;
    }, 4_000);
  }, []);

  async function checkForUpdates() {
    if (checking) return;
    setChecking(true);
    showFeedback(zh ? '正在检查更新…' : 'Checking for updates…');
    try {
      const [sessionResult, updateResult] = await Promise.allSettled([
        loadSession(true),
        window.hana?.autoUpdateCheck?.(),
      ]);

      if (sessionResult.status === 'rejected' && updateResult.status === 'rejected') {
        throw updateResult.reason || sessionResult.reason;
      }
      const updateState = updateResult.status === 'fulfilled' ? updateResult.value : undefined;
      showFeedback(updateMessage(updateState, zh));
    } catch (error) {
      showFeedback(error instanceof Error ? error.message : (zh ? '检查更新失败' : 'Update check failed'));
    } finally {
      setChecking(false);
    }
  }

  const userName = session?.user?.username || session?.user?.uid;
  const primaryText = session === null
    ? (zh ? '正在验证 Yuxi…' : 'Verifying Yuxi…')
    : session.authenticated && userName
      ? userName
      : (zh ? '登录 Yuxi' : 'Sign in to Yuxi');
  const identityMeta = [
    session?.user?.department_name,
    session?.user?.role,
  ].filter(Boolean).join(' · ');
  const secondaryText = feedback || identityMeta || (
    session?.authenticated
      ? (zh ? '账号已验证' : 'Account verified')
      : (zh ? '同步 Agent、Skill 与知识库' : 'Sync agents, skills, and knowledge')
  );
  const initial = userName ? Array.from(userName)[0]?.toUpperCase() : 'Y';
  const updateLabel = zh ? '检查更新' : 'Check for updates';

  return (
    <div className={styles.root}>
      <button
        type="button"
        className={styles.identity}
        onClick={() => openSettingsModal('yuxi')}
        title={zh ? '打开 Yuxi 账号与资源中心' : 'Open Yuxi account and resources'}
      >
        <span className={styles.avatar} aria-hidden="true">{initial}</span>
        <span className={styles.text}>
          <strong>{primaryText}</strong>
          <small className={feedback ? styles.feedback : undefined}>{secondaryText}</small>
        </span>
        {session?.authenticated && <span className={styles.verified} title={zh ? 'Yuxi 已验证' : 'Verified by Yuxi'} />}
      </button>
      <button
        type="button"
        className={styles.updateButton}
        title={feedback || updateLabel}
        aria-label={updateLabel}
        aria-busy={checking}
        disabled={checking}
        onClick={() => void checkForUpdates()}
      >
        <RefreshIcon spinning={checking} />
      </button>
      <span className={styles.liveStatus} role="status" aria-live="polite">{feedback}</span>
    </div>
  );
}
