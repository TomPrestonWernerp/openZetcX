/**
 * channel-actions.ts 鈥?Channel 鍓綔鐢ㄦ搷浣滐紙缃戠粶璇锋眰 + 鐘舵€佽仈鍔級
 *
 * 浠?channel-slice.ts 鎻愬彇锛屾墍鏈夊嚱鏁伴€氳繃 useStore.getState() / useStore.setState() 璁块棶 store銆?
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- API 鍝嶅簲 JSON 鍙?catch(err: any) */

import { useStore } from './index';
import { hanaFetch } from '../hooks/use-hana-fetch';
import { hasServerConnection } from '../services/server-connection';
import { activateWorkspaceDesk } from './desk-actions';
import type { AgentPhoneActivity, AgentPhoneSettings, AgentPhoneToolMode, Channel, ChannelAgentActivities, ChannelMessage } from '../types';
import { WORKSPACE_OUTPUT_ROOT_DIRNAME } from '../../../../shared/workspace-output.ts';

// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲
// 鍔犺浇棰戦亾鍒楄〃
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲

export async function loadChannels(): Promise<void> {
  const s = useStore.getState();
  if (!hasServerConnection(s)) return;
  try {
    const [chRes, dmRes] = await Promise.all([
      hanaFetch('/api/channels'),
      hanaFetch('/api/dm'),
    ]);

    const chData = chRes.ok ? await chRes.json() : { channels: [] };
    const dmData = dmRes.ok ? await dmRes.json() : { dms: [] };

    const channels: Channel[] = (chData.channels || []).map((ch: any) => ({
      ...ch,
      isDM: false,
    }));

    const dms: Channel[] = (dmData.dms || []).map((dm: any) => {
      const dmOwnerId = dm.ownerAgentId || dmData.ownerAgentId || undefined;
      return {
        id: `dm:${dm.peerId}`,
        name: dm.peerName || dm.peerId,
        members: [dm.peerId],
        lastMessage: dm.lastMessage || '',
        lastSender: dm.lastSender || '',
        lastTimestamp: dm.lastTimestamp || '',
        newMessageCount: 0,
        messageCount: dm.messageCount || 0,
        isDM: true,
        dmOwnerId,
        peerId: dm.peerId,
        peerName: dm.peerName,
      };
    });

    const allChannels = [...channels, ...dms];
    const totalUnread = allChannels.reduce((sum, ch) => sum + (ch.newMessageCount || 0), 0);
    useStore.setState({ channels: allChannels, channelTotalUnread: totalUnread });
  } catch (err) {
    console.error('[channels] load failed:', err);
  }
}

function keyActivities(activities: AgentPhoneActivity[]): Record<string, AgentPhoneActivity[]> {
  const keyed: Record<string, AgentPhoneActivity[]> = {};
  for (const activity of activities || []) {
    if (!activity?.agentId) continue;
    keyed[activity.agentId] = [activity];
  }
  return keyed;
}

export async function loadConversationAgentActivities(conversationId: string): Promise<void> {
  const s = useStore.getState();
  if (!conversationId || !hasServerConnection(s)) return;
  try {
    const res = await hanaFetch(`/api/conversations/${encodeURIComponent(conversationId)}/agent-activities`);
    if (!res.ok) return;
    const data = await res.json();
    const activities = keyActivities(data.activities || []);
    const latestState = useStore.getState();
    const current = (latestState.channelAgentActivities || {}) as ChannelAgentActivities;
    useStore.setState({
      channelAgentActivities: {
        ...current,
        [conversationId]: activities,
      },
      channelTickerStatus: {
        ...(latestState.channelTickerStatus || {}),
        [conversationId]: data.ticker || null,
      },
    });
  } catch (err) {
    console.error('[channels] load agent activities failed:', err);
  }
}

