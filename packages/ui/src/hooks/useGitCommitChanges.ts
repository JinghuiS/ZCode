import { useEffect, useRef, useState } from "react";
import type { GitCommitFileChange } from "@zcode/shared";
import { useWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { getErrorMessage } from "@/lib/errorMessage.js";
import { logger } from "@/logger.js";

/** 提交内容按 hash 不可变，缓存只是避免同一提交来回展开时重复跑 git。 */
const GIT_COMMIT_FILES_CACHE_LIMIT = 32;

interface GitCommitChangesState {
  /** null 表示该提交的文件清单还没取到（含未展开）；空数组表示该提交确实没有文件变更。 */
  files: GitCommitFileChange[] | null;
  loading: boolean;
  errorMessage: string | null;
}

/**
 * 某次提交的文件清单取数。侧栏历史区块与 GitGraphDialog 共用这一份逻辑，
 * 两个入口各自持有自己的展开提交与缓存，不互相同步。
 */
export function useGitCommitChanges(options: {
  workspacePath: string;
  workspaceIdentity?: string | null;
  remoteSessionId?: string | null;
  /** 展开的提交；null 表示没有展开任何提交，不取数。 */
  commitHash: string | null;
  logScope: string;
}): GitCommitChangesState {
  const { workspacePath, workspaceIdentity, remoteSessionId, commitHash, logScope } = options;
  const { gitService } = useWorkspaceServices(workspacePath, remoteSessionId, workspaceIdentity);
  const { intl } = useZCodeIntl();
  const [files, setFiles] = useState<GitCommitFileChange[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const cacheRef = useRef(new Map<string, GitCommitFileChange[]>());
  // 请求版本：展开的提交切走后，late resolve 的旧响应不得覆盖新一轮结果。
  const requestVersionRef = useRef(0);

  // 同一个 hash 在本机仓库、另一台机器或另一个远端 attachment 下是不同的事实，scope 变了缓存必须失效。
  useEffect(() => {
    cacheRef.current.clear();
  }, [remoteSessionId, workspaceIdentity, workspacePath]);

  useEffect(() => {
    const version = ++requestVersionRef.current;

    if (!commitHash) {
      setFiles(null);
      setLoading(false);
      setErrorMessage(null);
      return;
    }

    const cachedFiles = cacheRef.current.get(commitHash);
    if (cachedFiles) {
      setFiles(cachedFiles);
      setLoading(false);
      setErrorMessage(null);
      return;
    }

    setFiles(null);
    setLoading(true);
    setErrorMessage(null);

    void gitService
      .getCommitChanges({ workspacePath, commitHash })
      .then((result) => {
        if (version !== requestVersionRef.current) {
          return;
        }

        const cache = cacheRef.current;
        cache.set(commitHash, result.files);
        if (cache.size > GIT_COMMIT_FILES_CACHE_LIMIT) {
          const oldestHash = cache.keys().next().value;
          if (oldestHash !== undefined) {
            cache.delete(oldestHash);
          }
        }
        setFiles(result.files);
      })
      .catch((error: unknown) => {
        if (version !== requestVersionRef.current) {
          return;
        }

        const message = getErrorMessage(error);
        logger.warn(`[${logScope}] 读取提交文件失败`, {
          workspacePath,
          commitHash,
          error: message,
        });
        // 失败不进缓存：重新展开同一提交会重试，而不是把错误状态一直挂在该 hash 上。
        setErrorMessage(
          intl.formatMessage({ id: "gitGraph.detail.filesError" }, { error: message }),
        );
      })
      .finally(() => {
        if (version === requestVersionRef.current) {
          setLoading(false);
        }
      });
  }, [commitHash, gitService, intl, logScope, workspacePath]);

  return { files, loading, errorMessage };
}
