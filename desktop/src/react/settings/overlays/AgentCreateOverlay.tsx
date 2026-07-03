import { useState, useEffect, useRef, useCallback } from 'react';
import { useSettingsStore } from '../store';
import { hanaFetch } from '../api';
import { t } from '../helpers';
import { switchToAgent } from '../actions';
import { Overlay } from '../../ui';
import styles from '../Settings.module.css';
import { OPENZETCX_DEFAULT_ROLE_PRESETS } from '../../../../../shared/openzetcx-role-presets.ts';

const OPENZETCX_YUAN = 'openZetcX';

const ROLE_PRESETS = OPENZETCX_DEFAULT_ROLE_PRESETS.map((preset) => ({
  id: preset.id,
  name: preset.name,
  desc: preset.shortDescription,
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

  const types = t('yuan.types') || {};
  const companyYuanMeta = (types as Record<string, { label?: string }>).openZetcX || {};

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
              onClick={() => {
                setRolePreset(preset.id);
                if (!name.trim()) setName(preset.name);
              }}
            >
              <span>{preset.name}</span>
              <small>{preset.desc}</small>
            </button>
          ))}
        </div>
      </div>
      <div className={styles['settings-form-field']}>
        <div className="yuan-selector">
          <div className="yuan-chips">
            <button className="yuan-chip selected" type="button" disabled={creating}>
              <img className="yuan-chip-avatar" src="assets/openZetcX.png" draggable={false} />
              <div className="yuan-chip-info">
                <span className="yuan-chip-name">openZetc</span>
                <span className="yuan-chip-desc">{companyYuanMeta.label || '基于 openZetcX 的统一人格'}</span>
              </div>
            </button>
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