export function upsertConversationAgentActivity(activity: AgentPhoneActivity): void {
  if (!activity?.conversationId || !activity.agentId) return;
  const state = useStore.getState();
  const current = (state.channelAgentActivities || {}) as ChannelAgentActivities;
  const byAgent = current[activity.conversationId] || {};
  const history = byAgent[activity.agentId] || [];
  const nextHistory = [
    activity,
    ...history.filter((item: AgentPhoneActivity) =>
      item.timestamp !== activity.timestamp || item.state !== activity.state || item.summary !== activity.summary),
  ].slice(0, 20);

  useStore.setState({
    channelAgentActivities: {
      ...current,
      [activity.conversationId]: {
        ...byAgent,
        [activity.agentId]: nextHistory,
      },
    },
  });
}

function normalizeAgentPhoneToolMode(mode: unknown): AgentPhoneToolMode {
  return mode === 'write' ? 'write' : 'read_only';
}

function conversationOwnerQuery(conversationId: string): string {
  if (!conversationId.startsWith('dm:')) return '';
  const channel = useStore.getState().channels.find((ch: Channel) => ch.id === conversationId);
  return channel?.dmOwnerId ? `?agentId=${encodeURIComponent(channel.dmOwnerId)}` : '';
}

function conversationPhoneSettingsUrl(conversationId: string): string {
  return `/api/conversations/${encodeURIComponent(conversationId)}/agent-phone-settings${conversationOwnerQuery(conversationId)}`;
}

function normalizeNullablePositiveInt(value: unknown): number | null {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.floor(num);
}

function normalizeAgentPhoneSettings(data: any): AgentPhoneSettings {
  const overrideModel = data?.modelOverrideModel;
  return {
    mode: normalizeAgentPhoneToolMode(data?.mode),
    replyMinChars: normalizeNullablePositiveInt(data?.replyMinChars),
    replyMaxChars: normalizeNullablePositiveInt(data?.replyMaxChars),
    proactiveEnabled: data?.proactiveEnabled !== false,
    reminderIntervalMinutes: normalizeNullablePositiveInt(data?.reminderIntervalMinutes) || 31,
    guardLimit: normalizeNullablePositiveInt(data?.guardLimit) || 36,
    modelOverrideEnabled: data?.modelOverrideEnabled === true,
    modelOverrideModel: overrideModel?.id && overrideModel?.provider
      ? { id: String(overrideModel.id), provider: String(overrideModel.provider) }
      : null,
  };
}

function applyAgentPhoneSettings(settings: AgentPhoneSettings): void {
  useStore.setState({
    channelAgentPhoneToolMode: settings.mode,
    channelAgentReplyMinChars: settings.replyMinChars,
    channelAgentReplyMaxChars: settings.replyMaxChars,
    channelAgentProactiveEnabled: settings.proactiveEnabled,
    channelAgentReminderIntervalMinutes: settings.reminderIntervalMinutes,
    channelAgentGuardLimit: settings.guardLimit,
    channelAgentModelOverrideEnabled: settings.modelOverrideEnabled,
    channelAgentModelOverrideModel: settings.modelOverrideModel,
  });
}

function normalizeWorkspaceFolderName(value: string): string {
  const normalized = value
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  return normalized || 'channel';
}

function joinWorkspacePath(root: string, ...parts: string[]): string {
  const separator = root.includes('\\') && !root.includes('/') ? '\\' : '/';
  const base = root.replace(/[\\/]+$/g, '');
  return [base, ...parts.map(part => part.replace(/^[\\/]+|[\\/]+$/g, '')).filter(Boolean)].join(separator);
}

function isAbsoluteWorkspacePath(value: string): boolean {
  return /^(?:[A-Za-z]:[\\/]|[\\/]{2}|\/)/.test(value.trim());
}

function defaultChannelWorkspaceParentRoot(s: ReturnType<typeof useStore.getState>): string {
  return s.homeFolder || s.selectedFolder || '';
}

