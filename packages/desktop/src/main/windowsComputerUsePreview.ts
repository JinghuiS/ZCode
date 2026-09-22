import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ComputerUseTarget } from "@zcode/shared";

/**
 * Windows 电脑控制预览：把 KimiCU 的 pid / app / window_id 解析成 HWND。
 * 取流交给 Chromium 的 getDisplayMedia（底层 Windows.Graphics.Capture），
 * source id 形如 `window:<HWND>:0`。
 */

const execFileAsync = promisify(execFile);
const RESOLVE_TIMEOUT_MS = 8_000;

// 参数经环境变量传入，脚本本身是常量，避免把模型提供的 app 名拼进命令行。
// 注意 $PID 是 PowerShell 自动变量，这里用 $targetPid。
const RESOLVE_SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  "$targetPid = [int]$env:ZCODE_CUA_PREVIEW_PID",
  "$app = $env:ZCODE_CUA_PREVIEW_APP",
  "$procs = @()",
  "if ($targetPid -gt 0) { $procs = @(Get-Process -Id $targetPid) }",
  "elseif ($app) {",
  "  $name = [IO.Path]::GetFileNameWithoutExtension($app)",
  "  $procs = @(Get-Process -Name $name)",
  "  if ($procs.Count -eq 0) { $procs = @(Get-Process | Where-Object { $_.MainWindowTitle -eq $app -or $_.Description -eq $app }) }",
  "}",
  "$hit = $procs | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1",
  "if ($hit) { @{ pid = $hit.Id; hwnd = [int64]$hit.MainWindowHandle } | ConvertTo-Json -Compress } else { '{}' }",
].join("\n");

export interface WindowsPreviewWindow {
  pid: number;
  hwnd: number;
}

export function parseWindowsPreviewResolveOutput(stdout: string): WindowsPreviewWindow | undefined {
  try {
    const parsed: unknown = JSON.parse(stdout.trim() || "{}");
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const { pid, hwnd } = parsed as Record<string, unknown>;
    if (typeof pid !== "number" || typeof hwnd !== "number" || pid <= 0 || hwnd <= 0) {
      return undefined;
    }
    return { pid, hwnd };
  } catch {
    return undefined;
  }
}

function powershellPath(): string {
  const systemRoot = process.env.SystemRoot || process.env.windir || "C:\\Windows";
  return join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

export async function resolveWindowsPreviewWindow(
  target: ComputerUseTarget,
): Promise<WindowsPreviewWindow | undefined> {
  if (!target.pid && !target.app) return undefined;
  const { stdout } = await execFileAsync(
    powershellPath(),
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", RESOLVE_SCRIPT],
    {
      timeout: RESOLVE_TIMEOUT_MS,
      windowsHide: true,
      env: {
        ...process.env,
        ZCODE_CUA_PREVIEW_PID: target.pid ? String(target.pid) : "",
        ZCODE_CUA_PREVIEW_APP: target.app ?? "",
      },
    },
  );
  return parseWindowsPreviewResolveOutput(stdout);
}

/** 按优先级给出候选 HWND：KimiCU 的 window_id 在 Windows 上可能就是 HWND，先试它。 */
export function windowsPreviewSourcePrefixes(hwnds: readonly number[]): string[] {
  return [...new Set(hwnds.filter((hwnd) => hwnd > 0))].map((hwnd) => `window:${hwnd}:`);
}
