export const WORKSPACE_OUTPUT_ROOT_DIRNAME: string;

export function localeKey(locale?: unknown): string;
export function sanitizeWorkspaceOutputSegment(value?: unknown, fallback?: string): string;
export function resolveWorkspaceOutputRoot(cwd: string): string;
export function resolveWorkspaceOutputDir(cwd: string, kind: string, locale?: string): string;
export function workspaceOutputRelativePath(...segments: string[]): string;

export interface AgentWorkspaceOutputDirs {
  patrolDir: string;
  activityDir: string;
  agentSegment: string;
}

export interface AgentWorkspaceOutputRelativeDirs {
  patrolDir: string;
  activityDir: string;
  patrolLog: string;
  agentSegment: string;
}

export function resolveAgentWorkspaceOutputDirs(
  cwd: string,
  agentName?: string,
  locale?: string,
): AgentWorkspaceOutputDirs;

export function resolveAgentWorkspaceOutputRelativeDirs(
  agentName?: string,
  locale?: string,
): AgentWorkspaceOutputRelativeDirs;

declare const workspaceOutput: {
  WORKSPACE_OUTPUT_ROOT_DIRNAME: typeof WORKSPACE_OUTPUT_ROOT_DIRNAME;
  localeKey: typeof localeKey;
  sanitizeWorkspaceOutputSegment: typeof sanitizeWorkspaceOutputSegment;
  resolveWorkspaceOutputRoot: typeof resolveWorkspaceOutputRoot;
  resolveWorkspaceOutputDir: typeof resolveWorkspaceOutputDir;
  workspaceOutputRelativePath: typeof workspaceOutputRelativePath;
  resolveAgentWorkspaceOutputDirs: typeof resolveAgentWorkspaceOutputDirs;
  resolveAgentWorkspaceOutputRelativeDirs: typeof resolveAgentWorkspaceOutputRelativeDirs;
};

export default workspaceOutput;