function defaultChannelWorkspaceBaseRoot(s: ReturnType<typeof useStore.getState>): string {
  const workspaceRoot = defaultChannelWorkspaceParentRoot(s);
  return workspaceRoot ? joinWorkspacePath(workspaceRoot, WORKSPACE_OUTPUT_ROOT_DIRNAME) : '';
}

function resolveRelativeChannelWorkspaceRoot(value: string, s: ReturnType<typeof useStore.getState>, mode: 'base' | 'channel'): string | null {
  const relative = value.trim().replace(/^[\\/]+|[\\/]+$/g, '');
  if (!relative || relative === '.' || relative.includes('..')) return null;
  const parentRoot = defaultChannelWorkspaceParentRoot(s);
  if (!parentRoot) return null;
  if (mode === 'base' || relative === WORKSPACE_OUTPUT_ROOT_DIRNAME || relative.startsWith(`${WORKSPACE_OUTPUT_ROOT_DIRNAME}/`)) {
    return joinWorkspacePath(parentRoot, relative);
  }
  const baseRoot = defaultChannelWorkspaceBaseRoot(s);
  return baseRoot ? joinWorkspacePath(baseRoot, relative) : null;
}

function resolveChannelWorkspaceRootValue(value: unknown, s: ReturnType<typeof useStore.getState>, mode: 'base' | 'channel'): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (isAbsoluteWorkspacePath(trimmed)) return trimmed;
  return resolveRelativeChannelWorkspaceRoot(trimmed, s, mode);
}

async function ensureDeskFolder(root: string, subdir: string, name: string): Promise<void> {
  try {
    const res = await hanaFetch('/api/desk/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      throwOnHttpError: false,
      body: JSON.stringify({
        action: 'mkdir',
        dir: root,
        subdir,
        name,
      }),
    });
    if (!res.ok && res.status !== 409) {
      console.warn('[channels] ensure channel workspace folder failed:', `${res.status} ${res.statusText}`);
    }
  } catch (err) {
    console.warn('[channels] ensure channel workspace folder failed:', err);
  }
}

