// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeSourcesBlock } from '../../components/chat/KnowledgeSourcesBlock';

const hanaFetchMock = vi.fn();

vi.mock('../../hooks/use-hana-fetch', () => ({
  hanaFetch: (...args: unknown[]) => hanaFetchMock(...args),
}));

describe('KnowledgeSourcesBlock', () => {
  afterEach(() => {
    cleanup();
    hanaFetchMock.mockReset();
  });

  const block = {
    type: 'knowledge_sources' as const,
    provider: 'yuxi',
    sources: [{
      citationId: 'YUXI-abc123-1',
      kbId: 'kb-1',
      kbName: '公司制度库',
      fileId: 'file-1',
      fileName: '差旅管理办法.pdf',
      page: 4,
      startLine: 21,
      endLine: 23,
      score: 0.91,
      evidence: '差旅报销应在十五个工作日内提交。',
    }],
  };

  it('renders knowledge base, file, page, lines and evidence', () => {
    render(<KnowledgeSourcesBlock block={block} />);

    expect(screen.getByText('知识库引用')).toBeTruthy();
    expect(screen.getByText('[KB-abc123-1]')).toBeTruthy();
    expect(screen.getByText('差旅管理办法.pdf')).toBeTruthy();
    expect(screen.getByText('第 4 页 · 第 21-23 行')).toBeTruthy();
    expect(screen.getByText('公司制度库')).toBeTruthy();
    expect(screen.getByText('差旅报销应在十五个工作日内提交。')).toBeTruthy();
  });

  it('loads a verified parsed source window on demand', async () => {
    hanaFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        start_line: 11,
        end_line: 31,
        total_lines: 80,
        content: '    21\t差旅报销应在十五个工作日内提交。',
      }),
    });
    render(<KnowledgeSourcesBlock block={block} />);

    fireEvent.click(screen.getByRole('button', { name: '展开原文' }));

    await waitFor(() => {
      expect(screen.getByText(/原文第 11-31 行/)).toBeTruthy();
    });
    expect(hanaFetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/yuxi/knowledge-bases/kb-1/files/file-1/content?'),
      expect.objectContaining({ timeout: 15_000 }),
    );
  });
});
