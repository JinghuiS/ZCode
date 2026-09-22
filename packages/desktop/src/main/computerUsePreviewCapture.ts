import type { DesktopCapturerSource } from "electron";
import type { ComputerUseTarget } from "@zcode/shared";
import {
  resolveMacosPreviewWindow,
  startMacosPreviewStream,
  type MacosPreviewStream,
} from "./macosComputerUsePreview.js";
import {
  resolveWindowsPreviewWindow,
  windowsPreviewSourcePrefixes,
} from "./windowsComputerUsePreview.js";

/**
 * 电脑控制预览的取流协调：目标身份（pid / app / window_id）变化时解析目标窗口，
 * 同一窗口不重复起流；流中断（窗口关闭、重建）时有限次重试。
 *
 * - macOS：ScreenCaptureKit 辅助程序推 JPEG 帧 → sink.showFrame
 * - Windows：解析 HWND → Chromium 窗口 source → sink.showSource，由预览页 getDisplayMedia 取流
 */

const RETRY_DELAY_MS = 1_500;
const MAX_RETRIES = 4;
/** HWND 通常大于 0xFFFF；KimiCU 的 AX window_id 是小整数，不当作 HWND 猜测。 */
const MIN_HWND_CANDIDATE = 0x10000;

export interface ComputerUsePreviewSink {
  showFrame(dataUrl: string): void;
  showSource(source: DesktopCapturerSource): void;
  clear(): void;
}

export interface ComputerUsePreviewCapture {
  setTarget(target: ComputerUseTarget | undefined): void;
  stop(): void;
}

interface CaptureLogger {
  debug(...args: unknown[]): void;
  warn(...args: unknown[]): void;
}

export interface ComputerUsePreviewCaptureDeps {
  resolveMacosWindow: typeof resolveMacosPreviewWindow;
  startMacosStream: typeof startMacosPreviewStream;
  resolveWindowsWindow: typeof resolveWindowsPreviewWindow;
  getWindowSources: () => Promise<DesktopCapturerSource[]>;
}

const defaultDeps: ComputerUsePreviewCaptureDeps = {
  resolveMacosWindow: resolveMacosPreviewWindow,
  startMacosStream: startMacosPreviewStream,
  resolveWindowsWindow: resolveWindowsPreviewWindow,
  // 只为拿 source id：缩略图尺寸 0 让 Chromium 跳过逐窗截图。按需加载 electron，
  // 让取流协调逻辑可以脱离 Electron 运行时单测。
  getWindowSources: async () => {
    const { desktopCapturer } = await import("electron");
    return desktopCapturer.getSources({
      types: ["window"],
      thumbnailSize: { width: 0, height: 0 },
      fetchWindowIcons: false,
    });
  },
};

type ActiveCapture =
  | { kind: "macos"; windowId: number; stream: MacosPreviewStream }
  | { kind: "windows"; sourceId: string };

function targetKeyOf(target: ComputerUseTarget | undefined): string | undefined {
  if (!target || (!target.pid && !target.app && !target.windowId)) return undefined;
  return JSON.stringify([target.pid ?? 0, target.app ?? "", target.windowId ?? 0]);
}

