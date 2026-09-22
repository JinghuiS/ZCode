import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createNodeSkillAdapter } from "@zcode/adapters/skills";
import type { SkillRoot } from "@zcode/contracts";
import { ZCODE_CUA_OFFICIAL_PLUGIN_ID } from "@zcode/shared";
import {
  collectComputerUseUnavailableSkillPaths,
  resolveKimiComputerUseExecutable,
} from "../src/app/computer-use-skill-gate.js";
// 插件启动器是手写 JS 资产；这里只在测试里 import，用来机械对照两份探测规则不漂移。
import { resolveKimiComputerUseExecutable as resolveLauncherExecutable } from "../../computer-use-plugin/dist/mcp/server.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const COMPUTER_USE_SKILL_FILE = join(
  HERE,
  "..",
  "..",
  "computer-use-plugin",
  "skills",
  "computer-use",
  "SKILL.md",
);
/** core/src/context/sections/skills.ts 的 MAX_DESCRIPTION_CHARS。 */
const SKILL_LISTING_DESCRIPTION_LIMIT = 250;
const MACOS_SYSTEM_EXECUTABLE = "/Applications/KimiCU.app/Contents/MacOS/kimi-cu";

function pluginRoot(path: string, pluginId?: string): SkillRoot {
  return {
    path,
    priority: 0,
    scope: "system",
    source: "plugin",
    ...(pluginId ? { pluginId } : {}),
  };
}

const officialRoot = pluginRoot("/plugins/computer-use/skills", ZCODE_CUA_OFFICIAL_PLUGIN_ID);
const thirdPartyRoot = pluginRoot("/plugins/other/skills", "computer-use@someone-else");
const guideRoot = pluginRoot("/plugins/zcode-guide/skills", "zcode-guide@zcode-plugins-official");

test("KimiCU 未安装时只剔除官方电脑控制插件的技能", () => {
  const paths = collectComputerUseUnavailableSkillPaths([officialRoot, thirdPartyRoot, guideRoot], {
    platform: "darwin",
    homeDir: "/Users/tester",
    exists: () => false,
  });
  assert.deepEqual(paths, [join(officialRoot.path, "computer-use", "SKILL.md")]);
});

test("KimiCU 已安装时不剔除任何技能", () => {
  const paths = collectComputerUseUnavailableSkillPaths([officialRoot], {
    platform: "darwin",
    homeDir: "/Users/tester",
    exists: (path) => path === MACOS_SYSTEM_EXECUTABLE,
  });
  assert.deepEqual(paths, []);
});

test("macOS 用户目录下的 KimiCU 也算已安装", () => {
  const userExecutable = join("/Users/tester", "Applications", "KimiCU.app", "Contents", "MacOS", "kimi-cu");
  assert.equal(
    resolveKimiComputerUseExecutable({
      platform: "darwin",
      homeDir: "/Users/tester",
      exists: (path) => path === userExecutable,
    }),
    userExecutable,
  );
});

test("不支持的平台一律剔除官方电脑控制技能", () => {
  const paths = collectComputerUseUnavailableSkillPaths([officialRoot], {
    platform: "linux",
    exists: () => true,
  });
  assert.deepEqual(paths, [join(officialRoot.path, "computer-use", "SKILL.md")]);
});

test("没有启用官方电脑控制插件时不探测 KimiCU", () => {
  let probed = false;
  const paths = collectComputerUseUnavailableSkillPaths([thirdPartyRoot, guideRoot], {
    platform: "darwin",
    exists: () => {
      probed = true;
      return false;
    },
  });
  assert.deepEqual(paths, []);
  assert.equal(probed, false);
});

test("Windows 按环境变量顺序探测，空白路径不算", () => {
  const env = {
    KIMI_CU_WINDOWS_EXE: "  ",
    LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local",
    ProgramFiles: "C:\\Program Files",
  };
  const programFilesExecutable = join("C:\\Program Files", "KimiCU", "kimi-cu.exe");
  assert.equal(
    resolveKimiComputerUseExecutable({
      platform: "win32",
      env,
      exists: (path) => path === programFilesExecutable,
    }),
    programFilesExecutable,
  );
  assert.equal(
    resolveKimiComputerUseExecutable({ platform: "win32", env, exists: () => false }),
    undefined,
  );
});

test("与插件启动器的 Windows 探测结果一致", () => {
  const root = mkdtempSync(join(tmpdir(), "zcode-kimi-gate-"));
  try {
    const localAppData = join(root, "local");
    const programFiles = join(root, "program-files");
    const customHome = join(root, "custom-home");
    const customExe = join(root, "custom", "kimi-cu.exe");
    for (const file of [
      join(localAppData, "KimiCU", "kimi-cu.exe"),
      join(programFiles, "KimiCU", "kimi-cu.exe"),
      join(customHome, "kimi-cu.exe"),
      customExe,
    ]) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, "");
    }
    const envs = [
      {},
      { ProgramFiles: programFiles },
      { LOCALAPPDATA: localAppData, ProgramFiles: programFiles },
      { KIMI_CU_WINDOWS_HOME: customHome, LOCALAPPDATA: localAppData },
      { KIMI_CU_WINDOWS_EXE: customExe, KIMI_CU_WINDOWS_HOME: customHome },
      { KIMI_CU_WINDOWS_EXE: join(root, "missing.exe"), ProgramFiles: programFiles },
      { LOCALAPPDATA: join(root, "empty") },
    ];
    for (const env of envs) {
      assert.equal(
        resolveKimiComputerUseExecutable({ platform: "win32", env }),
        resolveLauncherExecutable("win32", env),
        JSON.stringify(env),
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("与插件启动器在本机 macOS 路径上的探测结果一致", () => {
  assert.equal(
    resolveKimiComputerUseExecutable({ platform: "darwin" }),
    resolveLauncherExecutable("darwin", {}),
  );
});

test("未安装时技能发现结果里没有电脑控制技能，安装后出现", async () => {
  const root = pluginRoot(dirname(dirname(COMPUTER_USE_SKILL_FILE)), ZCODE_CUA_OFFICIAL_PLUGIN_ID);
  const discoverNames = async (installed: boolean) => {
    const adapter = createNodeSkillAdapter({
      extraResolvedRoots: [root],
      disabledPaths: collectComputerUseUnavailableSkillPaths([root], {
        platform: "darwin",
        homeDir: "/Users/tester",
        exists: () => installed,
      }),
    });
    const outcome = await adapter.discoverSkills({ workingDirectory: tmpdir(), roots: [root] });
    return outcome.skills.map((skill) => skill.name);
  };
  assert.equal((await discoverNames(false)).includes("computer-use"), false);
  assert.equal((await discoverNames(true)).includes("computer-use"), true);
});

test("电脑控制技能描述不超过技能列表的截断上限", () => {
  const content = readFileSync(COMPUTER_USE_SKILL_FILE, "utf8");
  const match = /^description:\s*"(.*)"\s*$/mu.exec(content);
  assert.ok(match?.[1], "SKILL.md 缺少单行 description");
  assert.ok(
    match[1].length <= SKILL_LISTING_DESCRIPTION_LIMIT,
    `description 长 ${match[1].length}，超过 ${SKILL_LISTING_DESCRIPTION_LIMIT} 会在技能列表里被截断`,
  );
});
