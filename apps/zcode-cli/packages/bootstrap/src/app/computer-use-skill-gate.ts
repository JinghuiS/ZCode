import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SkillRoot } from "@zcode/contracts";
import { ZCODE_CUA_OFFICIAL_PLUGIN_ID } from "@zcode/shared";

/**
 * 电脑控制技能的可用性门：KimiCU 未安装时不向模型列出官方电脑控制技能。
 *
 * 为什么需要：闭源版把 CUA Helper 随包分发，技能出现时工具必然可用；开源版的 KimiCU 由用户自行安装，
 * 未安装时插件启动器只挂一个无工具的空 MCP。技能照常列出会让模型「加载技能 → 发现没有工具 →
 * 跑排障命令或提议安装」，技能描述越积极越频繁。见 specs/computer-use-kimi.md「不可用时不列出技能」。
 *
 * 只判断是否安装（同步 existsSync）：权限要跑 `kimi-cu xpc-ping`（最长 8 秒），不适合放在会话启动路径上；
 * 权限缺失与架构不匹配时技能保留，由正文排障章节引导修复。
 */

/** 官方电脑控制插件里技能的目录名（skills/<dir>/SKILL.md）。 */
const COMPUTER_USE_SKILL_DIRECTORY_NAME = "computer-use";

const SKILL_MANIFEST_FILE_NAME = "SKILL.md";

const KIMI_MACOS_APP_RELATIVE_EXECUTABLE = join("KimiCU.app", "Contents", "MacOS", "kimi-cu");
const KIMI_MACOS_SYSTEM_APPLICATIONS_DIR = "/Applications";
const KIMI_MACOS_USER_APPLICATIONS_DIR_NAME = "Applications";
const KIMI_WINDOWS_INSTALL_DIR_NAME = "KimiCU";
const KIMI_WINDOWS_EXECUTABLE_NAME = "kimi-cu.exe";

type Env = Readonly<Record<string, string | undefined>>;

export interface ComputerUseSkillGateOptions {
  platform?: NodeJS.Platform;
  env?: Env;
  homeDir?: string;
  exists?: (path: string) => boolean;
}

/**
 * KimiCU 可执行文件探测，顺序与插件启动器 computer-use-plugin/dist/mcp/server.js 的
 * resolveKimiComputerUseExecutable 一致（启动器是插件资产，不能 import 进 Agent 进程）。
 */
export function resolveKimiComputerUseExecutable(
  options: ComputerUseSkillGateOptions = {},
): string | undefined {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const exists = options.exists ?? existsSync;
  if (platform === "darwin") {
    const homeDir = options.homeDir ?? homedir();
    return [
      join(KIMI_MACOS_SYSTEM_APPLICATIONS_DIR, KIMI_MACOS_APP_RELATIVE_EXECUTABLE),
      join(homeDir, KIMI_MACOS_USER_APPLICATIONS_DIR_NAME, KIMI_MACOS_APP_RELATIVE_EXECUTABLE),
    ].find((candidate) => exists(candidate));
  }
  if (platform === "win32") {
    const candidates = [
      env.KIMI_CU_WINDOWS_EXE,
      env.KIMI_CU_WINDOWS_HOME
        ? join(env.KIMI_CU_WINDOWS_HOME, KIMI_WINDOWS_EXECUTABLE_NAME)
        : undefined,
      env.LOCALAPPDATA
        ? join(env.LOCALAPPDATA, KIMI_WINDOWS_INSTALL_DIR_NAME, KIMI_WINDOWS_EXECUTABLE_NAME)
        : undefined,
      env.ProgramFiles
        ? join(env.ProgramFiles, KIMI_WINDOWS_INSTALL_DIR_NAME, KIMI_WINDOWS_EXECUTABLE_NAME)
        : undefined,
    ];
    return candidates.find(
      (candidate): candidate is string =>
        candidate !== undefined && candidate.trim().length > 0 && exists(candidate),
    );
  }
  return undefined;
}

/**
 * KimiCU 不可用时要从技能发现中剔除的 SKILL.md 绝对路径；可用时返回空数组。
 *
 * 按插件 id 精确匹配官方电脑控制插件：技能根的 pluginId 由插件 resolver 写入 loaded.id，
 * 第三方插件即使同名也是另一个 marketplace 下的 id，不会被连坐。
 */
export function collectComputerUseUnavailableSkillPaths(
  pluginSkillRoots: readonly SkillRoot[],
  options: ComputerUseSkillGateOptions = {},
): string[] {
  const computerUseRoots = pluginSkillRoots.filter(
    (root) => root.pluginId === ZCODE_CUA_OFFICIAL_PLUGIN_ID,
  );
  if (computerUseRoots.length === 0) return [];
  if (resolveKimiComputerUseExecutable(options)) return [];
  return computerUseRoots.map((root) =>
    join(root.path, COMPUTER_USE_SKILL_DIRECTORY_NAME, SKILL_MANIFEST_FILE_NAME),
  );
}