export function createComputerUsePreviewCapture(options: {
  platform?: NodeJS.Platform;
  resolveHelperBinary?: () => string | undefined;
  sink: ComputerUsePreviewSink;
  logger: CaptureLogger;
  schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancelSchedule?: (timer: ReturnType<typeof setTimeout>) => void;
  deps?: Partial<ComputerUsePreviewCaptureDeps>;
}): ComputerUsePreviewCapture {
  const platform = options.platform ?? process.platform;
  const deps = { ...defaultDeps, ...options.deps };
  const schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  const cancelSchedule = options.cancelSchedule ?? ((timer) => clearTimeout(timer));
  const supported = platform === "darwin" || platform === "win32";

  let target: ComputerUseTarget | undefined;
  let targetKey: string | undefined;
  let generation = 0;
  let active: ActiveCapture | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retries = 0;
  let disposed = false;

  function cancelRetry(): void {
    if (!retryTimer) return;
    cancelSchedule(retryTimer);
    retryTimer = null;
  }

  function teardown(): void {
    if (active?.kind === "macos") active.stream.stop();
    active = undefined;
  }

  function fail(gen: number, reason: string): void {
    if (gen !== generation || disposed) return;
    options.logger.debug("[cua-preview-capture] target unavailable", reason);
    teardown();
    options.sink.clear();
    // 目标 app 可能还在启动或窗口正在重建；有限次重试后保持空壳，等下一次目标变化。
    if (retries >= MAX_RETRIES) return;
    retries += 1;
    cancelRetry();
    retryTimer = schedule(() => {
      retryTimer = null;
      if (gen === generation && !disposed) void resolveAndStart(gen);
    }, RETRY_DELAY_MS);
  }

  async function startMacos(gen: number, current: ComputerUseTarget): Promise<void> {
    const binaryPath = options.resolveHelperBinary?.();
    if (!binaryPath) {
      teardown();
      options.sink.clear();
      return;
    }
    const resolved = await deps.resolveMacosWindow(binaryPath, current);
    if (gen !== generation || disposed) return;
    if (!resolved.ok) return fail(gen, resolved.error);
    const { windowId } = resolved.window;
    if (active?.kind === "macos" && active.windowId === windowId) return;
    teardown();
    // 流的归属看"是否仍是当前活跃流"，不看起流时的 generation：目标换成解析到同一窗口的
    // 新身份时流会被保留，按 generation 过滤会把之后的帧全部丢掉。
    const isCurrent = () => !disposed && active?.kind === "macos" && active.stream === stream;
    const stream = deps.startMacosStream(binaryPath, windowId, {
      onFrame: (jpeg) => {
        if (!isCurrent()) return;
        retries = 0;
        options.sink.showFrame(`data:image/jpeg;base64,${jpeg.toString("base64")}`);
      },
      onExit: (code) => {
        if (!isCurrent()) return;
        active = undefined;
        fail(generation, `stream exited with ${code}`);
      },
    });
    active = { kind: "macos", windowId, stream };
  }

  async function startWindows(gen: number, current: ComputerUseTarget): Promise<void> {
    const resolved = await deps.resolveWindowsWindow(current);
    if (gen !== generation || disposed) return;
    const hintedHwnd =
      current.windowId && current.windowId >= MIN_HWND_CANDIDATE ? current.windowId : 0;
    const prefixes = windowsPreviewSourcePrefixes([hintedHwnd, resolved?.hwnd ?? 0]);
    if (prefixes.length === 0) return fail(gen, "window_not_found");
    const sources = await deps.getWindowSources();
    if (gen !== generation || disposed) return;
    const source = prefixes
      .map((prefix) => sources.find((item) => item.id.startsWith(prefix)))
      .find((item): item is DesktopCapturerSource => item !== undefined);
    if (!source) return fail(gen, "source_not_found");
    if (active?.kind === "windows" && active.sourceId === source.id) return;
    teardown();
    active = { kind: "windows", sourceId: source.id };
    retries = 0;
    options.sink.showSource(source);
  }

  async function resolveAndStart(gen: number): Promise<void> {
    const current = target;
    if (!current) return;
    try {
      if (platform === "darwin") await startMacos(gen, current);
      else await startWindows(gen, current);
    } catch (error) {
      fail(gen, error instanceof Error ? error.message : String(error));
    }
  }

  return {
    setTarget(next) {
      if (disposed || !supported) return;
      const key = targetKeyOf(next);
      if (key === targetKey) return;
      targetKey = key;
      target = next;
      retries = 0;
      cancelRetry();
      generation += 1;
      if (!key) {
        teardown();
        options.sink.clear();
        return;
      }
      // 不先清空：新目标解析出同一窗口时（例如先传 app 再传 pid）保持当前流不闪断。
      void resolveAndStart(generation);
    },
    stop() {
      disposed = true;
      generation += 1;
      cancelRetry();
      teardown();
      target = undefined;
      targetKey = undefined;
    },
  };
}
