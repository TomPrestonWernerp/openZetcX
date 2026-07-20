import { useState } from 'react';
import { useAutoUpdateState } from '../../hooks/use-auto-update-state';
import styles from './SidebarUpdateAction.module.css';

const tr = (key: string) => window.t?.(key) ?? key;

function DownloadIcon() {
  return (
    <svg
      className={styles.icon}
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}

export function SidebarUpdateAction() {
  const updateState = useAutoUpdateState();
  const [requesting, setRequesting] = useState(false);

  if (updateState?.status !== 'downloaded') return null;

  const installUpdate = async () => {
    if (requesting) return;
    setRequesting(true);
    try {
      await window.hana?.autoUpdateInstall?.();
    } finally {
      setRequesting(false);
    }
  };

  const title = tr('settings.about.updateInstall');
  return (
    <button
      type="button"
      className={styles.button}
      title={title}
      aria-label={title}
      aria-busy={requesting}
      disabled={requesting}
      onClick={() => void installUpdate()}
    >
      <DownloadIcon />
      <span className={styles.label}>{tr('settings.about.updateAction')}</span>
    </button>
  );
}
