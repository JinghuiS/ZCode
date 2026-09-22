import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { ComputerUseTarget } from "@zcode/shared";

/**
 * macOS 电脑控制预览：包装 ScreenCaptureKit 辅助程序（native/macos-cua-preview）。
 * resolve 把 KimiCU 的 pid / app / window_id 解析成 CGWindowID；stream 输出该窗口的 JPEG 帧。
 */

const execFileAsync = promisify(execFile);
const RESOLVE_TIMEOUT_MS = 5_000;
/** 单帧上限；超出说明流已错位，直接终止比继续解析垃圾数据安全。 */
const MAX_FRAME_BYTES = 8 * 1024 * 1024;

export interface MacosPreviewWindow {
  pid: number;
  windowId: number;
  title: string;
  onScreen: boolean;
}

export type MacosPreviewResolveResult =
  | { ok: true; window: MacosPreviewWindow }
  | { ok: false; error: string };

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readPositiveInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

export function parseMacosPreviewResolveOutput(stdout: string): MacosPreviewResolveResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    return { ok: false, error: "invalid_output" };
  }
  const record = asRecord(parsed);
  if (!record) return { ok: false, error: "invalid_output" };
  if (typeof record.error === "string") return { ok: false, error: record.error };
  const pid = readPositiveInt(record.pid);
  const windowId = readPositiveInt(record.windowId);
  if (pid === undefined || windowId === undefined) return { ok: false, error: "invalid_output" };
  return {
    ok: true,
    window: {
      pid,
      windowId,
      title: typeof record.title === "string" ? record.title : "",
      onScreen: record.onScreen === true,
    },
  };
}

export function macosPreviewResolveArgs(target: ComputerUseTarget): string[] {
  const args = ["resolve"];
  if (target.pid) args.push("--pid", String(target.pid));
  if (target.app) args.push("--app", target.app);
  // KimiCU 的 window_id 是 AX 标识，不保证等于 CGWindowID；只作优先匹配的线索。
  if (target.windowId) args.push("--window-id", String(target.windowId));
  return args;
}

export async function resolveMacosPreviewWindow(
  binaryPath: string,
  target: ComputerUseTarget,
): Promise<MacosPreviewResolveResult> {
  const { stdout } = await execFileAsync(binaryPath, macosPreviewResolveArgs(target), {
    timeout: RESOLVE_TIMEOUT_MS,
    maxBuffer: 64 * 1024,
  });
  return parseMacosPreviewResolveOutput(stdout);
}

/** 解析 `4 字节大端长度 + JPEG` 帧流；返回 false 表示流已损坏。 */
export function createPreviewFrameParser(onFrame: (jpeg: Buffer) => void): (chunk: Buffer) => boolean {
  let pending: Buffer = Buffer.alloc(0);
  return (chunk) => {
    pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
    while (pending.length >= 4) {
      const length = pending.readUInt32BE(0);
      if (length === 0 || length > MAX_FRAME_BYTES) return false;
      if (pending.length < 4 + length) break;
      onFrame(pending.subarray(4, 4 + length));
      pending = pending.subarray(4 + length);
    }
    return true;
  };
}

export interface MacosPreviewStream {
  stop(): void;
}

export function startMacosPreviewStream(
  binaryPath: string,
  windowId: number,
  handlers: {
    onFrame: (jpeg: Buffer) => void;
    onExit: (code: number | null) => void;
  },
  options: { fps?: number; maxWidth?: number } = {},
): MacosPreviewStream {
  const child = spawn(
    binaryPath,
    [
      "stream",
      "--window-id",
      String(windowId),
      "--fps",
      String(options.fps ?? 10),
      "--max-width",
      String(options.maxWidth ?? 640),
    ],
    { stdio: ["pipe", "pipe", "ignore"] },
  );
  let stopped = false;
  const parse = createPreviewFrameParser((jpeg) => {
    if (!stopped) handlers.onFrame(jpeg);
  });
  child.stdout.on("data", (chunk: Buffer) => {
    if (!parse(chunk)) child.kill();
  });
  child.on("error", () => {
    if (!stopped) handlers.onExit(null);
    stopped = true;
  });
  child.on("exit", (code) => {
    if (!stopped) handlers.onExit(code);
    stopped = true;
  });
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      // 关闭 stdin 让辅助程序自行收尾；kill 兜底。
      child.stdin.end();
      child.kill();
    },
  };
}
