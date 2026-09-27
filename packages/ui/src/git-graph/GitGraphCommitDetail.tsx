import { useCallback, useEffect, useRef } from "react";
import type { GitCommitFileChange } from "@zcode/shared";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { getShortHash } from "./GitGraphDisplay.js";
import { GitGraphCommitFiles } from "./GitGraphCommitFiles.js";
import type { GitGraphCommit } from "./layout.js";

interface GitGraphCommitDetailProps {
  commit: GitGraphCommit;
  files: readonly GitCommitFileChange[] | null;
  filesLoading: boolean;
  filesErrorMessage: string | null;
  /** 行内展开会撑高该行；高度回传给图谱布局，展开行之后的泳道才会跟着下移。 */
  onContentHeightChange: (height: number) => void;
}

/**
 * 提交行内展开块。文件清单直接列在提交所在行下面，跟着提交列表一起滚动；
 * 主题/日期/作者已经在提交行上，这里只补行上看不到的完整 hash 与父提交。
 */
export function GitGraphCommitDetail({
  commit,
  files,
  filesLoading,
  filesErrorMessage,
  onContentHeightChange,
}: GitGraphCommitDetailProps) {
  const { intl } = useZCodeIntl();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const reportedHeightRef = useRef(-1);

  const reportHeight = useCallback(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }

    const height = Math.round(element.getBoundingClientRect().height);
    if (height === reportedHeightRef.current) {
      return;
    }

    reportedHeightRef.current = height;
    onContentHeightChange(height);
  }, [onContentHeightChange]);

  // effect 在首帧提交后立即上报一次高度，泳道不必等 ResizeObserver 的下一帧。
  // 清单加载完成、切换提交、面板变窄都会改变高度，因此继续用 ResizeObserver 跟随。
  useEffect(() => {
    reportHeight();
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(reportHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, [reportHeight]);

  return (
    <div
      ref={containerRef}
      className="border-b border-border bg-background-alt/35 px-3 py-2 text-ui-base"
      data-git-commit-expansion={commit.hash}
    >
      <div className="mb-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 font-mono text-foreground-subtlest">
        <span className="break-all select-all">
          {intl.formatMessage({ id: "gitGraph.detail.commit" })} {commit.hash}
        </span>
        <span className="break-all select-all">
          {intl.formatMessage({ id: "gitGraph.detail.parents" })}{" "}
          {commit.parents.length > 0 ? commit.parents.map(getShortHash).join(", ") : "-"}
        </span>
      </div>
      <GitGraphCommitFiles files={files} loading={filesLoading} errorMessage={filesErrorMessage} />
    </div>
  );
}
