import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import {
  createKimiComputerUseService,
  parseKimiXpcPingOutput,
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
  assert.deepEqual(await service.getStatus(), { supported: false });
  await assert.rejects(service.openInstaller());
  await assert.rejects(service.requestPermissions());
});
