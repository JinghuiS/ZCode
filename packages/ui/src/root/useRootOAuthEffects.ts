import { useEffect } from "react";
import type { IPlatformService, UserInfo } from "@zcode/shared";
import { DesktopCommandIds, ZCODE_JWT_INVALID_BROADCAST_CHANNEL } from "@zcode/shared";
import type { IServiceAccessor } from "@zcode/services";
import { useAlertDialog } from "@/hooks/useAlertDialog.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { applyCachedOAuthSessionRestoreResult } from "@/root/oauthCachedSessionRestore.js";

/**
 * 智谱 OAuth 登录态的常驻副作用。
 *
 * 客户端登录与智谱套餐已下线：登录入口改由模型设置的 Provider 认证（ProviderAuthService）发起，
 * 这里只保留启动时恢复缓存的账号信息（会话分享等功能读取）、JWT 失效提示与桌面 deep link 回调。
 * deep link 回调完成 flow 后，ProviderAuthService 的轮询会检测到新凭据并解析账号 API Key。
 */
export function useRootOAuthEffects({
  platform,
  services,
  refreshProviderState,
  setUser,
  setIsRestoringOAuthSession,
  onReauthenticationRequired,
}: {
  platform: IPlatformService;
  services: IServiceAccessor;
  refreshProviderState: () => Promise<void>;
  setUser: (user: UserInfo | null) => void;
  setIsRestoringOAuthSession: (restoring: boolean) => void;
  onReauthenticationRequired: () => void;
}) {
  const requestAlert = useAlertDialog();
  const { intl } = useZCodeIntl();

  useEffect(() => {
    let disposed = false;
    async function restoreOAuthSessionInBackground() {
      logger.info("[Root] 后台启动 OAuth 本地会话恢复");
      try {
        // zai / bigmodel 的 OAuth token 生命周期较短，启动时如果仍走远端校验，
        // 用户会在 token 过期后被立刻打回“未登录”，和“已完成登录但未主动退出”的产品语义冲突。
        // 这里改为只读取登录成功时缓存的 user_info，展示态由“是否主动退出”决定，而不是由短 token 决定。
        const result = await services.oauthService.restoreCachedSessionState();

        if (disposed) {
          return;
        }

        await applyCachedOAuthSessionRestoreResult({
          result,
          setUser,
          requestAlert,
          onReauthenticationRequired,
          copy: {
            title: intl.formatMessage({ id: "login.expired.title" }),
            description: intl.formatMessage({ id: "login.expired.description" }),
            actionLabel: intl.formatMessage({ id: "login.expired.action" }),
          },
        });
      } catch (error) {
        logger.error("[Root] 恢复 OAuth 本地登录态失败:", error);
        if (disposed) {
          return;
        }
      }

      // 启动恢复是异步后台流程，慢网时如果不单独暴露“恢复中”状态，
      // sidebar 会先按 user=null 渲染成“登录”，而登录弹窗又还能读到本地 activeProvider，
      // 用户就会看到“外面未登录、弹窗里已登录提供方”的分裂展示。
      // 这里在恢复主流程结束后立刻落定状态，让 footer 先显示 loading，再收敛到最终登录态。
      setIsRestoringOAuthSession(false);

      try {
        // OAuth 会话恢复与 Provider Runtime 刷新保持后台执行，避免首屏等待网络链路。
        await refreshProviderState();
      } catch (error) {
        // 启动刷新失败不能跳过后续订阅，否则网络恢复后账号失效协调也永久停止。
        // 保留当前事实，继续由 Provider View 的正常更新驱动，不另起重试循环。
        logger.warn("[Root] 启动账号配置刷新失败，继续观察后续更新", { error });
      }
    }

    void restoreOAuthSessionInBackground();

    return () => {
      disposed = true;
    };
  }, [
    intl,
    onReauthenticationRequired,
    refreshProviderState,
    requestAlert,
    services,
    setIsRestoringOAuthSession,
    setUser,
  ]);

  useEffect(() => {
    let disposed = false;
    const disposable = services.broadcastService.onMessage((message) => {
      if (message.channel !== ZCODE_JWT_INVALID_BROADCAST_CHANNEL || disposed) {
        return;
      }
      void (async () => {
        const confirmed = await requestAlert({
          title: intl.formatMessage({ id: "login.expired.title" }),
          description: intl.formatMessage({ id: "login.expired.description" }),
          actionLabel: intl.formatMessage({ id: "login.expired.restart" }),
        });
        if (disposed) {
          return;
        }
        if (!confirmed) {
          onReauthenticationRequired();
          return;
        }
        if (typeof window !== "undefined" && !("zcode" in window)) {
          // Web 没有 Electron RelaunchApp；marker 写入后立即刷新，避免停留在僵尸登录态。
          window.location.reload();
          return;
        }
        await platform.executeDesktopCommand(DesktopCommandIds.RelaunchApp);
      })();
    });
    return () => {
      disposed = true;
      disposable.dispose();
    };
  }, [intl, onReauthenticationRequired, platform, requestAlert, services.broadcastService]);

  useEffect(() => {
    const disposeOAuth = platform.onOAuthCallback(async (url) => {
      try {
        const result = await services.oauthService.handleCallback(url);
        // 取消或切换 flow 会使已接收的回调失效，正常空结果不能被当作登录异常。
        if (!result || result.kind !== "session") {
          logger.info("[Root] 已忽略非会话 OAuth 回调", { kind: result?.kind ?? null });
          return;
        }
        setUser(result.userInfo);
        await refreshProviderState();
        logger.info("[Root] 智谱账号 OAuth deep link 登录完成", { provider: result.provider });
      } catch (error) {
        // 登录结果由模型设置的 ProviderAuthService 轮询判定；这里失败只记录，不覆盖其状态。
        logger.error("[Root] OAuth 回调处理失败:", error);
      }
    });
    platform.notifyRendererReady();
    return () => {
      disposeOAuth();
    };
  }, [platform, refreshProviderState, services, setUser]);
}
