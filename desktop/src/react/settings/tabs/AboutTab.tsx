import React, { useCallback, useEffect, useState } from 'react';
import { useSettingsStore } from '../store';
import { autoSaveConfig, t } from '../helpers';
import { Toggle } from '../widgets/Toggle';
import { loadSettingsConfig } from '../actions';
import { SettingsSection } from '../components/SettingsSection';
import { SettingsRow } from '../components/SettingsRow';
import { AutoUpdateStatus } from '../../components/AutoUpdateStatus';
import { useAutoUpdateState } from '../../hooks/use-auto-update-state';
import type { AutoLaunchStatus } from '../../types';
import appIconUrl from '../../../icon.png';
import styles from '../Settings.module.css';

const hana = window.hana;
const DISPLAY_VERSION = '0.1.0';

export function AboutTab() {
  const settingsConfig = useSettingsStore(s => s.settingsConfig);
  const [version, setVersion] = useState('');
  const [autoLaunch, setAutoLaunch] = useState<AutoLaunchStatus | null>(null);
  const [autoLaunchSaving, setAutoLaunchSaving] = useState(false);
  const autoUpdate = useAutoUpdateState();
  const isBeta = settingsConfig?.update_channel === 'beta';
  // 默认 true：老用户（preferences 里没写这个字段）保持原有"自动检查"行为
  const autoCheck = settingsConfig?.auto_check_updates !== false;

  useEffect(() => {
    hana?.getAppVersion?.().then((v: string) => setVersion(v || ''));
  }, [hana]);

  useEffect(() => {
    let alive = true;
    hana?.getAutoLaunchStatus?.()
      .then((status) => {
        if (alive && status) setAutoLaunch(status);
      })
      .catch(() => {
        if (alive) setAutoLaunch(null);
      });
    return () => {
      alive = false;
    };
  }, [hana]);

  const handleCheck = useCallback(() => {
    hana?.autoUpdateCheck?.();
  }, []);

  const handleInstall = useCallback(async () => {
    await hana?.autoUpdateInstall?.();
  }, []);

  const handleBetaToggle = useCallback(async (on: boolean) => {
    const channel = on ? 'beta' : 'stable';
    hana?.autoUpdateSetChannel?.(channel);
    await autoSaveConfig({ update_channel: channel }, { silent: true });
    await loadSettingsConfig();
    hana?.autoUpdateCheck?.();
  }, []);

  const handleAutoCheckToggle = useCallback(async (on: boolean) => {
    await autoSaveConfig({ auto_check_updates: on }, { silent: true });
    await loadSettingsConfig();
  }, []);

  const handleAutoLaunchToggle = useCallback(async (on: boolean) => {
    if (!hana?.setAutoLaunchEnabled) return;
    const previous = autoLaunch;
    setAutoLaunchSaving(true);
    try {
      const next = await hana.setAutoLaunchEnabled(on);
      setAutoLaunch(next || previous);
    } catch {
      setAutoLaunch(previous);
    } finally {
      setAutoLaunchSaving(false);
    }
  }, [autoLaunch, hana]);

  return (
    <div className={`${styles['settings-tab-content']} ${styles['active']}`} data-tab="about">
      {/* Hero：保留原 about-hero 独立视觉组件（icon + name + tagline + version + update + check 按钮） */}
      <div className={styles['about-hero']}>
        <img className={styles['about-icon']} src={appIconUrl} alt="openZetcX" />
        <div className={styles['about-name']}>openZetcX</div>
        <div className={styles['about-tagline']}>{t('settings.about.tagline')}</div>
        <div className={styles['about-version']}>v{version || DISPLAY_VERSION}</div>
        <AutoUpdateStatus
          state={autoUpdate}
          agentName={settingsConfig?.agent?.name || 'openZetcX'}
          onInstall={handleInstall}
        />
        {(!autoUpdate || autoUpdate.status === 'idle' || autoUpdate.status === 'latest' || autoUpdate.status === 'error') && (
          <button className={styles['about-check-update-btn']} onClick={handleCheck}>
            {t('settings.about.updateCheckBtn')}
          </button>
        )}
      </div>

      {/* Info：license / copyright / update toggles */}
      <SettingsSection>
        <SettingsRow
          label={t('settings.about.license')}
          control={<span>Apache License 2.0</span>}
        />
        <SettingsRow
          label={t('settings.about.copyright')}
          control={<span>浙江省环境科技有限公司 © 2026</span>}
        />
        {autoLaunch?.supported && (
          <SettingsRow
            label={t('settings.about.launchAtLogin')}
            control={
              <Toggle
                on={autoLaunch.openAtLogin}
                onChange={handleAutoLaunchToggle}
                label={t('settings.about.launchAtLogin')}
                disabled={autoLaunchSaving}
              />
            }
          />
        )}
        <SettingsRow
          label={t('settings.about.autoCheckUpdates')}
          control={<Toggle on={autoCheck} onChange={handleAutoCheckToggle} />}
        />
        <SettingsRow
          label={t('settings.about.betaUpdates')}
          control={<Toggle on={isBeta} onChange={handleBetaToggle} />}
        />
      </SettingsSection>

    </div>
  );
}