async function persistChannelWorkspace(channelId: string, workspaceRoot: string): Promise<void> {
  try {
    const res = await hanaFetch(`/api/channels/${encodeURIComponent(channelId)}/workspace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      throwOnHttpError: false,
      body: JSON.stringify({ workspaceRoot }),
    });
    if (!res.ok && res.status !== 404) {
      console.warn('[channels] persist channel workspace failed:', `${res.status} ${res.statusText}`);
    }
  } catch (err) {
    console.warn('[channels] persist channel workspace failed:', err);
  }
}

function rememberChannelWorkspace(channelId: string, workspaceRoot: string): void {
  const latest = useStore.getState();
  const previous = latest.channelWorkspaceById?.[channelId] || {};
  useStore.setState({
    channels: latest.channels.map((item: Channel) =>
      item.id === channelId ? { ...item, workspaceRoot } : item,
    ),
    channelWorkspaceById: {
      ...(latest.channelWorkspaceById || {}),
      [channelId]: {
        ...previous,
        workspaceRoot,
      },
    },
  });
}

function configuredChannelWorkspaceRoot(channel: Pick<Channel, 'id' | 'name' | 'workspaceRoot'> | undefined): string | null {
  const s = useStore.getState();
  const channelWorkspace = channel?.id ? s.channelWorkspaceById?.[channel.id] : null;
  const latestChannel = channel?.id
    ? s.channels.find((item: Channel) => item.id === channel.id)
    : null;
  const candidates = [
    channelWorkspace?.workspaceRoot,
    channel?.workspaceRoot,
    latestChannel?.workspaceRoot,
  ];
  for (const candidate of candidates) {
    const resolved = resolveChannelWorkspaceRootValue(candidate, s, 'channel');
    if (resolved) return resolved;
  }
  return null;
}

async function ensureAbsoluteFolder(folder: string): Promise<void> {
  const normalized = folder.replace(/[\\/]+$/g, '');
  const idx = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
  if (idx <= 0) return;
  await ensureDeskFolder(normalized.slice(0, idx), '', normalized.slice(idx + 1));
}

async function activateChannelWorkspace(channel: Pick<Channel, 'id' | 'name' | 'workspaceRoot'> | undefined, displayName: string): Promise<string | null> {
  const s = useStore.getState();
  const configuredRoot = configuredChannelWorkspaceRoot(channel);
  const globalRoot = resolveChannelWorkspaceRootValue(s.channelWorkspaceRoot, s, 'base') || '';
  const baseRoot = globalRoot || defaultChannelWorkspaceBaseRoot(s);

  const folderName = normalizeWorkspaceFolderName(displayName || channel?.name || channel?.id || '');
  const targetRoot = configuredRoot
    || (baseRoot ? joinWorkspacePath(baseRoot, folderName) : '');
  if (!targetRoot) return null;

  if (configuredRoot) {
    await ensureAbsoluteFolder(configuredRoot);
  } else {
    await ensureDeskFolder(baseRoot, '', folderName);
  }
  if (channel?.id) {
    rememberChannelWorkspace(channel.id, targetRoot);
    await persistChannelWorkspace(channel.id, targetRoot);
  }
  if (channel?.id && useStore.getState().currentChannel !== channel.id) return targetRoot;
  await activateWorkspaceDesk(targetRoot, {
    mountId: null,
  });
  return targetRoot;
}

export async function activateCurrentChannelWorkspace(): Promise<string | null> {
  const state = useStore.getState();
  const channelId = state.currentChannel;
  if (!channelId || state.channelIsDM) return null;
  const channel = state.channels.find((item: Channel) => item.id === channelId);
  if (channel?.isDM) return null;
  const displayName = state.channelInfoName || channel?.name || channelId;
  const workspaceRoot = state.channelWorkspaceById?.[channelId]?.workspaceRoot || channel?.workspaceRoot;
  return activateChannelWorkspace(
    { id: channelId, name: displayName, workspaceRoot },
    displayName,
  );
}

function applyChannelMembers(channelId: string, members: string[]): void {
  const state = useStore.getState();
  const t = typeof window !== 'undefined' && window.t ? window.t : ((key: string) => key);
  const displayMembers = [state.userName || 'user', ...members];
  useStore.setState({
    channelMembers: state.currentChannel === channelId ? members : state.channelMembers,
    channelHeaderMembersText: state.currentChannel === channelId
      ? `${displayMembers.length} ${t('channel.membersCount')}`
      : state.channelHeaderMembersText,
    channels: state.channels.map((channel: Channel) =>
      channel.id === channelId ? { ...channel, members } : channel,
    ),
  });
}

export async function loadConversationAgentPhoneToolMode(conversationId: string): Promise<void> {
  await loadConversationAgentPhoneSettings(conversationId);
}

export async function loadConversationAgentPhoneSettings(conversationId: string): Promise<void> {
  const s = useStore.getState();
  if (!conversationId || !hasServerConnection(s)) return;
  try {
    const res = await hanaFetch(conversationPhoneSettingsUrl(conversationId));
    if (!res.ok) {
      applyAgentPhoneSettings({
        mode: 'read_only',
        replyMinChars: null,
        replyMaxChars: null,
        proactiveEnabled: true,
        reminderIntervalMinutes: 31,
        guardLimit: 36,
        modelOverrideEnabled: false,
        modelOverrideModel: null,
      });
      return;
    }
    const data = await res.json();
    applyAgentPhoneSettings(normalizeAgentPhoneSettings(data));
  } catch (err) {
    console.error('[channels] load phone settings failed:', err);
    applyAgentPhoneSettings({
      mode: 'read_only',
      replyMinChars: null,
      replyMaxChars: null,
      proactiveEnabled: true,
      reminderIntervalMinutes: 31,
      guardLimit: 36,
      modelOverrideEnabled: false,
      modelOverrideModel: null,
    });
  }
}

export async function setConversationAgentPhoneToolMode(mode: AgentPhoneToolMode): Promise<void> {
  await saveConversationAgentPhoneSettings({ mode });
}

export async function saveConversationAgentPhoneSettings(patch: Partial<AgentPhoneSettings>): Promise<void> {
  const s = useStore.getState();
  const conversationId = s.currentChannel;
  if (!conversationId || !hasServerConnection(s)) return;
  const res = await hanaFetch(conversationPhoneSettingsUrl(conversationId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode: patch.mode !== undefined ? normalizeAgentPhoneToolMode(patch.mode) : s.channelAgentPhoneToolMode,
      replyMinChars: patch.replyMinChars !== undefined ? patch.replyMinChars : s.channelAgentReplyMinChars,
      replyMaxChars: patch.replyMaxChars !== undefined ? patch.replyMaxChars : s.channelAgentReplyMaxChars,
      proactiveEnabled: patch.proactiveEnabled !== undefined ? patch.proactiveEnabled : s.channelAgentProactiveEnabled,
      reminderIntervalMinutes: patch.reminderIntervalMinutes !== undefined ? patch.reminderIntervalMinutes : s.channelAgentReminderIntervalMinutes,
      guardLimit: patch.guardLimit !== undefined ? patch.guardLimit : s.channelAgentGuardLimit,
      modelOverrideEnabled: patch.modelOverrideEnabled !== undefined ? patch.modelOverrideEnabled : s.channelAgentModelOverrideEnabled,
      modelOverrideModel: patch.modelOverrideModel !== undefined ? patch.modelOverrideModel : s.channelAgentModelOverrideModel,
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  applyAgentPhoneSettings(normalizeAgentPhoneSettings(data));
}

// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲
// 鎵撳紑棰戦亾
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲

export async function openChannel(channelId: string, isDM?: boolean): Promise<void> {
  const s = useStore.getState();
  const ch = s.channels.find((c: Channel) => c.id === channelId);
  const isThisDM = isDM ?? ch?.isDM ?? false;
  const t = window.t;
  const cachedMessages = s.channelMessageCache[channelId] || [];

  // 绔嬪埢鍒囨崲 + 娓呯┖鏃ф暟鎹紝闃叉娈嬬暀涓婁竴涓閬撶殑鍐呭
  // DM 鏃朵粠 channel 鍒楄〃鎻愬彇 peerId锛屽嵆浣?API 澶辫触涔熻兘鏄剧ず agent 淇℃伅
  const peerId = isThisDM ? (ch?.peerId || channelId.replace('dm:', '')) : '';
  const peerName = isThisDM ? (ch?.name || peerId) : '';
  const dmOwnerId = isThisDM ? ch?.dmOwnerId : undefined;
  useStore.setState({
    currentChannel: channelId,
    channelMessages: cachedMessages,
    channelMembers: isThisDM ? [peerId] : [],
    channelHeaderName: isThisDM ? peerName : '',
    channelHeaderMembersText: '',
    channelIsDM: isThisDM,
    channelInfoName: isThisDM ? peerName : '',
  });

  try {
    if (isThisDM) {
      const ownerQuery = dmOwnerId ? `?agentId=${encodeURIComponent(dmOwnerId)}` : '';
      const res = await hanaFetch(`/api/dm/${encodeURIComponent(peerId)}${ownerQuery}`);
      if (res.ok) {
        const data = await res.json();
        const responseOwnerId = data.ownerAgentId || dmOwnerId;
        const messages = data.messages || [];
        const fresh = useStore.getState();
        useStore.setState({
          channelMessages: messages,
          channelMessageCache: {
            ...fresh.channelMessageCache,
            [channelId]: messages,
          },
          channelMessageCacheDirty: {
            ...fresh.channelMessageCacheDirty,
            [channelId]: false,
          },
          channelHeaderName: data.peerName || peerName,
          channelInfoName: data.peerName || peerName,
          channels: responseOwnerId
            ? fresh.channels.map((channel: Channel) =>
              channel.id === channelId ? { ...channel, dmOwnerId: responseOwnerId } : channel)
            : fresh.channels,
        });
      }
      // 404 = 娌℃湁鍘嗗彶锛屽熀鏈俊鎭凡鍦ㄤ笂鏂硅缃紝涓嶉渶瑕侀澶栧鐞?
    } else {
      const res = await hanaFetch(`/api/channels/${encodeURIComponent(channelId)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const displayName = data.name || channelId;
      const members = data.members || [];
      const displayMembers = [useStore.getState().userName || 'user', ...members];
      const messages = data.messages || [];
      const fresh = useStore.getState();
      const workspaceRoot = data.workspaceRoot || ch?.workspaceRoot || null;
      useStore.setState({
        channelMessages: messages,
        channelMessageCache: {
          ...fresh.channelMessageCache,
          [channelId]: messages,
        },
        channelMessageCacheDirty: {
          ...fresh.channelMessageCacheDirty,
          [channelId]: false,
        },
        channelMembers: members,
        channelHeaderName: `# ${displayName}`,
        channelHeaderMembersText: `${displayMembers.length} ${t('channel.membersCount')}`,
        channelIsDM: false,
        channelInfoName: displayName,
        channels: fresh.channels.map((channel: Channel) =>
          channel.id === channelId
            ? { ...channel, name: displayName, members, workspaceRoot: workspaceRoot || channel.workspaceRoot || null }
            : channel,
        ),
      });
      await activateChannelWorkspace({ id: channelId, name: displayName, workspaceRoot }, displayName);

      // Mark as read
      const msgs = messages;
      const lastMsg = msgs[msgs.length - 1];
      if (lastMsg) {
        hanaFetch(`/api/channels/${encodeURIComponent(channelId)}/read`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ timestamp: lastMsg.timestamp }),
        }).catch((err: unknown) => console.warn('[channel-actions] mark-as-read failed', err));

        // 閲嶆柊鍙?store 鏈€鏂扮姸鎬侊紝閬垮厤瑕嗙洊 await 鏈熼棿鐨勫苟鍙戞洿鏂?
        const fresh = useStore.getState();
        const freshCh = fresh.channels.find((c: Channel) => c.id === channelId);
        if (freshCh) {
          const newTotal = Math.max(0, fresh.channelTotalUnread - (freshCh.newMessageCount || 0));
          const updatedChannels = fresh.channels.map((c: Channel) =>
            c.id === channelId ? { ...c, newMessageCount: 0 } : c,
          );
          useStore.setState({ channelTotalUnread: newTotal, channels: updatedChannels });
        }
      }
    }
    loadConversationAgentActivities(channelId).catch((err: unknown) =>
      console.warn('[channel-actions] load agent activities failed', err));
    loadConversationAgentPhoneToolMode(channelId).catch((err: unknown) =>
      console.warn('[channel-actions] load phone tool mode failed', err));
  } catch (err) {
    console.error('[channels] open failed:', err);
  }
}

