import type { GitCommitFileChange } from "@zcode/shared";

interface GitCommitFilesSummary {
  count: number;
  added: number;
  removed: number;
}

export function summarizeCommitFiles(files: readonly GitCommitFileChange[]): GitCommitFilesSummary {
  return files.reduce<GitCommitFilesSummary>(
    (summary, file) => ({
      count: summary.count + 1,
      added: summary.added + file.added,
      removed: summary.removed + file.removed,
    }),
    { count: 0, added: 0, removed: 0 },
  );
}

/** 只有被识别为重命名的文件才展示来源路径；其余返回 null，避免把普通改动的旧路径当成重命名提示。 */
export function getCommitFileRenameSource(file: GitCommitFileChange): string | null {
  if (file.kind !== "renamed") {
    return null;
  }

  const renameSource = file.originalWorkspaceRelativePath?.trim() ?? "";
  return renameSource.length > 0 ? renameSource : null;
}
