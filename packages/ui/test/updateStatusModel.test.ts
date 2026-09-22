import assert from "node:assert/strict";
import test from "node:test";
import type { UpdateStatePayload } from "../../shared/src/update.ts";
import { deriveUpdateStatusViewModel } from "../src/updateStatusModel.ts";

const releaseNotes = {
  version: "3.15.0",
  title: "v3.15.0 更新日志",
  markdown: "## 修复\n- 一些修复",
};

test("更新状态带发布页地址时透出 releaseUrl，供弹窗展示「查看发布页面」", () => {
  const updateState: UpdateStatePayload = {
    kind: "update-available",
    enabled: true,
    version: "3.15.0",
    channel: "stable",
    releaseUrl: "https://github.com/acme/zcode/releases/tag/v3.15.0",
    releaseNotes,
  };

  const viewModel = deriveUpdateStatusViewModel({ legacyReadyVersion: null, updateState });
  assert.equal(viewModel.dialogPhase, "before-download");
  assert.equal(viewModel.releaseUrl, "https://github.com/acme/zcode/releases/tag/v3.15.0");
  assert.deepEqual(viewModel.releaseNotesPayload, releaseNotes);
});

test("下载完成态保留 releaseUrl", () => {
  const updateState: UpdateStatePayload = {
    kind: "update-downloaded",
    enabled: true,
    version: "3.15.0",
    releaseUrl: "https://github.com/acme/zcode/releases/tag/v3.15.0",
  };

  const viewModel = deriveUpdateStatusViewModel({ legacyReadyVersion: null, updateState });
  assert.equal(viewModel.dialogPhase, "downloaded");
  assert.equal(viewModel.releaseUrl, "https://github.com/acme/zcode/releases/tag/v3.15.0");
});

test("服务端 manifest 源与无更新状态不带 releaseUrl", () => {
  const serviceUpdate: UpdateStatePayload = {
    kind: "update-available",
    enabled: true,
    version: "3.15.0",
    channel: "preview",
    releaseNotes,
  };
  assert.equal(
    deriveUpdateStatusViewModel({ legacyReadyVersion: null, updateState: serviceUpdate })
      .releaseUrl,
    null,
  );

  assert.equal(
    deriveUpdateStatusViewModel({
      legacyReadyVersion: null,
      updateState: { kind: "idle", enabled: true },
    }).releaseUrl,
    null,
  );
  assert.equal(
    deriveUpdateStatusViewModel({ legacyReadyVersion: "3.15.0", updateState: null }).releaseUrl,
    null,
  );
});
