import assert from "node:assert/strict";
import test from "node:test";
import {
  createKimiComputerUseService,
  parseKimiXpcPingOutput,
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

test("非 macOS 平台报告不支持且拒绝安装", async () => {
  const service = createKimiComputerUseService({ platform: "linux" });
  assert.deepEqual(await service.getStatus(), { supported: false });
  await assert.rejects(service.openInstaller());
  await assert.rejects(service.requestPermissions());
});
