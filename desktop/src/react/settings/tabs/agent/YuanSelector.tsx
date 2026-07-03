import React from 'react';
import { t } from '../../helpers';

const COMPANY_YUAN_KEY = 'openZetcX';
const COMPANY_YUAN_NAME = 'openZetc';
const COMPANY_YUAN_AVATAR = 'openZetcX.png';

export function YuanSelector({ currentYuan, onChange }: { currentYuan: string; onChange: (key: string) => void }) {
  const types = t('yuan.types') || {};
  const meta = (types as Record<string, { label?: string; avatar?: string }>)[COMPANY_YUAN_KEY] || {};
  const normalizedCurrent = String(currentYuan || '').toLowerCase();
  const selected = !currentYuan || currentYuan === COMPANY_YUAN_KEY || ['hanako', 'butter', 'ming', 'kong'].includes(normalizedCurrent);

  return (
    <div className="yuan-selector">
      <div className="yuan-chips">
        <button
          className={`yuan-chip${selected ? ' selected' : ''}`}
          type="button"
          onClick={() => { if (currentYuan !== COMPANY_YUAN_KEY) onChange(COMPANY_YUAN_KEY); }}
        >
          <img
            className="yuan-chip-avatar"
            src={`assets/${COMPANY_YUAN_AVATAR}`}
            draggable={false}
          />
          <div className="yuan-chip-info">
            <span className="yuan-chip-name">{COMPANY_YUAN_NAME}</span>
            <span className="yuan-chip-desc">{meta.label || ''}</span>
          </div>
        </button>
      </div>
    </div>
  );
}
