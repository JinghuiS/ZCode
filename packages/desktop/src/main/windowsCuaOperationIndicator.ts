/* eslint-disable max-lines -- 预览窗生命周期与捕获接线同文件，避免状态分叉。 */
import { join } from "node:path";
import { app, BrowserWindow, screen } from "electron";
import type {
  BrowserWindowConstructorOptions,
  DesktopCapturerSource,
  Display,
  Point,
  Rectangle,
  Session,
} from "electron";
import type { ComputerUseTarget, HostCuaOperationStateResponse, Locale } from "@zcode/shared";
import {
  createComputerUsePreviewCapture,
  type ComputerUsePreviewCapture,
  type ComputerUsePreviewSink,
} from "./computerUsePreviewCapture.js";
import {
  anchoredIndicatorBounds,
  INDICATOR_CARD_TOP_OFFSET,
  INDICATOR_SHADOW_INSET,
  indicatorWindowSize,
  previewClearScript,
  previewFrameScript,
  previewVideoStartScript,
  supportsComputerUsePreview,
  writeIndicatorPage,
} from "./windowsCuaOperationIndicatorContent.js";

const HIDE_ANIMATION_MS = 120;
/** 仅在 turn 终态全部失约时收场；30s 覆盖单 cell 长跑，避免 10s 中途熄灭。 */
const AUTO_HIDE_MS = 30_000;
const CREATE_RETRY_MS = 250;
/** 预览窗独立的内存分区：displayMedia 处理器只作用于它，不影响主窗口的屏幕共享。 */
const PREVIEW_PARTITION = "cua-preview";
const ANCHOR_EVENTS = ["move", "resize", "minimize", "restore", "show", "hide"] as const;
type AnchorEvent = (typeof ANCHOR_EVENTS)[number];

/** 发起电脑控制的对话窗；预览窗贴在它旁边并随它移动。 */
export interface CuaPreviewAnchorWindow {
  getBounds(): Rectangle;
  isDestroyed(): boolean;
  isMinimized(): boolean;
  isVisible(): boolean;
  on(event: AnchorEvent | "closed", listener: () => void): unknown;
  removeListener(event: AnchorEvent | "closed", listener: () => void): unknown;
}

interface WindowsCuaOperationIndicatorWindow {
  readonly webContents: Pick<BrowserWindow["webContents"], "executeJavaScript"> & {
    readonly session: Pick<Session, "setDisplayMediaRequestHandler">;
  };
  destroy(): void;
  hide(): void;
  isDestroyed(): boolean;
  loadFile(path: string): Promise<void>;
  moveTop(): void;
  on(event: "closed", listener: () => void): this;
  setAlwaysOnTop(flag: boolean, level?: Parameters<BrowserWindow["setAlwaysOnTop"]>[1]): void;
  setBounds(bounds: Rectangle): void;
  setContentProtection(enable: boolean): void;
  setIgnoreMouseEvents(ignore: boolean): void;
  showInactive(): void;
}

interface WindowsCuaOperationIndicator {
  handleState(source: object, event: HostCuaOperationStateResponse): void;
  clearSource(source: object): void;
  ownsWindow(candidate: object): boolean;
  refreshContent(): void;
  dispose(): void;
}

interface IndicatorLogger {
  debug(...args: unknown[]): void;
  warn(...args: unknown[]): void;
}

interface WindowsCuaOperationIndicatorOptions {
  platform?: NodeJS.Platform;
  getLocale: () => Locale;
  logger: IndicatorLogger;
  createWindow?: (options: BrowserWindowConstructorOptions) => WindowsCuaOperationIndicatorWindow;
  getCursorScreenPoint?: () => Point;
  getDisplayNearestPoint?: (point: Point) => Pick<Display, "workArea">;
  getDisplayMatching?: (rect: Rectangle) => Pick<Display, "workArea">;
  schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancelSchedule?: (timer: ReturnType<typeof setTimeout>) => void;
  /** macOS ScreenCaptureKit 辅助程序路径。 */
  resolveHelperBinary?: () => string | undefined;
  /** 按 Host 进程找到对应的对话窗；找不到时预览窗退回屏幕顶部居中。 */
  resolveAnchorWindow?: (source: object) => CuaPreviewAnchorWindow | undefined;
  resolvePageDirectory?: () => string;
  createCapture?: (input: { sink: ComputerUsePreviewSink }) => ComputerUsePreviewCapture;
}

