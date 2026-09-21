import { useCallback, useEffect, useRef, useState } from "react";
import {
  PROVIDER_AUTH_CHANGED_BROADCAST_CHANNEL,
  type ProviderAuthDeviceLoginStart,
  type ProviderAuthProviderId,
  type ProviderAuthStatus,
} from "@zcode/shared";
import { logger } from "@/logger.js";
import { usePlatform } from "./usePlatform.js";
import { useServices } from "./useServices.js";

export type ProviderAuthLoginState =
  | { phase: "idle" }
  | { phase: "starting" }
  | { phase: "waiting"; login: ProviderAuthDeviceLoginStart }
  | { phase: "failed"; errorMessage: string };

/**
 * Provider 级账号登录状态。
 *
 * 状态事实由 Host 的 ProviderAuthService 持有；这里只缓存展示值，
 * 登录完成、登出或其他窗口改变凭据（provider-auth:changed 广播）后重新读取。
 */
export function useProviderAuth(authProviderId: ProviderAuthProviderId | undefined) {
  const { providerAuthService, broadcastService } = useServices();
  const platform = usePlatform();
  const [status, setStatus] = useState<ProviderAuthStatus | null>(null);
  const [loginState, setLoginState] = useState<ProviderAuthLoginState>({ phase: "idle" });
  const activeLoginIdRef = useRef<string | null>(null);

  const refreshStatus = useCallback(async () => {
    if (!authProviderId) return;
    try {
      setStatus(await providerAuthService.getStatus(authProviderId));
    } catch (error) {
      logger.warn("[ProviderAuth] 读取认证状态失败", { authProviderId, error });
    }
  }, [authProviderId, providerAuthService]);

  useEffect(() => {
    setStatus(null);
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    if (!authProviderId) return;
    const disposable = broadcastService.onMessage((message) => {
      if (message.channel !== PROVIDER_AUTH_CHANGED_BROADCAST_CHANNEL) return;
      const payload = message.payload as { authProviderId?: unknown } | undefined;
      if (payload?.authProviderId !== authProviderId) return;
      void refreshStatus();
    });
    return () => disposable.dispose();
  }, [authProviderId, broadcastService, refreshStatus]);

  // 卡片卸载时取消仍在轮询的登录，避免 Host 端悬挂会话。
  useEffect(
    () => () => {
      const loginId = activeLoginIdRef.current;
      if (loginId) void providerAuthService.cancelLogin(loginId);
    },
    [providerAuthService],
  );

  const startLogin = useCallback(async (): Promise<boolean> => {
    if (!authProviderId) return false;
    setLoginState({ phase: "starting" });
    let login: ProviderAuthDeviceLoginStart;
    try {
      login = await providerAuthService.startDeviceLogin(authProviderId);
    } catch (error) {
      setLoginState({
        phase: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
    activeLoginIdRef.current = login.loginId;
    setLoginState({ phase: "waiting", login });
    platform.openExternal(login.verificationUriComplete ?? login.verificationUri);

    const result = await providerAuthService.awaitLogin(login.loginId);
    // 用户可能已重新发起登录；只处理当前这一轮的结果。
    if (activeLoginIdRef.current !== login.loginId) return false;
    activeLoginIdRef.current = null;
    if (result.status === "connected") {
      setLoginState({ phase: "idle" });
      await refreshStatus();
      return true;
    }
    setLoginState(
      result.status === "failed"
        ? { phase: "failed", errorMessage: result.errorMessage }
        : { phase: "idle" },
    );
    return false;
  }, [authProviderId, platform, providerAuthService, refreshStatus]);

  const cancelLogin = useCallback(() => {
    const loginId = activeLoginIdRef.current;
    activeLoginIdRef.current = null;
    setLoginState({ phase: "idle" });
    if (loginId) void providerAuthService.cancelLogin(loginId);
  }, [providerAuthService]);

  const logout = useCallback(async () => {
    if (!authProviderId) return;
    await providerAuthService.logout(authProviderId);
    await refreshStatus();
  }, [authProviderId, providerAuthService, refreshStatus]);

  return { status, loginState, startLogin, cancelLogin, logout };
}
