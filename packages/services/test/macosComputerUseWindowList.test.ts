import assert from "node:assert/strict";
import test from "node:test";
import {
  parseMacosWindowListOutput,
  pickMacosCaptureWindow,
} from "../../desktop/src/main/macosComputerUseWindowList.ts";

test("解析 pid 窗口列表并优先精确 windowId", () => {
  const windows = parseMacosWindowListOutput(
    JSON.stringify([
      { windowId: 1, pid: 785, x: 0, y: 0, w: 100, h: 100, layer: 0, name: "small", owner: "访达" },
      { windowId: 2, pid: 785, x: 0, y: 0, w: 800, h: 600, layer: 0, name: "large", owner: "访达" },
      { windowId: 3, pid: 785, x: 0, y: 0, w: 50, h: 50, layer: 1, name: "menu", owner: "访达" },
    ]),
  );
  assert.equal(windows.length, 2);
  assert.equal(pickMacosCaptureWindow(windows)?.windowId, 2);
  assert.equal(pickMacosCaptureWindow(windows, 1)?.windowId, 1);
});

test("损坏输出返回空列表", () => {
  assert.deepEqual(parseMacosWindowListOutput("not-json"), []);
});
