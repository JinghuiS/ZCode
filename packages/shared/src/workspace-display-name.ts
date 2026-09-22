import { resolveWorkspaceKey } from "./task-realtime-core.js";
import type { WorkspacePurpose } from "./workspacePurpose.js";

export const WORKSPACE_DISPLAY_ALIAS_MAX_LENGTH = 80;

export function workspacePathDisplayLeaf(path: string): string {
  const segments = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

export function normalizeWorkspaceDisplayAlias(value: string): string | null {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, WORKSPACE_DISPLAY_ALIAS_MAX_LENGTH);
}

export function mergeWorkspaceDisplayAliasPatch(
  current: Readonly<Record<string, string>> | undefined,
  patch: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  const next = { ...current };
  if (!patch) {
    return next;
  }

  for (const [rawKey, rawValue] of Object.entries(patch)) {
    const key = rawKey.trim();
    if (!key) {
      continue;
    }
    const alias = normalizeWorkspaceDisplayAlias(rawValue);
    if (!alias) {
      delete next[key];
      continue;
    }
    next[key] = alias;
  }

  return next;
}

export function resolveWorkspaceDisplayName(params: {
  workspacePath: string;
  workspaceIdentity?: string;
  workspacePurpose?: WorkspacePurpose;
  aliases?: Readonly<Record<string, string>> | null;
  fallbackLabel?: string;
}): string {
  const fallback =
    params.fallbackLabel?.trim() ||
    workspacePathDisplayLeaf(params.workspacePath) ||
    params.workspacePath;
  if (params.workspacePurpose === "conversation") {
    return fallback;
  }

  const alias = params.aliases?.[resolveWorkspaceKey(params)]?.trim();
  return alias || fallback;
}
