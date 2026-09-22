import { useCallback, useEffect, useState } from "react";
import type { ProviderAuthProviderId, ProviderAuthSubscriptionUsage } from "@zcode/shared";
import { logger } from "@/logger.js";
import { useServices } from "./useServices.js";

/**
 * SuperGrok 套餐用量展示值。事实在 Host；这里只缓存卡片展示，登出或未启用时丢弃。
 */
export function useProviderAuthSubscriptionUsage(
  authProviderId: ProviderAuthProviderId | undefined,
  enabled: boolean,
) {
  const { providerAuthService } = useServices();
  const [usage, setUsage] = useState<ProviderAuthSubscriptionUsage | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(
    async (forceRefresh = false) => {
      if (!authProviderId || !enabled) return;
      setLoading(true);
      try {
        setUsage(
          await providerAuthService.getSubscriptionUsage({
            authProviderId,
            ...(forceRefresh ? { forceRefresh: true } : {}),
          }),
        );
      } catch (error) {
        logger.warn("[ProviderAuth] 读取套餐用量失败", { authProviderId, error });
        setUsage({ status: "unavailable" });
      } finally {
        setLoading(false);
      }
    },
    [authProviderId, enabled, providerAuthService],
  );

  useEffect(() => {
    if (!enabled || !authProviderId) {
      setUsage(null);
      setLoading(false);
      return;
    }
    void refresh();
  }, [authProviderId, enabled, refresh]);

  return { usage, loading, refresh };
}
