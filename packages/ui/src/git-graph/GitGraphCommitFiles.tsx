import { useMemo } from "react";
import type { GitCommitFileChange } from "@zcode/shared";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { FileDisplayInline } from "@/lib/fileDisplay.js";
import { getCommitFileRenameSource, summarizeCommitFiles } from "./commitFiles.js";

interface GitGraphCommitFilesProps {
  /** null 表示该提交的文件清单还在取；空数组表示该提交没有文件变更。 */
  files: readonly GitCommitFileChange[] | null;
  loading: boolean;
  errorMessage: string | null;
}

export function GitGraphCommitFiles({ files, loading, errorMessage }: GitGraphCommitFilesProps) {
  const { intl } = useZCodeIntl();
  const summary = useMemo(() => (files ? summarizeCommitFiles(files) : null), [files]);

  return (
    <div className="text-ui-base">
      <div className="mb-1.5 flex min-w-0 items-center justify-between gap-3">
        <span className="truncate font-medium text-foreground-subtle">
          {intl.formatMessage({ id: "gitGraph.detail.files" })}
        </span>
        {summary ? (
          <span className="flex shrink-0 items-center gap-2 whitespace-nowrap text-foreground-subtle">
            <span>
              {intl.formatMessage({ id: "gitGraph.detail.filesCount" }, { count: summary.count })}
            </span>
            <span className="text-diff-added">+{summary.added}</span>
            <span className="text-diff-removed">-{summary.removed}</span>
          </span>
        ) : null}
      </div>

      {loading ? (
        <div className="py-1 text-foreground-subtle">
          {intl.formatMessage({ id: "common.loading" })}
        </div>
      ) : errorMessage ? (
        <div className="break-words py-1 text-warning">{errorMessage}</div>
      ) : files && files.length > 0 ? (
        // 展开的内容在提交列表里滚动，文件多的提交（例如合并）只在清单内滚动，不把后续提交挤出可视区。
        <ul className="max-h-48 overflow-auto">
          {files.map((file) => {
            const renameSource = getCommitFileRenameSource(file);
            return (
              <li
                key={file.repoRelativePath}
                className="flex min-w-0 items-center gap-2 py-1"
                title={file.workspaceRelativePath}
              >
                <span className="min-w-0 flex-1">
                  <FileDisplayInline
                    path={file.workspaceRelativePath}
                    options={{
                      showFilePath: true,
                      className: "inline-flex min-w-0 max-w-full items-center gap-2",
                      fileNameClassName: "truncate text-ui-base text-foreground",
                      filePathClassName: "truncate text-ui-base text-foreground-subtlest",
                    }}
                  />
                </span>
                {renameSource ? (
                  <span className="max-w-40 shrink-0 truncate text-foreground-subtlest">
                    {intl.formatMessage(
                      { id: "gitGraph.detail.renamedFrom" },
                      { path: renameSource },
                    )}
                  </span>
                ) : null}
                <span className="shrink-0 whitespace-nowrap">
                  <span className="text-diff-added">+{file.added}</span>
                  <span className="ml-2 text-diff-removed">-{file.removed}</span>
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="py-1 text-foreground-subtle">
          {intl.formatMessage({ id: "gitGraph.detail.filesEmpty" })}
        </div>
      )}
    </div>
  );
}
