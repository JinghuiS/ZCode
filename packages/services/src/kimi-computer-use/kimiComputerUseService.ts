import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createServiceLogger } from "#src/logger/serviceLogger.js";
import type {
  IKimiComputerUseService,
  KimiComputerUsePermissions,
  KimiComputerUseStatus,
} from "./kimiComputerUse.js";

const execFileAsync = promisify(execFile);
const log = createServiceLogger("kimi-computer-use");

export const KIMI_COMPUTER_USE_INSTALL_COMMAND =
  "curl -fsSL https://cdn.kimi.com/kimi-computer-use/latest/setup_macos.sh | bash";
const XPC_PING_TIMEOUT_MS = 8_000;
const VERSION_READ_TIMEOUT_MS = 3_000;

function resolveAppRoot(): string | undefined {
  const candidates = ["/Applications/KimiCU.app", join(homedir(), "Applications", "KimiCU.app")];
  return candidates.find((root) => existsSync(join(root, "Contents", "MacOS", "kimi-cu")));
}

function binaryPath(appRoot: string): string {
  return join(appRoot, "Contents", "MacOS", "kimi-cu");
}

async function readVersion(appRoot: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(
      "/usr/bin/plutil",
      [
        "-extract",
        "CFBundleShortVersionString",
        "raw",
        "-o",
        "-",
        join(appRoot, "Contents", "Info.plist"),
      ],
      { timeout: VERSION_READ_TIMEOUT_MS },
    );
    return stdout.trim() || undefined;
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

async function readPermissions(appRoot: string): Promise<KimiComputerUsePermissions | null> {
  // 权限由 KimiCU 的 launchd 服务持有；xpc-ping 询问服务本身，不能用调用方进程的 TCC 状态判断。
  try {
    const { stdout } = await execFileAsync(binaryPath(appRoot), ["xpc-ping"], {
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

export function createKimiComputerUseService(
  options: { platform?: NodeJS.Platform } = {},
): IKimiComputerUseService {
  const platform = options.platform ?? process.platform;

  return {
    async getStatus(): Promise<KimiComputerUseStatus> {
      if (platform !== "darwin") return { supported: false };
      const appRoot = resolveAppRoot();
      if (!appRoot) return { supported: true, installed: false };
      const [version, permissions] = await Promise.all([
        readVersion(appRoot),
        readPermissions(appRoot),
      ]);
      return {
        supported: true,
        installed: true,
        ...(version ? { version } : {}),
        permissions,
      };
    },

    async openInstaller(): Promise<void> {
      if (platform !== "darwin") throw new Error("Kimi Computer Use 目前仅支持 macOS");
      // 官方脚本在 /Applications 不可写时会请求 sudo 密码，必须在用户可见、可输入的终端中运行。
      const script = [
        'tell application "Terminal"',
        "  activate",
        `  do script "${KIMI_COMPUTER_USE_INSTALL_COMMAND}"`,
        "end tell",
      ].join("\n");
      await execFileAsync("/usr/bin/osascript", ["-e", script]);
    },

    async requestPermissions(): Promise<void> {
      if (platform !== "darwin") throw new Error("Kimi Computer Use 目前仅支持 macOS");
      const appRoot = resolveAppRoot();
      if (!appRoot) throw new Error("KimiCU.app 未安装");
      // 授权弹窗等待用户操作，不阻塞 RPC；结果由设置页刷新 getStatus 读取。
      const child = spawn(binaryPath(appRoot), ["request-permissions", "--ax", "--screen"], {
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
