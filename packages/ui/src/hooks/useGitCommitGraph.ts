import { useCallback, useEffect, useRef, useState } from "react";
import type { GitCommitGraphCommit } from "@zcode/shared";
import { useWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { getErrorMessage } from "@/lib/errorMessage.js";
import { logger } from "@/logger.js";

const GIT_GRAPH_PAGE_SIZE = 50;

interface GitCommitGraphState {
  commits: GitCommitGraphCommit[];
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  refreshing: boolean;
  errorMessage: string | null;
  selectedCommitHash: string | null;
  selectCommit: (hash: string) => void;
  refresh: () => void;
  loadMore: () => void;
  reset: () => void;
}

/**
 * 提交图谱取数。侧栏历史区块与 GitGraphDialog 共用这一份逻辑，
 * 两个入口各自持有自己的分页与选中态，但不重复实现取数与失败归因。
 */
export function useGitCommitGraph(options: {
  workspacePath: string;
  workspaceIdentity?: string | null;
  remoteSessionId?: string | null;
  /** 关闭时不取数；重新打开会重新拉第一页。 */
  enabled: boolean;
  logScope: string;
  /** 已有数据时的失败通知（刷新/加载更多）；首次加载失败走 errorMessage 全屏态。 */
  onError?: (message: string) => void;
}): GitCommitGraphState {
  const { workspacePath, workspaceIdentity, remoteSessionId, enabled, logScope, onError } = options;
  // onError 由调用方每次渲染重建也不应重跑取数，这里用 ref 读最新值。
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const { gitService } = useWorkspaceServices(workspacePath, remoteSessionId, workspaceIdentity);
  const { intl } = useZCodeIntl();
  const [commits, setCommits] = useState<GitCommitGraphCommit[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedCommitHash, setSelectedCommitHash] = useState<string | null>(null);
  const loadingMoreRef = useRef(false);
  // 请求版本：workspace 切换或重新打开时，late resolve 的旧响应不得覆盖新一轮结果。
  const requestVersionRef = useRef(0);

  const reset = useCallback(() => {
    requestVersionRef.current += 1;
    loadingMoreRef.current = false;
    setLoading(false);
    setLoadingMore(false);
    setRefreshing(false);
    setErrorMessage(null);
  }, []);

  const loadFirstPage = useCallback(
    async (mode: "initial" | "refresh") => {
      const version = ++requestVersionRef.current;
      loadingMoreRef.current = false;
      if (mode === "initial") {
        setLoading(true);
        setCommits([]);
        setHasMore(false);
        setSelectedCommitHash(null);
      } else {
        setRefreshing(true);
      }
      setErrorMessage(null);

      try {
        const result = await gitService.getCommitGraph({
          workspacePath,
          maxCount: GIT_GRAPH_PAGE_SIZE,
          skip: 0,
        });
        if (version !== requestVersionRef.current) return;
        setCommits(result.commits);
        setHasMore(result.hasMore);
        setSelectedCommitHash(result.commits[0]?.hash ?? null);
      } catch (error: unknown) {
        if (version !== requestVersionRef.current) return;
        const message = getErrorMessage(error);
        logger.warn(`[${logScope}] 读取 Git Graph 失败`, { workspacePath, error: message });
        const copy = intl.formatMessage({ id: "gitGraph.error.requestFailed" }, { error: message });
        // 刷新失败不得把已经渲染出来的图谱换成错误页，只通知调用方。
        if (mode === "refresh") {
          onErrorRef.current?.(copy);
        } else {
          setErrorMessage(copy);
        }
      } finally {
        if (version === requestVersionRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [gitService, intl, logScope, workspacePath],
  );

  useEffect(() => {
    if (!enabled) {
      reset();
      return;
    }

    void loadFirstPage("initial");
  }, [enabled, loadFirstPage, reset]);

  const refresh = useCallback(() => {
    if (loading || loadingMore || refreshing) return;
    void loadFirstPage("refresh");
  }, [loadFirstPage, loading, loadingMore, refreshing]);

  const loadMore = useCallback(() => {
    if (loading || loadingMore || refreshing || loadingMoreRef.current || !hasMore) return;

    const version = requestVersionRef.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setErrorMessage(null);

    void (async () => {
      try {
        const result = await gitService.getCommitGraph({
          workspacePath,
          maxCount: GIT_GRAPH_PAGE_SIZE,
          skip: commits.length,
        });
        if (version !== requestVersionRef.current) return;
        setCommits((currentCommits) => [...currentCommits, ...result.commits]);
        setHasMore(result.hasMore);
      } catch (error: unknown) {
        if (version !== requestVersionRef.current) return;
        const message = getErrorMessage(error);
        logger.warn(`[${logScope}] 读取更多 Git Graph 失败`, {
          workspacePath,
          loadedCommitCount: commits.length,
          error: message,
        });
        onErrorRef.current?.(
          intl.formatMessage({ id: "gitGraph.error.requestFailed" }, { error: message }),
        );
      } finally {
        loadingMoreRef.current = false;
        if (version === requestVersionRef.current) {
          setLoadingMore(false);
        }
      }
    })();
  }, [
    commits.length,
    gitService,
    hasMore,
    intl,
    loading,
    loadingMore,
    logScope,
    refreshing,
    workspacePath,
  ]);

  const selectCommit = useCallback((hash: string) => {
    setSelectedCommitHash(hash);
  }, []);

  return {
    commits,
    hasMore,
    loading,
    loadingMore,
    refreshing,
    errorMessage,
    selectedCommitHash,
    selectCommit,
    refresh,
    loadMore,
    reset,
  };
}
