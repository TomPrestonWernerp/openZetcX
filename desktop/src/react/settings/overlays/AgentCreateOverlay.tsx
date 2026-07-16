import { useState, useEffect, useRef, useCallback } from 'react';
import { useSettingsStore } from '../store';
import { hanaFetch } from '../api';
import { t } from '../helpers';
import { switchToAgent } from '../actions';
import { Overlay } from '../../ui';
import styles from '../Settings.module.css';
import { OPENZETCX_DEFAULT_ROLE_PRESETS } from '../../../../../shared/openzetcx-role-presets.ts';
import analystAvatar from '../../assets/role-avatars/analyst.png';
import coordinatorAvatar from '../../assets/role-avatars/coordinator.png';
import developerAvatar from '../../assets/role-avatars/developer.png';
import documentSpecialistAvatar from '../../assets/role-avatars/document_specialist.png';
import generalAvatar from '../../assets/role-avatars/general.png';
import operationsAvatar from '../../assets/role-avatars/operations.png';
import projectManagerAvatar from '../../assets/role-avatars/project_manager.png';
import researcherAvatar from '../../assets/role-avatars/researcher.png';
import reviewerAvatar from '../../assets/role-avatars/reviewer.png';
import writerAvatar from '../../assets/role-avatars/writer.png';

const OPENZETCX_YUAN = 'openZetcX';
const OPENZETCX_AVATAR = 'assets/openZetcX.png';
const ROLE_AVATARS: Record<string, string> = {
  general: generalAvatar,
  developer: developerAvatar,
  project_manager: projectManagerAvatar,
  analyst: analystAvatar,
  researcher: researcherAvatar,
  writer: writerAvatar,
  reviewer: reviewerAvatar,
  document_specialist: documentSpecialistAvatar,
  operations: operationsAvatar,
  coordinator: coordinatorAvatar,
};

const ROLE_PRESETS = OPENZETCX_DEFAULT_ROLE_PRESETS.map((preset) => ({
  id: preset.id,
  name: preset.name,
  desc: preset.shortDescription,
  avatar: ROLE_AVATARS[preset.id],
}));

export function AgentCreateOverlay() {
  const showToast = useSettingsStore(s => s.showToast);
  const [visible, setVisible] = useState(false);
  const [name, setName] = useState('');
  const [rolePreset, setRolePreset] = useState('general');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = () => {
      setName('');
      setRolePreset('general');
      setError('');
      setVisible(true);
      requestAnimationFrame(() => inputRef.current?.focus());
    };
    window.addEventListener('hana-show-agent-create', handler);
    return () => window.removeEventListener('hana-show-agent-create', handler);
  }, []);

  const close = useCallback(() => {
    setVisible(false);
    setError('');
  }, []);

  const selectedPreset = ROLE_PRESETS.find((preset) => preset.id === rolePreset) || ROLE_PRESETS[0];

  const selectRolePreset = (preset: (typeof ROLE_PRESETS)[number]) => {
    const previousPresetName = selectedPreset.name;
    setRolePreset(preset.id);
    setName((current) => {
      const normalized = current.trim();
      return !normalized || normalized === previousPresetName ? preset.name : current;
    });
    setError('');
  };

  const create = async () => {
    if (creating) return;
    const trimmed = name.trim();
    if (!trimmed) {
      const message = t('settings.agent.nameRequired');
      setError(message);
      showToast(message, 'error');
      return;
    }

    setCreating(true);
    setError('');
    try {
      const res = await hanaFetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmed,
          yuan: OPENZETCX_YUAN,
          rolePreset,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      await switchToAgent(data.id);
      close();
      showToast(t('settings.agent.created', { name: data.name }), 'success');
    } catch (err: any) {
      const message = t('settings.agent.createFailed') + ': ' + err.message;
      setError(message);
      showToast(message, 'error');
    } finally {
      setCreating(false);
    }
  };

  return (
    <Overlay
      open={visible}
      onClose={close}
      backdrop="blur"
      closeOnBackdrop={!creating}
      closeOnEsc={!creating}
      zIndex={110}
      className={styles['agent-create-card']}
      disableContainerAnimation
    >
      <h3 className={styles['agent-create-title']}>{t('settings.agent.createTitle')}</h3>
      <div className={styles['settings-form-field']}>
        <input
          ref={inputRef}
          className={styles['settings-input']}
          type="text"
          placeholder={t('settings.agent.namePlaceholder')}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError('');
          }}
          disabled={creating}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); create(); }
            if (e.key === 'Escape' && !creating) close();
          }}
        />
      </div>
      {error && <div className={styles['settings-inline-error']} role="alert">{error}</div>}
      <div className={styles['settings-form-field']}>
        <div className={styles['agent-create-role-grid']} aria-label="role preset">
          {ROLE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`${styles['agent-create-role-card']} ${rolePreset === preset.id ? styles['agent-create-role-card-selected'] : ''}`}
              disabled={creating}
              aria-pressed={rolePreset === preset.id}
              aria-label={`${preset.name}：${preset.desc}`}
              onClick={() => selectRolePreset(preset)}
            >
              <span className={styles['agent-create-role-avatar']}>
                <img
                  src={preset.avatar}
                  alt=""
                  draggable={false}
                />
              </span>
              <span className={styles['agent-create-role-copy']}>
                <strong>{preset.name}</strong>
                <small>{preset.desc}</small>
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className={styles['settings-form-field']}>
        <div className={styles['agent-create-role-preview']} aria-live="polite">
          <span className={styles['agent-create-role-avatar']}>
            <img
              src={OPENZETCX_AVATAR}
              alt=""
              draggable={false}
            />
          </span>
          <div>
            <strong>openZetc</strong>
            <span>均衡的助手</span>
          </div>
        </div>
      </div>
      <div className={styles['agent-create-actions']}>
        <button className={styles['agent-create-cancel']} onClick={close} disabled={creating}>{t('settings.agent.cancel')}</button>
        <button className={styles['agent-create-confirm']} onClick={create} disabled={creating}>
          {creating ? t('settings.agent.creating') : t('settings.agent.confirm')}
        </button>
      </div>
    </Overlay>
  );
}
