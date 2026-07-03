/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { YuanSelector } from '../YuanSelector';

vi.mock('../../../helpers', () => ({
  t: (key: string) => {
    if (key === 'yuan.types') {
      return {
        openZetcX: { label: 'Balanced assistant', avatar: 'openZetcX.png' },
      };
    }
    return key;
  },
}));

afterEach(() => {
  cleanup();
});

describe('YuanSelector', () => {
  it('only renders the company openZetc option', () => {
    render(<YuanSelector currentYuan="openZetcX" onChange={vi.fn()} />);

    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByText('openZetc')).toBeTruthy();
    expect(screen.getByText('Balanced assistant')).toBeTruthy();
    expect(screen.getByRole('img').getAttribute('src')).toBe('assets/openZetcX.png');
  });
});
