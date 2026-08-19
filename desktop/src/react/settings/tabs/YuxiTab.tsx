import { useCallback, useEffect, useState, type FormEvent } from 'react';
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

export function YuxiTab() {
  const zh = (window.i18n?.locale || 'zh-CN').toLowerCase().startsWith('zh');
  const [session, setSession] = useState<YuxiSession | null>(null);
  const [baseUrl, setBaseUrl] = useState('http://127.0.0.1:5050');
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
      setBaseUrl(nextSession.baseUrl || 'http://127.0.0.1:5050');
      setRequireLogin(nextSession.requireLogin ?? true);
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
  }, []);

  useEffect(() => {
    void loadSession(true);
  }, [loadSession]);

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

      {!session.authenticated && (
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
      )}
    </div>
  );
}
