import { useCallback, useEffect, useRef, useState } from "react";
import type { KimiComputerUseStatus } from "@zcode/services";
import { logger } from "@/logger.js";
import { useServices } from "./useServices.js";

/**
 * 电脑控制（Kimi Computer Use）本机安装与授权状态。
 *
 * 事实由 Host 的 KimiComputerUseService 探测；安装与授权都在系统终端 / 系统设置中完成，
 * 因此进入页面、窗口重获焦点和手动刷新时各读一次，不做定时轮询。
 */
export function useKimiComputerUseStatus(enabled: boolean) {
  const { kimiComputerUseService } = useServices();
  const [status, setStatus] = useState<KimiComputerUseStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const next = await kimiComputerUseService.getStatus();
      // 只采用最后一次请求的结果，避免慢请求覆盖新状态。
      if (requestId === requestIdRef.current) setStatus(next);
    } catch (error) {
      logger.warn("[KimiComputerUse] 读取状态失败", { error });
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [enabled, kimiComputerUseService]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!enabled) return;
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [enabled, refresh]);

  return { status, loading, refresh };
}
