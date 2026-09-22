import { resolveWorkspaceDisplayName, type WorkspacePurpose } from "@zcode/shared";

export function resolveTabWorkspaceDisplayLabel(
  tab: {
    workspacePath: string;
    workspaceIdentity?: string;
    workspacePurpose?: WorkspacePurpose;
    label?: string;
  },
  aliases?: Readonly<Record<string, string>> | null,
): string {
  return resolveWorkspaceDisplayName({
    workspacePath: tab.workspacePath,
    workspaceIdentity: tab.workspaceIdentity,
    workspacePurpose: tab.workspacePurpose,
    aliases,
    fallbackLabel: tab.label,
  });
}
