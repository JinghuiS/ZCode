import assert from "node:assert/strict";
import test from "node:test";
import type { DesktopCapturerSource } from "electron";
import { createComputerUsePreviewCapture } from "../src/main/computerUsePreviewCapture.ts";
import {
  createPreviewFrameParser,
  macosPreviewResolveArgs,
  parseMacosPreviewResolveOutput,
  type MacosPreviewResolveResult,
} from "../src/main/macosComputerUsePreview.ts";
import {
  parseWindowsPreviewResolveOutput,
  windowsPreviewSourcePrefixes,
} from "../src/main/windowsComputerUsePreview.ts";
import {
  anchoredIndicatorBounds,
  INDICATOR_ANCHOR_GAP,
  INDICATOR_SHADOW_INSET,
} from "../src/main/windowsCuaOperationIndicatorContent.ts";

const flush = () => new Promise((resolve) => setImmediate(resolve));
const logger = { debug() {}, warn() {} };

function packet(payload: string): Buffer {
  const body = Buffer.from(payload);
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length, 0);
  return Buffer.concat([header, body]);
}

test("帧流拆包：跨 chunk 拼接与多帧同 chunk", () => {
  const frames: string[] = [];
  const parse = createPreviewFrameParser((jpeg) => frames.push(jpeg.toString()));
  const stream = Buffer.concat([packet("first"), packet("second")]);
  assert.equal(parse(stream.subarray(0, 3)), true);
  assert.equal(parse(stream.subarray(3, 12)), true);
  assert.equal(parse(stream.subarray(12)), true);
  assert.deepEqual(frames, ["first", "second"]);
});

test("帧流拆包：长度越界视为流损坏", () => {
  const parse = createPreviewFrameParser(() => {});
  const header = Buffer.alloc(4);
  header.writeUInt32BE(0xffffffff, 0);
  assert.equal(parse(header), false);
});

test("macOS resolve：参数与输出解析", () => {
  assert.deepEqual(macosPreviewResolveArgs({ app: "Finder", windowId: 3 }), [
    "resolve",
    "--app",
    "Finder",
    "--window-id",
    "3",
  ]);
  assert.deepEqual(parseMacosPreviewResolveOutput('{"error":"app_not_found"}'), {
    ok: false,
    error: "app_not_found",
  });
  assert.deepEqual(
    parseMacosPreviewResolveOutput('{"pid":785,"windowId":4211,"title":"文稿","onScreen":false}\n'),
    { ok: true, window: { pid: 785, windowId: 4211, title: "文稿", onScreen: false } },
  );
  assert.equal(parseMacosPreviewResolveOutput("garbage").ok, false);
});

test("Windows resolve：输出解析与候选 source 前缀", () => {
  assert.deepEqual(parseWindowsPreviewResolveOutput('{"pid":42,"hwnd":198276}'), {
    pid: 42,
    hwnd: 198276,
  });
  assert.equal(parseWindowsPreviewResolveOutput("{}"), undefined);
  assert.deepEqual(windowsPreviewSourcePrefixes([0, 198276, 198276]), ["window:198276:"]);
});

test("锚点定位：优先右侧，其次左侧，都放不下时收进对话窗右上角", () => {
  const size = { width: 336, height: 236 };
  const workArea = { x: 0, y: 25, width: 1512, height: 920 };
  const right = anchoredIndicatorBounds({ x: 100, y: 100, width: 900, height: 700 }, workArea, size);
  assert.equal(right.x + INDICATOR_SHADOW_INSET.left, 100 + 900 + INDICATOR_ANCHOR_GAP);
  assert.equal(right.y, 100 - INDICATOR_SHADOW_INSET.top);

  const left = anchoredIndicatorBounds({ x: 500, y: 100, width: 1000, height: 700 }, workArea, size);
  assert.equal(left.x + size.width - INDICATOR_SHADOW_INSET.right, 500 - INDICATOR_ANCHOR_GAP);

  const inside = anchoredIndicatorBounds(workArea, workArea, size);
  assert.equal(
    inside.x + size.width - INDICATOR_SHADOW_INSET.right,
    workArea.x + workArea.width - INDICATOR_ANCHOR_GAP,
  );
  assert.ok(inside.y > workArea.y);
});

function fakeScheduler() {
  const pending: Array<() => void> = [];
  return {
    schedule: (callback: () => void) => {
      pending.push(callback);
      return pending.length as unknown as ReturnType<typeof setTimeout>;
    },
    cancelSchedule: () => {},
    runAll: () => pending.splice(0).forEach((callback) => callback()),
  };
}

test("macOS 取流：app 与 pid 解析到同一窗口时不重启流；流退出后重新解析", async () => {
  const resolveCalls: unknown[] = [];
  const streams: Array<{ windowId: number; stopped: boolean; onExit: (code: number | null) => void; onFrame: (jpeg: Buffer) => void }> = [];
  const frames: string[] = [];
  let clears = 0;
  const scheduler = fakeScheduler();
  const capture = createComputerUsePreviewCapture({
    platform: "darwin",
    resolveHelperBinary: () => "/helper",
    sink: { showFrame: (url) => frames.push(url), showSource() {}, clear: () => (clears += 1) },
    logger,
    schedule: scheduler.schedule,
    cancelSchedule: scheduler.cancelSchedule,
    deps: {
      resolveMacosWindow: async (_binary, target): Promise<MacosPreviewResolveResult> => {
        resolveCalls.push(target);
        return { ok: true, window: { pid: 785, windowId: 4211, title: "", onScreen: true } };
      },
      startMacosStream: (_binary, windowId, handlers) => {
        const entry = { windowId, stopped: false, ...handlers };
        streams.push(entry);
        return { stop: () => (entry.stopped = true) };
      },
    },
  });

  capture.setTarget({ app: "Finder" });
  await flush();
  capture.setTarget({ pid: 785 });
  await flush();
  assert.equal(resolveCalls.length, 2);
  assert.equal(streams.length, 1);

  streams[0].onFrame(Buffer.from("jpeg"));
  assert.equal(frames[0], `data:image/jpeg;base64,${Buffer.from("jpeg").toString("base64")}`);

  streams[0].onExit(5);
  assert.equal(clears, 1);
  scheduler.runAll();
  await flush();
  assert.equal(streams.length, 2);

  capture.setTarget(undefined);
  assert.equal(streams[1].stopped, true);
  capture.stop();
});

test("Windows 取流：按 HWND 找到 Chromium 窗口 source；小整数 window_id 不当作 HWND", async () => {
  const shown: string[] = [];
  const capture = createComputerUsePreviewCapture({
    platform: "win32",
    sink: { showFrame() {}, showSource: (source) => shown.push(source.id), clear() {} },
    logger,
    deps: {
      resolveWindowsWindow: async () => ({ pid: 42, hwnd: 198276 }),
      getWindowSources: async () =>
        [{ id: "window:3:0" }, { id: "window:198276:0" }] as DesktopCapturerSource[],
    },
  });
  capture.setTarget({ app: "notepad", windowId: 3 });
  await flush();
  await flush();
  assert.deepEqual(shown, ["window:198276:0"]);
  capture.stop();
});
