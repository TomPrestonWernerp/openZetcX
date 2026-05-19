import React from 'react';
import { t } from '../../helpers';

export type YuanMeta = { label?: string; avatar?: string };
export type YuanEntry = [string, YuanMeta];

const YUAN_DISPLAY_NAMES: Record<string, string> = {
  butter: '小省',
  openZetcX: '环环',
  ming: '小科',
  kong: 'openZetcX',
};

const YUAN_ORDER = ['butter', 'openZetcX', 'ming', 'kong'];

export function getYuanDisplayName(key: string): string {
  return YUAN_DISPLAY_NAMES[key] || key;
}

export function getOrderedYuanEntries(types: Record<string, YuanMeta>): YuanEntry[] {
  const entries = Object.entries(types) as YuanEntry[];
  return entries.sort(([a], [b]) => {
    const ai = YUAN_ORDER.indexOf(a);
    const bi = YUAN_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

export function YuanSelector({ currentYuan, onChange }: { currentYuan: string; onChange: (key: string) => void }) {
  const types = (t('yuan.types') || {}) as Record<string, YuanMeta>;
  const entries = getOrderedYuanEntries(types);

  return (
    <div className="yuan-selector">
      <div className="yuan-chips">
        {entries.map(([key, meta]) => (
          <button
            key={key}
            className={`yuan-chip${key === currentYuan ? ' selected' : ''}`}
            type="button"
            onClick={() => { if (key !== currentYuan) onChange(key); }}
          >
            <img
              className="yuan-chip-avatar"
              src={`assets/${meta.avatar || 'openZetcX.png'}`}
              draggable={false}
            />
            <div className="yuan-chip-info">
              <span className="yuan-chip-name">{getYuanDisplayName(key)}</span>
              <span className="yuan-chip-desc">{meta.label || ''}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
