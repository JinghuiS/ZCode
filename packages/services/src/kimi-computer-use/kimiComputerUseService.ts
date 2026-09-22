import { execFile, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { open } from "node:fs/promises";
import { homedir, release } from "node:os";
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

const KIMI_COMPUTER_USE_MACOS_SETUP_URL =
  "https://cdn.kimi.com/kimi-computer-use/latest/setup_macos.sh";

/**
 * 官方 setup_macos.sh 固定下载 arm64 单架构的 KimiCU.app.zip，Intel Mac 装上后无法启动。
 * CDN 另有 Moonshot 签名并公证的 KimiCU-x86_64.app.zip：Intel Mac 上只把脚本里的下载地址
 * 换成它，停旧进程、安装、注册服务、申请权限等步骤仍沿用官方脚本。
 * hw.optional.arm64 在 Apple Silicon 上恒为 1（Rosetta 下也是），Intel 上为 0 或不存在。
 */
export const KIMI_COMPUTER_USE_MACOS_INSTALL_COMMAND = [
  `curl -fsSL ${KIMI_COMPUTER_USE_MACOS_SETUP_URL}`,
  `{ if [ "$(sysctl -n hw.optional.arm64 2>/dev/null)" = "1" ]; then cat;` +
    ` else sed 's#\\$VERSION/KimiCU\\.app\\.zip#$VERSION/KimiCU-x86_64.app.zip#'; fi; }`,
  "bash",
].join(" | ");
const KIMI_COMPUTER_USE_WINDOWS_SETUP_URL =
  "https://cdn.kimi.com/kimi-computer-use-windows/latest/setup_windows.ps1";
const XPC_PING_TIMEOUT_MS = 8_000;
const VERSION_READ_TIMEOUT_MS = 3_000;
/** KimiCU.app 的 LSMinimumSystemVersion 为 14.0，对应 Darwin 23。 */
const KIMI_MIN_DARWIN_MAJOR = 23;

export type MacCpuArch = "arm64" | "x86_64";

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

const MACHO_CPU_ARCH: Record<number, MacCpuArch> = {
  0x0100000c: "arm64",
  0x01000007: "x86_64",
};

/** 从 Mach-O 头读取可执行文件包含的 CPU 架构；不依赖需要 Xcode 命令行工具的 lipo。 */
export function readMachOArchitectures(header: Buffer): MacCpuArch[] {
  if (header.length < 8) return [];
  const fatMagic = header.readUInt32BE(0);
  if (fatMagic === 0xcafebabe || fatMagic === 0xcafebabf) {
    // fat_arch 20 字节，fat_arch_64 32 字节；cputype 都在条目开头，大端。
    const entrySize = fatMagic === 0xcafebabf ? 32 : 20;
    const archs: MacCpuArch[] = [];
    for (let index = 0; index < header.readUInt32BE(4); index += 1) {
      const offset = 8 + index * entrySize;
      if (offset + 4 > header.length) break;
      const arch = MACHO_CPU_ARCH[header.readUInt32BE(offset)];
      if (arch) archs.push(arch);
    }
    return archs;
  }
  if (header.readUInt32LE(0) === 0xfeedfacf) {
    const arch = MACHO_CPU_ARCH[header.readUInt32LE(4)];
    return arch ? [arch] : [];
  }
  return [];
}

async function readExecutableArchitectures(executable: string): Promise<MacCpuArch[]> {
  try {
    const handle = await open(executable, "r");
    try {
      const { buffer, bytesRead } = await handle.read(Buffer.alloc(512), 0, 512, 0);
      return readMachOArchitectures(buffer.subarray(0, bytesRead));
    } finally {
      await handle.close();
    }
  } catch {
    return [];
  }
}

/** 本机 CPU 架构；ZCode 自身可能以 x64 跑在 Rosetta 下，因此不能只看 process.arch。 */
async function readMacMachineArch(): Promise<MacCpuArch> {
  if (process.arch === "arm64") return "arm64";
  try {
    const { stdout } = await execFileAsync("/usr/sbin/sysctl", ["-n", "hw.optional.arm64"], {
      timeout: VERSION_READ_TIMEOUT_MS,
    });
    return stdout.trim() === "1" ? "arm64" : "x86_64";
  } catch {
    // Intel Mac 上没有该 oid，sysctl 以非零退出。
    return "x86_64";
  }
}

export function isKimiSupportedDarwinRelease(darwinRelease: string): boolean {
  const major = Number.parseInt(darwinRelease, 10);
  return Number.isFinite(major) && major >= KIMI_MIN_DARWIN_MAJOR;
}

/** 放进 AppleScript 字符串字面量：转义反斜杠与双引号。 */
function toAppleScriptString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
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
  options: {
    platform?: NodeJS.Platform;
    env?: Env;
    darwinRelease?: string;
    machineArch?: () => Promise<MacCpuArch>;
  } = {},
): IKimiComputerUseService {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const kimiPlatform = toKimiPlatform(platform);
  const machineArch = options.machineArch ?? readMacMachineArch;

  return {
    async getStatus(): Promise<KimiComputerUseStatus> {
      if (!kimiPlatform) return { supported: false, reason: "platform" };
      if (
        kimiPlatform === "macos" &&
        !isKimiSupportedDarwinRelease(options.darwinRelease ?? release())
      ) {
        return { supported: false, reason: "macos-version" };
      }
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
      const [version, binaryArchs, hostArch] = await Promise.all([
        readMacVersion(executable),
        readExecutableArchitectures(executable),
        machineArch(),
      ]);
      // 架构不符的二进制根本启动不了，xpc-ping 只会超时；直接报告需要重装对应架构的版本。
      if (binaryArchs.length > 0 && !binaryArchs.includes(hostArch)) {
        return {
          supported: true,
          platform: kimiPlatform,
          installed: true,
          ...(version ? { version } : {}),
          permissions: null,
          archMismatch: true,
        };
      }
      const permissions = await readMacPermissions(executable);
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
          `  do script ${toAppleScriptString(KIMI_COMPUTER_USE_MACOS_INSTALL_COMMAND)}`,
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