function sameChannelMessage(a: ChannelMessage, b: ChannelMessage): boolean {
  return a.sender === b.sender && a.timestamp === b.timestamp && a.body === b.body;
}

function sortChannelsByRecent(channels: Channel[]): Channel[] {
  return [...channels].sort((a, b) =>
    (b.lastTimestamp || '').localeCompare(a.lastTimestamp || ''),
  );
}

function sameCachedMessage(a: ChannelMessage, b: ChannelMessage): boolean {
  return sameChannelMessage(a, b);
}

export function markChannelMessagesDirty(channelId: string): void {
  if (!channelId) return;
  const state = useStore.getState();
  useStore.setState({
    channelMessageCacheDirty: {
      ...state.channelMessageCacheDirty,
      [channelId]: true,
    },
  });
}

export async function hydrateCurrentChannelIfNeeded(): Promise<void> {
  const state = useStore.getState();
  const channelId = state.currentChannel;
  if (!channelId) return;

  const cached = state.channelMessageCache[channelId];
  const dirty = state.channelMessageCacheDirty[channelId] === true;
  const channel = state.channels.find((item: Channel) => item.id === channelId);
  if (cached) {
    useStore.setState({ channelMessages: cached });
  }
  if (!cached || dirty) {
    await openChannel(channelId, channel?.isDM);
    return;
  }
  if (!channel?.isDM) await activateCurrentChannelWorkspace();
}

// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲
// 澧為噺杩藉姞棰戦亾娑堟伅
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲

export function appendChannelMessage(
  channelId: string,
  message: ChannelMessage,
  options: { markRead?: boolean; countUnread?: boolean } = { markRead: true },
): void {
  if (
    !channelId
    || typeof message?.sender !== 'string'
    || typeof message.timestamp !== 'string'
    || typeof message.body !== 'string'
  ) return;

  const state = useStore.getState();
  const isCurrentChannel = state.currentChannel === channelId;
  const cachedMessages = state.channelMessageCache[channelId];
  const baseMessages = cachedMessages || (isCurrentChannel ? state.channelMessages : []);
  const alreadyInCache = baseMessages.some((m: ChannelMessage) => sameCachedMessage(m, message));
  const nextMessages = alreadyInCache ? baseMessages : [...baseMessages, message];
  const shouldMarkRead = isCurrentChannel && options.markRead === true;
  const shouldCountUnread = !shouldMarkRead && options.countUnread !== false;
  const nextCacheDirty = state.channelMessageCacheDirty[channelId] === true
    || (!cachedMessages && !isCurrentChannel);

  let unreadDelta = 0;
  let readDelta = 0;
  const updatedChannels = state.channels.map((channel: Channel) => {
    if (channel.id !== channelId) return channel;

    const isDuplicatePreview =
      channel.lastSender === message.sender
      && channel.lastTimestamp === message.timestamp
      && channel.lastMessage === message.body.slice(0, 60);

    const previousUnread = channel.newMessageCount || 0;
    const nextUnread = shouldMarkRead ? 0 : previousUnread + (
      shouldCountUnread && !isDuplicatePreview ? 1 : 0
    );

    if (shouldMarkRead) {
      readDelta = previousUnread;
    } else {
      unreadDelta += nextUnread - previousUnread;
    }

    return {
      ...channel,
      lastMessage: message.body.slice(0, 60),
      lastSender: message.sender,
      lastTimestamp: message.timestamp,
      messageCount: (channel.messageCount || 0) + (isDuplicatePreview ? 0 : 1),
      newMessageCount: nextUnread,
    };
  });

  const patch: Partial<ReturnType<typeof useStore.getState>> = {
    channels: sortChannelsByRecent(updatedChannels),
    channelMessageCache: {
      ...state.channelMessageCache,
      [channelId]: nextMessages,
    },
    channelMessageCacheDirty: {
      ...state.channelMessageCacheDirty,
      [channelId]: nextCacheDirty,
    },
    channelTotalUnread: Math.max(0, state.channelTotalUnread + unreadDelta - readDelta),
  };

  if (isCurrentChannel) {
    patch.channelMessages = nextMessages;
  }

  useStore.setState(patch);

  if (shouldMarkRead) {
    Promise.resolve(hanaFetch(`/api/channels/${encodeURIComponent(channelId)}/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timestamp: message.timestamp }),
    })).catch((err: unknown) => console.warn('[channel-actions] mark-as-read failed', err));
  }
}

// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲
// 鍙戦€佹秷鎭?
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲

export async function sendChannelMessage(text: string): Promise<void> {
  const s = useStore.getState();
  const channelId = s.currentChannel;
  const body = text.trim();
  if (!body || !channelId) return;
  const sender = s.userName || 'user';

  try {
    if (!s.channelIsDM) {
      await activateCurrentChannelWorkspace();
    }
    const res = await hanaFetch(`/api/channels/${encodeURIComponent(channelId)}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: text }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.ok && data.timestamp) {
      appendChannelMessage(channelId, {
        sender,
        timestamp: data.timestamp,
        body: text,
      }, { markRead: true, countUnread: false });
    }
  } catch (err) {
    console.error('[channels] send failed:', err);
  }
}

// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲
// 鍒犻櫎棰戦亾
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲

export async function deleteChannel(channelId: string): Promise<void> {
  const s = useStore.getState();
  try {
    const res = await hanaFetch(`/api/channels/${encodeURIComponent(channelId)}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.ok) {
      if (s.currentChannel === channelId) {
        useStore.setState({
          currentChannel: null,
          channelMessages: [],
          channelHeaderName: '',
          channelHeaderMembersText: '',
          channelIsDM: false,
        });
      }
      // Reload channels
      await loadChannels();
    } else {
      console.error('[channels] delete failed:', data.error);
    }
  } catch (err) {
    console.error('[channels] delete failed:', err);
  }
}

// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲
// 棰戦亾鎴愬憳绠＄悊
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲

export async function addChannelMember(channelId: string, memberId: string): Promise<void> {
  const res = await hanaFetch(`/api/channels/${encodeURIComponent(channelId)}/members`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ memberId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  applyChannelMembers(channelId, data.members || []);
}

export async function removeChannelMember(channelId: string, memberId: string): Promise<void> {
  const res = await hanaFetch(`/api/channels/${encodeURIComponent(channelId)}/members/${encodeURIComponent(memberId)}`, {
    method: 'DELETE',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  applyChannelMembers(channelId, data.members || []);
}

// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲
// 鍒囨崲棰戦亾鍔熻兘寮€鍏?
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲

export async function toggleChannelsEnabled(): Promise<boolean | undefined> {
  const s = useStore.getState();
  if (s.channelsEnabled === undefined) return undefined;
  const previousEnabled = s.channelsEnabled;
  const newEnabled = !s.channelsEnabled;

  try {
    const res = await hanaFetch('/api/channels/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: newEnabled }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json().catch(() => ({}));
    const enabled = typeof data.enabled === 'boolean' ? data.enabled : newEnabled;
    useStore.setState({ channelsEnabled: enabled });

    if (enabled) {
      await loadChannels();
    } else {
      useStore.setState({
        channels: [],
        currentChannel: null,
        channelMessages: [],
        channelMessageCache: {},
        channelMessageCacheDirty: {},
        channelMembers: [],
        channelTotalUnread: 0,
        channelHeaderName: '',
        channelHeaderMembersText: '',
        channelInfoName: '',
        channelIsDM: false,
      });
    }

    return enabled;
  } catch (err) {
    console.error('[channels] toggle backend failed:', err);
    useStore.setState({ channelsEnabled: previousEnabled });
    return previousEnabled;
  }
}

// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲
// 鍒涘缓棰戦亾
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲

export async function createChannel(name: string, members: string[], intro?: string, workspaceRoot?: string): Promise<string | null> {
  try {
    const res = await hanaFetch('/api/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        members,
        intro: intro || undefined,
        workspaceRoot: workspaceRoot?.trim() || undefined,
      }),
      throwOnHttpError: false,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    if (data.error) throw new Error(data.error);

    await loadChannels();
    if (data.id) {
      await openChannel(data.id);
    }
    return data.id || null;
  } catch (err: any) {
    console.error('[channels] create failed:', err);
    throw err;
  }
}
