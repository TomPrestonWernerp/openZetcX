import { memo, useState } from 'react';
import { hanaFetch } from '../../hooks/use-hana-fetch';
import type { ContentBlock } from '../../stores/chat-types';
import styles from './KnowledgeSourcesBlock.module.css';
import chatStyles from './Chat.module.css';

type KnowledgeSources = Extract<ContentBlock, { type: 'knowledge_sources' }>;
type KnowledgeSource = KnowledgeSources['sources'][number];

type OriginalWindow = {
  content: string;
  start_line?: number;
  end_line?: number;
  total_lines?: number;
};

function locationLabel(source: KnowledgeSource): string {
  const parts: string[] = [];
  if (source.page !== undefined) parts.push(`第 ${source.page} 页`);
  if (source.startLine !== undefined && source.endLine !== undefined) {
    parts.push(`第 ${source.startLine}-${source.endLine} 行`);
  } else if (source.matchedLines?.length) {
    parts.push(`第 ${source.matchedLines.join('、')} 行`);
  } else if (source.chunkIndex !== undefined) {
    parts.push(`分块 ${source.chunkIndex}`);
  }
  return parts.join(' · ');
}

function scoreLabel(score: number | undefined): string | null {
  if (score === undefined || !Number.isFinite(score)) return null;
  const normalized = score >= 0 && score <= 1 ? `${Math.round(score * 100)}%` : score.toFixed(3);
  return `相关度 ${normalized}`;
}

function displayCitationId(citationId: string): string {
  return citationId.replace(/^YUXI-/i, 'KB-');
}

export const KnowledgeSourcesBlock = memo(function KnowledgeSourcesBlock({ block }: { block: KnowledgeSources }) {
  const [expanded, setExpanded] = useState(false);
  const [windows, setWindows] = useState<Record<string, OriginalWindow>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [openIds, setOpenIds] = useState<Set<string>>(
    () => new Set(),
  );

  async function loadOriginal(source: KnowledgeSource) {
    if (windows[source.citationId] || loadingId === source.citationId) return;
    setLoadingId(source.citationId);
    setErrors(current => ({ ...current, [source.citationId]: '' }));
    try {
      const offset = Math.max(0, (source.startLine || 1) - 11);
      const sourceWindow = source.startLine !== undefined && source.endLine !== undefined
        ? source.endLine - source.startLine + 21
        : 120;
      const query = new URLSearchParams({
        offset: String(offset),
        windowSize: String(Math.min(Math.max(sourceWindow, 40), 240)),
      });
      const response = await hanaFetch(
        `/api/yuxi/knowledge-bases/${encodeURIComponent(source.kbId)}/files/${encodeURIComponent(source.fileId)}/content?${query}`,
        { timeout: 15_000, throwOnHttpError: false },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || '原文读取失败');
      setWindows(current => ({ ...current, [source.citationId]: payload }));
    } catch (error) {
      setErrors(current => ({
        ...current,
        [source.citationId]: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      setLoadingId(current => current === source.citationId ? null : current);
    }
  }

  if (!block.sources.length) return null;

  return (
    <section className={`${chatStyles.thinkingBlock} ${styles.root}`} aria-label="知识库引用">
      <button type="button" className={`${chatStyles.thinkingBlockSummary} ${styles.header}`}
        aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
        <span aria-hidden="true" className={`${chatStyles.thinkingBlockArrow}${expanded ? ` ${chatStyles.thinkingBlockArrowOpen}` : ''}`}>›</span>
        <span>知识库引用</span>
        <span className={styles.count}>（{block.sources.length}）</span>
      </button>
      {expanded && <div className={styles.sources}>
        {block.sources.map((source) => {
          const location = locationLabel(source);
          const score = scoreLabel(source.score);
          const original = windows[source.citationId];
          const error = errors[source.citationId];
          return (
            <details
              className={styles.source}
              key={source.citationId}
              open={openIds.has(source.citationId)}
              onToggle={(event) => {
                const isOpen = event.currentTarget.open;
                setOpenIds(current => {
                  const next = new Set(current);
                  if (isOpen) next.add(source.citationId);
                  else next.delete(source.citationId);
                  return next;
                });
              }}
            >
              <summary>
                <span className={styles.citation}>[{displayCitationId(source.citationId)}]</span>
                <span className={styles.fileName}>{source.fileName}</span>
                {location ? <span className={styles.location}>{location}</span> : null}
              </summary>
              {openIds.has(source.citationId) && <div className={styles.body}>
                <div className={styles.meta}>
                  <span>{source.kbName}</span>
                  {score ? <span>{score}</span> : null}
                </div>
                <blockquote className={styles.evidence}>{source.evidence}</blockquote>
                <button
                  type="button"
                  className={styles.openButton}
                  disabled={loadingId === source.citationId}
                  onClick={() => void loadOriginal(source)}
                >
                  {loadingId === source.citationId
                    ? '正在读取原文…'
                    : (original ? '已核对原文' : '展开原文')}
                </button>
                {error ? <p className={styles.error}>{error}</p> : null}
                {original ? (
                  <div className={styles.original}>
                    <div className={styles.originalHeader}>
                      原文第 {original.start_line || 0}-{original.end_line || 0} 行
                      {original.total_lines ? ` / 共 ${original.total_lines} 行` : ''}
                    </div>
                    <pre>{original.content}</pre>
                  </div>
                ) : null}
              </div>}
            </details>
          );
        })}
      </div>}
    </section>
  );
});
