import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { hanaFetch } from '../hooks/use-hana-fetch';
import { useStore } from '../stores';
import css from './YuxiAuthGate.module.css';

type GateSession = {
  authenticated: boolean;
  baseUrl: string;
  requireLogin: boolean;
  user: { username?: string; uid?: string } | null;
  access?: {
    roles: Array<{ id: number; code: string; name: string }>;
    permissions: Record<string, 'own' | 'department' | 'global'>;
  } | null;
};

const ONLINE_SERVICE_BASE_URL = 'https://openzetc.zjshjkj.com';

const DEFAULT_SESSION: GateSession = {
  authenticated: false,
  baseUrl: ONLINE_SERVICE_BASE_URL,
  requireLogin: false,
  user: null,
};

async function responseMessage(response: Response) {
  try {
    const data = await response.json();
    return data?.error || data?.detail || data?.message || `${response.status} ${response.statusText}`;
  } catch {
    return `${response.status} ${response.statusText}`;
  }
}

export function YuxiAuthGate({ children }: { children: ReactNode }) {
  const connected = useStore(state => state.connected);
  const locale = useStore(state => state.locale);
  const zh = String(locale || window.i18n?.locale || 'zh-CN').toLowerCase().startsWith('zh');
  const [session, setSession] = useState<GateSession>(DEFAULT_SESSION);
  const [checking, setChecking] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!useStore.getState().connected) return;
    setChecking(true);
    setError('');
    try {
      const response = await hanaFetch('/api/yuxi/session', { throwOnHttpError: false, timeout: 8_000 });
      if (!response.ok) throw new Error(await responseMessage(response));
      let nextSession = await response.json() as GateSession;
      setSession(nextSession);
      if (nextSession.authenticated) {
        const verified = await hanaFetch('/api/yuxi/session?verify=1', {
          throwOnHttpError: false,
          timeout: 8_000,
        });
        if (!verified.ok) {
          setBlocked(Boolean(nextSession.requireLogin));
          setError(await responseMessage(verified));
          return;
        }
        nextSession = await verified.json() as GateSession;
        setSession(nextSession);
      }
      setBlocked(Boolean(nextSession.requireLogin && !nextSession.authenticated));
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
      setBlocked(session.requireLogin);
    } finally {
      setChecking(false);
    }
  }, [session.requireLogin]);

  useEffect(() => {
    if (connected) void refresh();
  }, [connected, refresh]);

  useEffect(() => {
    const onSessionChanged = () => void refresh();
    window.addEventListener('yuxi-session-changed', onSessionChanged);
    return () => window.removeEventListener('yuxi-session-changed', onSessionChanged);
  }, [refresh]);

  async function login(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await hanaFetch('/api/yuxi/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: ONLINE_SERVICE_BASE_URL,
          username,
          password,
          requireLogin: true,
        }),
        throwOnHttpError: false,
        timeout: 20_000,
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      const nextSession = await response.json() as GateSession;
      setSession(nextSession);
      setPassword('');
      setBlocked(false);
      window.dispatchEvent(new CustomEvent('yuxi-session-changed'));
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : String(loginError));
    } finally {
      setBusy(false);
    }
  }

  if (!connected || (!blocked && !checking)) return children;

  if (checking && !blocked) {
    return (
      <div className={css.root}>
        <div className={css.loading}>{zh ? '正在进行线上验证…' : 'Verifying online identity…'}</div>
      </div>
    );
  }

  return (
    <div className={css.root}>
      <form className={css.card} onSubmit={login}>
        <div className={css.brand}>openZetc</div>
        <h1>{zh ? '登录以继续' : 'Sign in to continue'}</h1>
        <p>{zh
          ? '此 openZetc 已启用线上验证。请使用同一账号访问有权限的 Agent、Skill 与知识库。'
          : 'This openZetc installation requires online verification. Use the same account to access permitted agents, skills, and knowledge bases.'}</p>
        {error && <div className={css.error} role="alert">{error}</div>}
        <label>
          <span>{zh ? '账号 / 用户 ID / 手机号' : 'Account / user ID / phone'}</span>
          <input value={username} onChange={event => setUsername(event.target.value)} autoComplete="username" required />
        </label>
        <label>
          <span>{zh ? '密码' : 'Password'}</span>
          <input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" required />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? (zh ? '正在验证…' : 'Signing in…') : (zh ? '登录' : 'Sign in')}
        </button>
        <small>{zh ? '密码只用于身份验证，本地不保存。' : 'The password is used only for identity verification and is not stored locally.'}</small>
      </form>
    </div>
  );
}
