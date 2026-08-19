import React, { useEffect, useState, useCallback } from 'react';
import { useSettingsStore } from '../store';
import { autoSaveConfig, t } from '../helpers';
import { Toggle } from '../widgets/Toggle';
import { loadSettingsConfig } from '../actions';
import { readConfigBoolean } from '../resource-state';
import { SettingsSection } from '../components/SettingsSection';
import { SettingsRow } from '../components/SettingsRow';
import { AutoUpdateStatus } from '../../components/AutoUpdateStatus';
import { useAutoUpdateState } from '../../hooks/use-auto-update-state';
import appIconUrl from '../../../icon.png';
import styles from '../Settings.module.css';

export function AboutTab() {
  const hana = window.hana;
  const settingsConfig = useSettingsStore(s => s.settingsConfig);
  const [version, setVersion] = useState('');
  const autoUpdate = useAutoUpdateState();
  const isBeta = readConfigBoolean(settingsConfig, cfg => cfg.update_channel === 'beta', false);
  // 默认 true：老用户（preferences 里没写这个字段）保持原有"自动检查"行为
  const autoCheck = readConfigBoolean(settingsConfig, cfg => cfg.auto_check_updates, true);

  useEffect(() => {
    hana?.getAppVersion?.().then((v: string) => setVersion(v || ''));
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

  return (
    <div className={`${styles['settings-tab-content']} ${styles['active']}`} data-tab="about">
      {/* Hero：保留原 about-hero 独立视觉组件（icon + name + tagline + version + update + check 按钮） */}
      <div className={styles['about-hero']}>
        <img className={styles['about-icon']} src={appIconUrl} alt="openZetc" />
        <div className={styles['about-name']}>openZetc</div>
        <div className={styles['about-tagline']}>{t('settings.about.tagline')}</div>
        {version && <div className={styles['about-version']}>v{version}</div>}
        <AutoUpdateStatus
          state={autoUpdate}
          agentName={settingsConfig?.agent?.name || 'openZetc'}
          onInstall={handleInstall}
        />
        {(!autoUpdate || autoUpdate.status === 'idle' || autoUpdate.status === 'latest' || autoUpdate.status === 'error') && (
          <button className={styles['about-check-update-btn']} onClick={handleCheck}>
            {t('settings.about.updateCheckBtn')}
          </button>
        )}
      </div>

      {/* Info：copyright / update toggles */}
      <SettingsSection>
        <SettingsRow
          label={t('settings.about.copyright')}
          control={<span>浙江省环境科技股份有限公司 © 2026</span>}
        />
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
