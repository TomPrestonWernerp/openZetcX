import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { hasServerConnection } from '../../services/server-connection';
import { hanaFetch } from '../api';
import { useSettingsStore } from '../store';
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

const ONLINE_SERVICE_BASE_URL = 'https://openzetc.zjshjkj.com';

export function YuxiTab() {
  const zh = (window.i18n?.locale || 'zh-CN').toLowerCase().startsWith('zh');
  const connectionReady = useSettingsStore(hasServerConnection);
  const settingsReady = useSettingsStore(state => state.ready);
  const [session, setSession] = useState<YuxiSession | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [requireLogin, setRequireLogin] = useState(true);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const loadSession = useCallback(async (verify = false) => {
    setError('');
    try {
      const response = await hanaFetch(`/api/yuxi/session${verify ? '?verify=1' : ''}`, { timeout: 8_000 });
      const nextSession = await response.json() as YuxiSession;
      setSession(nextSession);
      setRequireLogin(nextSession.requireLogin ?? true);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
      setSession(current => current || {
        authenticated: false,
        baseUrl: ONLINE_SERVICE_BASE_URL,
        requireLogin: false,
        user: null,
        access: null,
      });
    }
  }, []);

  useEffect(() => {
    if (!connectionReady) return;
    void loadSession(true);
  }, [connectionReady, loadSession]);

  async function login(event: FormEvent) {
    event.preventDefault();
    setBusy('login');
    setError('');
    setNotice('');
    try {
      const response = await hanaFetch('/api/yuxi/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: ONLINE_SERVICE_BASE_URL,
          username,
          password,
          requireLogin,
        }),
        timeout: 20_000,
      });
      const nextSession = await response.json() as YuxiSession;
      setSession(nextSession);
      setPassword('');
      window.dispatchEvent(new CustomEvent('yuxi-session-changed'));
      setNotice(zh ? '登录成功。' : 'Signed in successfully.');
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : String(loginError));
    } finally {
      setBusy('');
    }
  }

  async function logout() {
    setBusy('logout');
    setError('');
    setNotice('');
    try {
      const response = await hanaFetch('/api/yuxi/logout', { method: 'POST' });
      setSession(await response.json());
      window.dispatchEvent(new CustomEvent('yuxi-session-changed'));
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

  if (!connectionReady || !session) {
    const loadingMessage = !connectionReady && settingsReady
      ? (zh ? '本地服务连接未就绪，请稍后重试…' : 'Local service connection is not ready. Please try again shortly…')
      : (zh ? '正在检查账号登录状态…' : 'Checking account session…');
    return <div className={css.loading}>{loadingMessage}</div>;
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

      {!session.authenticated && (
        <form className={css.loginForm} onSubmit={login}>
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
      )}
    </div>
  );
}
