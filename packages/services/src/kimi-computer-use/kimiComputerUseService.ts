import { execFile, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { createServiceLogger } from "#src/logger/serviceLogger.js";
import type {
  IKimiComputerUseService,
  KimiComputerUsePermissions,
  KimiComputerUsePlatform,
  KimiComputerUseStatus,
} from "./kimiComputerUse.js";

const execFileAsync = promisify(execFile);
const log = createServiceLogger("kimi-computer-use");

export const KIMI_COMPUTER_USE_MACOS_INSTALL_COMMAND =
  "curl -fsSL https://cdn.kimi.com/kimi-computer-use/latest/setup_macos.sh | bash";
const KIMI_COMPUTER_USE_WINDOWS_SETUP_URL =
  "https://cdn.kimi.com/kimi-computer-use-windows/latest/setup_windows.ps1";
const XPC_PING_TIMEOUT_MS = 8_000;
const VERSION_READ_TIMEOUT_MS = 3_000;

type Env = Readonly<Record<string, string | undefined>>;

function toKimiPlatform(platform: NodeJS.Platform): KimiComputerUsePlatform | undefined {
  if (platform === "darwin") return "macos";
  if (platform === "win32") return "windows";
  return undefined;
}

/** 与插件启动器 dist/mcp/server.js 的探测顺序保持一致。 */
export function resolveKimiComputerUseExecutable(
  platform: NodeJS.Platform,
  env: Env = process.env,
  exists: (path: string) => boolean = existsSync,
): string | undefined {
  if (platform === "darwin") {
    return [
      "/Applications/KimiCU.app/Contents/MacOS/kimi-cu",
      join(homedir(), "Applications", "KimiCU.app", "Contents", "MacOS", "kimi-cu"),
    ].find((candidate) => exists(candidate));
  }
  if (platform === "win32") {
    const candidates = [
      env.KIMI_CU_WINDOWS_EXE,
      env.KIMI_CU_WINDOWS_HOME ? join(env.KIMI_CU_WINDOWS_HOME, "kimi-cu.exe") : undefined,
      env.LOCALAPPDATA ? join(env.LOCALAPPDATA, "KimiCU", "kimi-cu.exe") : undefined,
      env.ProgramFiles ? join(env.ProgramFiles, "KimiCU", "kimi-cu.exe") : undefined,
    ];
    return candidates.find(
      (candidate): candidate is string => Boolean(candidate?.trim()) && exists(candidate!),
    );
  }
  return undefined;
}

async function readMacVersion(executable: string): Promise<string | undefined> {
  // executable = <app>/Contents/MacOS/kimi-cu
  const infoPlist = join(dirname(dirname(executable)), "Info.plist");
  try {
    const { stdout } = await execFileAsync(
      "/usr/bin/plutil",
      ["-extract", "CFBundleShortVersionString", "raw", "-o", "-", infoPlist],
      { timeout: VERSION_READ_TIMEOUT_MS },
    );
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

function readWindowsVersion(executable: string): string | undefined {
  // 官方安装脚本在安装目录留下 version.json；读取失败时省略版本，不影响可用性判断。
  try {
    const manifest = JSON.parse(readFileSync(join(dirname(executable), "version.json"), "utf8"));
    return typeof manifest?.version === "string" && manifest.version.trim()
      ? manifest.version.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

/** `permissionStatus: accessibility=true screenRecording=true` */
export function parseKimiXpcPingOutput(output: string): KimiComputerUsePermissions | null {
  const match = /accessibility=(true|false)\s+screenRecording=(true|false)/.exec(output);
  if (!match) return null;
  return { accessibility: match[1] === "true", screenRecording: match[2] === "true" };
}

async function readMacPermissions(executable: string): Promise<KimiComputerUsePermissions | null> {
  // 权限由 KimiCU 的 launchd 服务持有；xpc-ping 询问服务本身，不能用调用方进程的 TCC 状态判断。
  try {
    const { stdout } = await execFileAsync(executable, ["xpc-ping"], {
      timeout: XPC_PING_TIMEOUT_MS,
    });
    return parseKimiXpcPingOutput(stdout);
  } catch (error) {
    log.warn(undefined, "kimi-cu xpc-ping failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** Windows：新开 PowerShell 窗口执行官方安装脚本（脚本自带 SHA-256 与签名校验）。 */
function buildWindowsInstallerCommand(): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    `$setup = Invoke-RestMethod -Uri '${KIMI_COMPUTER_USE_WINDOWS_SETUP_URL}'`,
    "& ([scriptblock]::Create($setup))",
  ].join("; ");
}

export function createKimiComputerUseService(
  options: { platform?: NodeJS.Platform; env?: Env } = {},
): IKimiComputerUseService {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const kimiPlatform = toKimiPlatform(platform);

  return {
    async getStatus(): Promise<KimiComputerUseStatus> {
      if (!kimiPlatform) return { supported: false };
      const executable = resolveKimiComputerUseExecutable(platform, env);
      if (!executable) return { supported: true, platform: kimiPlatform, installed: false };
      if (kimiPlatform === "windows") {
        const version = readWindowsVersion(executable);
        return {
          supported: true,
          platform: kimiPlatform,
          installed: true,
          ...(version ? { version } : {}),
          permissions: null,
        };
      }
      const [version, permissions] = await Promise.all([
        readMacVersion(executable),
        readMacPermissions(executable),
      ]);
      return {
        supported: true,
        platform: kimiPlatform,
        installed: true,
        ...(version ? { version } : {}),
        permissions,
      };
    },

    async openInstaller(): Promise<void> {
      if (kimiPlatform === "macos") {
        // 官方脚本在 /Applications 不可写时会请求 sudo 密码，必须在用户可见、可输入的终端中运行。
        const script = [
          'tell application "Terminal"',
          "  activate",
          `  do script "${KIMI_COMPUTER_USE_MACOS_INSTALL_COMMAND}"`,
          "end tell",
        ].join("\n");
        await execFileAsync("/usr/bin/osascript", ["-e", script]);
        return;
      }
      if (kimiPlatform === "windows") {
        // detached 在 Windows 上会为子进程分配独立控制台窗口，用户可看到安装进度；-NoExit 保留结果。
        const child = spawn(
          "powershell.exe",
          [
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-NoExit",
            "-Command",
            buildWindowsInstallerCommand(),
          ],
          { detached: true, stdio: "ignore", windowsHide: false },
        );
        await new Promise<void>((resolve, reject) => {
          child.once("spawn", () => resolve());
          child.once("error", reject);
        });
        child.unref();
        return;
      }
      throw new Error("Kimi Computer Use 目前仅支持 macOS 与 Windows x64");
    },

    async requestPermissions(): Promise<void> {
      if (kimiPlatform !== "macos") throw new Error("仅 macOS 需要为 KimiCU 授权");
      const executable = resolveKimiComputerUseExecutable(platform, env);
      if (!executable) throw new Error("KimiCU.app 未安装");
      // 授权弹窗等待用户操作，不阻塞 RPC；结果由设置页刷新 getStatus 读取。
      const child = spawn(executable, ["request-permissions", "--ax", "--screen"], {
        detached: true,
        stdio: "ignore",
      });
      child.on("error", (error) => {
        log.warn(undefined, "kimi-cu request-permissions failed", { error: error.message });
      });
      child.unref();
    },
  };
}
