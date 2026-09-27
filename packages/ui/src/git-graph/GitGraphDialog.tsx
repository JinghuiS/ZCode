import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { toast } from "@/components/ui/toast.js";
import { cn } from "@/components/lib/utils.js";
import { GitGraphPane } from "@/git-graph/GitGraphPane.js";
import { useGitCommitGraph } from "@/hooks/useGitCommitGraph.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import {
  AlertCircleIcon,
  GitGraph as GitGraphIcon,
  LoaderIcon,
  RefreshCwIcon,
  XIcon,
} from "lucide-react";

interface GitGraphDialogProps {
  open: boolean;
  workspacePath: string;
  /** 远程项目必须带上身份，否则图谱会落到本机仓库。 */
  workspaceIdentity?: string;
  remoteSessionId?: string | null;
  onOpenChange: (nextOpen: boolean) => void;
}

export function GitGraphDialog({
  open,
  workspacePath,
  workspaceIdentity,
  remoteSessionId = null,
  onOpenChange,
}: GitGraphDialogProps) {
  const { intl } = useZCodeIntl();
  const commitGraph = useGitCommitGraph({
    workspacePath,
    workspaceIdentity,
    remoteSessionId,
    enabled: open,
    logScope: "GitGraphDialog",
    onError: toast,
  });
  const {
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
  } = commitGraph;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          reset();
        }
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="h-[min(78vh,720px)] max-w-5xl gap-0 overflow-hidden rounded-2xl p-0"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{intl.formatMessage({ id: "gitGraph.title" })}</DialogTitle>
          <DialogDescription>
            {intl.formatMessage({ id: "gitGraph.dialogDescription" })}
          </DialogDescription>
        </DialogHeader>
        {/* 图谱本体不再自带标题行，对话框自己出标题与刷新，标题也顺带成为可见的弹窗标题。 */}
        <div className="flex min-w-0 items-center justify-between gap-3 border-b border-border bg-surface/40 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <GitGraphIcon className="size-3.5 shrink-0 text-foreground" />
            <span className="truncate text-ui-base font-medium">
              {intl.formatMessage({ id: "gitGraph.title" })}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={refreshing}
              aria-label={intl.formatMessage({ id: "gitGraph.refresh" })}
              title={intl.formatMessage({ id: "gitGraph.refresh" })}
              className="text-foreground-subtle hover:text-foreground"
              onClick={refresh}
            >
              <RefreshCwIcon className={cn("size-3.5", refreshing && "animate-spin")} />
            </Button>
          </div>
        </div>
        <DialogClose asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={intl.formatMessage({ id: "common.close" })}
            className="absolute right-2 top-2 z-30 bg-background/80 text-foreground-subtle hover:bg-hover hover:text-foreground [app-region:no-drag]"
          >
            <XIcon className="size-3.5" />
          </Button>
        </DialogClose>
        {loading ? (
          <div className="flex h-full items-center justify-center bg-background text-foreground-subtle">
            <LoaderIcon className="size-5 animate-spin" />
          </div>
        ) : errorMessage ? (
          <div className="flex h-full items-center justify-center bg-background p-6">
            <div className="max-w-md rounded-xl border border-border bg-card p-4 text-ui-base text-foreground">
              <div className="flex items-start gap-3">
                <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-warning" />
                <p className="break-words text-foreground-subtle">{errorMessage}</p>
              </div>
            </div>
          </div>
        ) : (
          <GitGraphPane
            workspacePath={workspacePath}
            workspaceIdentity={workspaceIdentity}
            remoteSessionId={remoteSessionId}
            commits={commits}
            hasMore={hasMore}
            loadingMore={loadingMore}
            selectedCommitHash={selectedCommitHash}
            onSelectCommit={selectCommit}
            onLoadMore={loadMore}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