export function createWindowsCuaOperationIndicator(
  options: WindowsCuaOperationIndicatorOptions,
): WindowsCuaOperationIndicator {
  const platform = options.platform ?? process.platform;
  const createWindow =
    options.createWindow ??
    ((windowOptions: BrowserWindowConstructorOptions) =>
      new BrowserWindow(windowOptions) as WindowsCuaOperationIndicatorWindow);
  const getCursorScreenPoint =
    options.getCursorScreenPoint ?? (() => screen.getCursorScreenPoint());
  const getDisplayNearestPoint =
    options.getDisplayNearestPoint ?? ((point: Point) => screen.getDisplayNearestPoint(point));
  const getDisplayMatching =
    options.getDisplayMatching ?? ((rect: Rectangle) => screen.getDisplayMatching(rect));
  const resolvePageDirectory =
    options.resolvePageDirectory ?? (() => join(app.getPath("userData"), "computer-use-preview"));
  const schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  const cancelSchedule = options.cancelSchedule ?? ((timer) => clearTimeout(timer));

  const activeTurnKeysBySource = new Map<object, Set<string>>();
  const ownedWindows = new WeakSet<object>();
  const failedWindows = new WeakSet<object>();
  let window: WindowsCuaOperationIndicatorWindow | null = null;
  let windowReady = false;
  let windowShown = false;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  const autoHideTimersBySource = new Map<object, Map<string, ReturnType<typeof setTimeout>>>();
  let reconcileTimer: ReturnType<typeof setTimeout> | null = null;
  let setupRetryAvailable = false;
  let disposed = false;
  let anchorSource: object | undefined;
  let attachedAnchor: CuaPreviewAnchorWindow | undefined;
  /** Windows 取流目标；预览页 getDisplayMedia 时由分区的 displayMedia 处理器交出。 */
  let pendingDisplaySource: DesktopCapturerSource | undefined;

  function runPreviewScript(script: string, userGesture = false): void {
    if (!window || window.isDestroyed() || !windowReady) return;
    void window.webContents
      .executeJavaScript(script, userGesture)
      .catch((error) =>
        options.logger.debug("[cua-operation-indicator] preview update failed", error),
      );
  }

  function startPreviewVideo(): void {
    if (pendingDisplaySource) runPreviewScript(previewVideoStartScript(), true);
  }

  const sink: ComputerUsePreviewSink = {
    showFrame: (dataUrl) => runPreviewScript(previewFrameScript(dataUrl)),
    showSource: (source) => {
      pendingDisplaySource = source;
      startPreviewVideo();
    },
    clear: () => {
      pendingDisplaySource = undefined;
      runPreviewScript(previewClearScript());
    },
  };
  const capture =
    options.createCapture?.({ sink }) ??
    createComputerUsePreviewCapture({
      platform,
      resolveHelperBinary: options.resolveHelperBinary,
      sink,
      logger: options.logger,
      schedule,
      cancelSchedule,
    });
  const latestTargetByKey = new Map<string, ComputerUseTarget | undefined>();
  let lastActivatedKey: string | undefined;

  function isActiveKey(key: string): boolean {
    for (const keys of activeTurnKeysBySource.values()) {
      if (keys.has(key)) return true;
    }
    return false;
  }

  /** 跟随最近一次电脑控制操作的目标；它没有身份时退回任一有身份的活跃 turn。 */
  function syncCaptureTarget(): void {
    if (!hasActiveTurns()) {
      capture.setTarget(undefined);
      return;
    }
    let next =
      lastActivatedKey && isActiveKey(lastActivatedKey)
        ? latestTargetByKey.get(lastActivatedKey)
        : undefined;
    if (!next) {
      for (const keys of activeTurnKeysBySource.values()) {
        for (const key of keys) next ??= latestTargetByKey.get(key);
      }
    }
    capture.setTarget(next);
  }

  function hasActiveTurns(): boolean {
    for (const keys of activeTurnKeysBySource.values()) {
      if (keys.size > 0) return true;
    }
    return false;
  }

  function keyFor(event: HostCuaOperationStateResponse): string {
    const workspaceKey = event.workspaceIdentity?.trim() || event.workspacePath;
    return `${workspaceKey}\0${event.sessionId}\0${event.turnId}`;
  }

  function setDocumentState(nextState: "active" | "leaving"): void {
    if (!window || window.isDestroyed()) return;
    void window.webContents
      .executeJavaScript(`document.documentElement.dataset.state=${JSON.stringify(nextState)}`)
      .catch((error) =>
        options.logger.debug("[cua-operation-indicator] state update failed", error),
      );
  }

  function cancelPendingHide(): void {
    if (!hideTimer) return;
    cancelSchedule(hideTimer);
    hideTimer = null;
  }

  function cancelAutoHide(source: object, key: string): void {
    const timers = autoHideTimersBySource.get(source);
    const timer = timers?.get(key);
    if (!timer) return;
    cancelSchedule(timer);
    timers?.delete(key);
    if (timers?.size === 0) autoHideTimersBySource.delete(source);
  }

  function scheduleAutoHide(source: object, key: string): void {
    cancelAutoHide(source, key);
    const timers = autoHideTimersBySource.get(source) ?? new Map();
    autoHideTimersBySource.set(source, timers);
    let timer: ReturnType<typeof setTimeout>;
    timer = schedule(() => {
      const currentTimers = autoHideTimersBySource.get(source);
      if (currentTimers?.get(key) !== timer) return;
      currentTimers.delete(key);
      if (currentTimers.size === 0) autoHideTimersBySource.delete(source);

      const sourceKeys = activeTurnKeysBySource.get(source);
      if (!sourceKeys?.delete(key)) return;
      if (sourceKeys.size === 0) activeTurnKeysBySource.delete(source);
      // 安全计时器是 fail-hidden 边界：即使 runtime 没有补发 inactive，也不能让
      // 原生浮层无限期可见；后续 CUA tool-started 会重新建立该键并重新计时。
      latestTargetByKey.delete(key);
      if (!hasActiveTurns()) beginHide();
      else {
        syncAnchorAndPosition();
        syncCaptureTarget();
      }
    }, AUTO_HIDE_MS);
    timers.set(key, timer);
  }

  function scheduleSetupRetry(): void {
    if (!setupRetryAvailable || !hasActiveTurns() || reconcileTimer) return;
    setupRetryAvailable = false;
    reconcileTimer = schedule(() => {
      reconcileTimer = null;
      ensureWindow();
    }, CREATE_RETRY_MS);
  }

  function discardFailedWindow(target: WindowsCuaOperationIndicatorWindow): void {
    failedWindows.add(target);
    if (window === target) {
      window = null;
      windowReady = false;
      windowShown = false;
    }
    try {
      if (!target.isDestroyed()) target.destroy();
    } catch (destroyError) {
      options.logger.debug(
        "[cua-operation-indicator] failed to discard partial window",
        destroyError,
      );
    }
  }

  function repositionToAnchor(): void {
    if (disposed || !window || window.isDestroyed() || !hasActiveTurns()) return;
    positionWindow(window);
  }

  function detachAnchor(): void {
    if (!attachedAnchor) return;
    const previous = attachedAnchor;
    attachedAnchor = undefined;
    if (previous.isDestroyed()) return;
    for (const event of ANCHOR_EVENTS) previous.removeListener(event, repositionToAnchor);
    previous.removeListener("closed", handleAnchorClosed);
  }

  function handleAnchorClosed(): void {
    attachedAnchor = undefined;
    repositionToAnchor();
  }

  /** 锚点切换时重新挂监听：对话窗移动、缩放、最小化时预览窗跟随。 */
  function syncAnchor(): void {
    if (anchorSource && !activeTurnKeysBySource.get(anchorSource)?.size) {
      anchorSource = activeTurnKeysBySource.keys().next().value;
    }
    const next = anchorSource ? options.resolveAnchorWindow?.(anchorSource) : undefined;
    const usable = next && !next.isDestroyed() ? next : undefined;
    if (usable === attachedAnchor) return;
    detachAnchor();
    if (!usable) return;
    attachedAnchor = usable;
    for (const event of ANCHOR_EVENTS) usable.on(event, repositionToAnchor);
    usable.on("closed", handleAnchorClosed);
  }

  function anchoredBounds(size: { width: number; height: number }): Rectangle | undefined {
    const anchor = attachedAnchor;
    if (!anchor || anchor.isDestroyed() || anchor.isMinimized() || !anchor.isVisible()) {
      return undefined;
    }
    const bounds = anchor.getBounds();
    return anchoredIndicatorBounds(bounds, getDisplayMatching(bounds).workArea, size);
  }

  function positionWindow(target: WindowsCuaOperationIndicatorWindow): void {
    const { width, height } = indicatorWindowSize(options.getLocale());
    const anchored = anchoredBounds({ width, height });
    if (anchored) {
      target.setBounds(anchored);
      return;
    }
    const point = getCursorScreenPoint();
    const { workArea } = getDisplayNearestPoint(point);
    target.setBounds({
      width,
      height,
      x: Math.round(workArea.x + (workArea.width - width) / 2),
      y: Math.round(workArea.y + INDICATOR_CARD_TOP_OFFSET - INDICATOR_SHADOW_INSET.top),
    });
  }

  function handleLoadFailure(target: WindowsCuaOperationIndicatorWindow, error: unknown): void {
    options.logger.warn("[cua-operation-indicator] failed to load window content", error);
    if (disposed || target !== window) return;
    discardFailedWindow(target);
    scheduleSetupRetry();
  }

  function showWindowOnTop(target: WindowsCuaOperationIndicatorWindow): void {
    target.showInactive();
    // Windows 隐藏透明窗口后可能清除 WS_EX_TOPMOST；showInactive 只恢复可见性，
    // 不会恢复原生 Z-order，因此每次显示后都必须重新声明层级并移到该层级最前方。
    target.setAlwaysOnTop(true, "screen-saver");
    target.moveTop();
  }

  function loadContent(target: WindowsCuaOperationIndicatorWindow): void {
    try {
      positionWindow(target);
      void target
        .loadFile(writeIndicatorPage(resolvePageDirectory(), options.getLocale()))
        .then(() => {
          if (disposed || target !== window || target.isDestroyed()) return;
          windowReady = true;
          setupRetryAvailable = false;
          if (!hasActiveTurns()) {
            // refreshContent 可能发生在窗口已经隐藏之后；HTML 默认是 active，必须在
            // 无活跃 turn 时显式恢复离场状态，避免后续错误 show() 暴露假提示。
            setDocumentState("leaving");
            return;
          }
          positionWindow(target);
          showWindowOnTop(target);
          windowShown = true;
          setDocumentState("active");
          // 页面重载（语言切换、窗口重建）会丢掉视频流；Windows 目标仍在时重新取流。
          startPreviewVideo();
        })
        .catch((error) => handleLoadFailure(target, error));
    } catch (error) {
      handleLoadFailure(target, error);
    }
  }

  function ensureWindow(repositionExisting = false): void {
    if (disposed || !supportsComputerUsePreview(platform) || !hasActiveTurns()) return;
    cancelPendingHide();
    if (window && !window.isDestroyed()) {
      if (repositionExisting) positionWindow(window);
      setDocumentState("active");
      // 根因：退场只隐藏而不销毁窗口；后续 turn 复用时必须重新显示已加载的窗口。
      if (windowReady && !windowShown) {
        showWindowOnTop(window);
        windowShown = true;
      }
      if (windowReady) setupRetryAvailable = false;
      return;
    }

    let created: WindowsCuaOperationIndicatorWindow | null = null;
    try {
      const { width, height } = indicatorWindowSize(options.getLocale());
      created = createWindow({
        width,
        height,
        alwaysOnTop: true,
        focusable: false,
        frame: false,
        // 旧窗口只给 CSS shadow 留 1px 透明边，并叠加默认 DWM 矩形阴影，
        // 导致圆角阴影被裁成硬边和灰带；扩大透明画布后由 CSS 独占阴影。
        hasShadow: false,
        resizable: false,
        show: false,
        skipTaskbar: true,
        transparent: true,
        backgroundColor: "#00000000",
        autoHideMenuBar: true,
        fullscreenable: false,
        maximizable: false,
        minimizable: false,
        movable: false,
        webPreferences: {
          contextIsolation: true,
          devTools: false,
          nodeIntegration: false,
          partition: PREVIEW_PARTITION,
          sandbox: true,
        },
      });
      window = created;
      windowReady = false;
      windowShown = false;
      ownedWindows.add(created);
      created.setIgnoreMouseEvents(true);
      created.setContentProtection(true);
      created.webContents.session.setDisplayMediaRequestHandler((_request, callback) => {
        // 只交出宿主已解析的目标窗口；没有目标时拒绝，页面不会得到任何屏幕内容。
        if (pendingDisplaySource) callback({ video: pendingDisplaySource });
        else callback({});
      });
      created.on("closed", () => {
        const failedDuringSetup = failedWindows.delete(created as object);
        if (window === created) {
          window = null;
          windowReady = false;
          windowShown = false;
        }
        if (failedDuringSetup || disposed || !hasActiveTurns() || reconcileTimer) return;
        // 原因：系统意外关闭窗口时 Host 的 turn 仍然活跃，必须主动重建，不能等下一条状态。
        setupRetryAvailable = true;
        reconcileTimer = schedule(() => {
          reconcileTimer = null;
          ensureWindow();
        }, 0);
      });
      loadContent(created);
    } catch (error) {
      options.logger.warn("[cua-operation-indicator] failed to create secure window", error);
      if (created) discardFailedWindow(created);
      scheduleSetupRetry();
    }
  }

  function hideOrDestroy(target: WindowsCuaOperationIndicatorWindow): void {
    try {
      target.hide();
      windowShown = false;
      return;
    } catch (error) {
      // 关闭是这个浮层的安全底线：它在声称"ZCode 正在操作电脑"，隐藏失败就等于向用户
      // 撒谎。hide() 抛错时降级为销毁窗口——下一个 CUA cell 会由 ensureWindow 重建。
      options.logger.warn("[cua-operation-indicator] hide failed, destroying window", error);
    }
    if (window === target) {
      window = null;
      windowReady = false;
    }
    windowShown = false;
    try {
      if (!target.isDestroyed()) target.destroy();
    } catch (destroyError) {
      options.logger.warn(
        "[cua-operation-indicator] destroy after failed hide failed",
        destroyError,
      );
    }
  }

  function beginHide(): void {
    setupRetryAvailable = false;
    capture.setTarget(undefined);
    anchorSource = undefined;
    detachAnchor();
    if (!window || window.isDestroyed() || hideTimer) return;
    setDocumentState("leaving");
    const target = window;
    hideTimer = schedule(() => {
      hideTimer = null;
      if (!disposed && !hasActiveTurns() && target === window && !target.isDestroyed()) {
        hideOrDestroy(target);
      }
    }, HIDE_ANIMATION_MS);
  }

  function handleState(source: object, event: HostCuaOperationStateResponse): void {
    if (disposed || !supportsComputerUsePreview(platform)) return;
    const key = keyFor(event);
    const sourceKeys = activeTurnKeysBySource.get(source);
    if (event.active) {
      latestTargetByKey.set(key, event.computerUseTarget);
      lastActivatedKey = key;
      if (sourceKeys?.has(key)) {
        cancelPendingHide();
        scheduleAutoHide(source, key);
        ensureWindow();
        syncCaptureTarget();
        return;
      }
      const wasActive = hasActiveTurns();
      if (!wasActive) setupRetryAvailable = true;
      const nextKeys = sourceKeys ?? new Set<string>();
      nextKeys.add(key);
      activeTurnKeysBySource.set(source, nextKeys);
      scheduleAutoHide(source, key);
      // 最近发起电脑控制的对话窗作为锚点；并行 source 只在锚点变化时重定位。
      const previousAnchor = attachedAnchor;
      anchorSource = source;
      syncAnchor();
      ensureWindow(!wasActive || attachedAnchor !== previousAnchor);
      syncCaptureTarget();
      return;
    }
    if (!sourceKeys?.delete(key)) return;
    latestTargetByKey.delete(key);
    cancelAutoHide(source, key);
    if (sourceKeys.size === 0) activeTurnKeysBySource.delete(source);
    if (!hasActiveTurns()) beginHide();
    else {
      syncAnchorAndPosition();
      syncCaptureTarget();
    }
  }

  function syncAnchorAndPosition(): void {
    const previousAnchor = attachedAnchor;
    syncAnchor();
    if (attachedAnchor !== previousAnchor) repositionToAnchor();
  }

  function clearSource(source: object): void {
    const sourceKeys = activeTurnKeysBySource.get(source);
    if (disposed || !supportsComputerUsePreview(platform) || !sourceKeys) return;
    activeTurnKeysBySource.delete(source);
    for (const key of sourceKeys) latestTargetByKey.delete(key);
    const timers = autoHideTimersBySource.get(source);
    for (const key of timers ? [...timers.keys()] : []) {
      cancelAutoHide(source, key);
    }
    if (!hasActiveTurns()) beginHide();
    else {
      syncAnchorAndPosition();
      syncCaptureTarget();
    }
  }

  function refreshContent(): void {
    if (disposed || !supportsComputerUsePreview(platform) || !window || window.isDestroyed()) return;
    if (hasActiveTurns()) setupRetryAvailable = true;
    loadContent(window);
  }

  function ownsWindow(candidate: object): boolean {
    return ownedWindows.has(candidate);
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    setupRetryAvailable = false;
    capture.stop();
    detachAnchor();
    pendingDisplaySource = undefined;
    latestTargetByKey.clear();
    activeTurnKeysBySource.clear();
    for (const [source, timers] of autoHideTimersBySource) {
      for (const timer of timers.values()) cancelSchedule(timer);
      autoHideTimersBySource.delete(source);
    }
    cancelPendingHide();
    if (reconcileTimer) {
      cancelSchedule(reconcileTimer);
      reconcileTimer = null;
    }
    const target = window;
    window = null;
    windowReady = false;
    windowShown = false;
    if (target && !target.isDestroyed()) target.destroy();
  }

  return { handleState, clearSource, ownsWindow, refreshContent, dispose };
}
