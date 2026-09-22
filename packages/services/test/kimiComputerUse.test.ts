import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import {
  createKimiComputerUseService,
  isKimiSupportedDarwinRelease,
  KIMI_COMPUTER_USE_MACOS_INSTALL_COMMAND,
  parseKimiXpcPingOutput,
  readMachOArchitectures,
  resolveKimiComputerUseExecutable,
} from "../src/kimi-computer-use/kimiComputerUseService.js";

test("parseKimiXpcPingOutput 解析 KimiCU 服务上报的权限", () => {
  assert.deepEqual(
    parseKimiXpcPingOutput("permissionStatus: accessibility=true screenRecording=false\n"),
    { accessibility: true, screenRecording: false },
  );
});

test("parseKimiXpcPingOutput 无法识别的输出返回 null", () => {
  assert.equal(parseKimiXpcPingOutput("xpc connection invalid"), null);
});

test("Windows 按环境变量覆盖、LOCALAPPDATA、ProgramFiles 顺序探测 kimi-cu.exe", () => {
  const localAppData = join("C:", "Users", "me", "AppData", "Local");
  const programFiles = join("C:", "Program Files");
  const env = { LOCALAPPDATA: localAppData, ProgramFiles: programFiles };
  const localExe = join(localAppData, "KimiCU", "kimi-cu.exe");
  const programExe = join(programFiles, "KimiCU", "kimi-cu.exe");

  assert.equal(
    resolveKimiComputerUseExecutable("win32", env, (path) => path === programExe),
    programExe,
  );
  assert.equal(
    resolveKimiComputerUseExecutable(
      "win32",
      env,
      (path) => path === programExe || path === localExe,
    ),
    localExe,
  );
  assert.equal(
    resolveKimiComputerUseExecutable(
      "win32",
      { ...env, KIMI_CU_WINDOWS_EXE: "D:\\tools\\kimi-cu.exe" },
      () => true,
    ),
    "D:\\tools\\kimi-cu.exe",
  );
  assert.equal(
    resolveKimiComputerUseExecutable("win32", env, () => false),
    undefined,
  );
});

test("Windows 未安装时报告 installed=false 且无需授权", async () => {
  const service = createKimiComputerUseService({
    platform: "win32",
    env: { LOCALAPPDATA: join("Z:", "__kimi_missing__") },
  });
  assert.deepEqual(await service.getStatus(), {
    supported: true,
    platform: "windows",
    installed: false,
  });
  await assert.rejects(service.requestPermissions());
});

test("Linux 报告不支持且拒绝安装", async () => {
  const service = createKimiComputerUseService({ platform: "linux" });
  assert.deepEqual(await service.getStatus(), { supported: false, reason: "platform" });
  await assert.rejects(service.openInstaller());
  await assert.rejects(service.requestPermissions());
});

function thinMachO(cpuType: number): Buffer {
  const header = Buffer.alloc(32);
  header.writeUInt32LE(0xfeedfacf, 0);
  header.writeUInt32LE(cpuType, 4);
  return header;
}

test("readMachOArchitectures 识别单架构与 universal 可执行文件", () => {
  assert.deepEqual(readMachOArchitectures(thinMachO(0x0100000c)), ["arm64"]);
  assert.deepEqual(readMachOArchitectures(thinMachO(0x01000007)), ["x86_64"]);
  const fat = Buffer.alloc(8 + 2 * 20);
  fat.writeUInt32BE(0xcafebabe, 0);
  fat.writeUInt32BE(2, 4);
  fat.writeUInt32BE(0x01000007, 8);
  fat.writeUInt32BE(0x0100000c, 28);
  assert.deepEqual(readMachOArchitectures(fat), ["x86_64", "arm64"]);
  assert.deepEqual(readMachOArchitectures(Buffer.from("#!/bin/sh\n")), []);
});

test("KimiCU 要求 macOS 14（Darwin 23）及以上", async () => {
  assert.equal(isKimiSupportedDarwinRelease("23.0.0"), true);
  assert.equal(isKimiSupportedDarwinRelease("27.0.0"), true);
  assert.equal(isKimiSupportedDarwinRelease("22.6.0"), false);
  const service = createKimiComputerUseService({ platform: "darwin", darwinRelease: "22.6.0" });
  assert.deepEqual(await service.getStatus(), { supported: false, reason: "macos-version" });
});

test("macOS 安装命令在 Intel 上改下 x86_64 包，其余沿用官方脚本", () => {
  assert.match(KIMI_COMPUTER_USE_MACOS_INSTALL_COMMAND, /setup_macos\.sh \| \{ if \[/);
  assert.match(KIMI_COMPUTER_USE_MACOS_INSTALL_COMMAND, /sysctl -n hw\.optional\.arm64/);
  assert.ok(
    KIMI_COMPUTER_USE_MACOS_INSTALL_COMMAND.includes(
      "sed 's#\\$VERSION/KimiCU\\.app\\.zip#$VERSION/KimiCU-x86_64.app.zip#'",
    ),
  );
  assert.ok(KIMI_COMPUTER_USE_MACOS_INSTALL_COMMAND.endsWith("| bash"));
});
