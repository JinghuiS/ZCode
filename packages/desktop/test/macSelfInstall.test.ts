import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMacSelfInstallScript,
  isTranslocatedMacAppPath,
  resolveMacAppBundlePath,
  resolveMacInstallModeFromCodesignOutput,
} from "../src/main/macSelfInstall.ts";

test("只有带 Team ID 的正式签名走 Squirrel", () => {
  assert.equal(
    resolveMacInstallModeFromCodesignOutput(
      "Identifier=ai.zcode.desktop\nAuthority=Developer ID Application: Foo (ABCDE12345)\nTeamIdentifier=ABCDE12345\n",
    ),
    "squirrel",
  );
  assert.equal(
    resolveMacInstallModeFromCodesignOutput(
      "Identifier=ai.zcode.desktop\nSignature=adhoc\nTeamIdentifier=not set\n",
    ),
    "self-install",
  );
  assert.equal(resolveMacInstallModeFromCodesignOutput("Identifier=x\n"), "self-install");
  assert.equal(resolveMacInstallModeFromCodesignOutput(null), "self-install");
});

test("从可执行文件路径反推 .app 包路径", () => {
  assert.equal(
    resolveMacAppBundlePath("/Applications/ZCode Preview.app/Contents/MacOS/ZCode Preview"),
    "/Applications/ZCode Preview.app",
  );
  assert.equal(resolveMacAppBundlePath("/usr/local/bin/electron"), null);
});

test("识别 App Translocation 路径", () => {
  assert.equal(
    isTranslocatedMacAppPath("/private/var/folders/x/AppTranslocation/ABC/d/ZCode.app"),
    true,
  );
  assert.equal(isTranslocatedMacAppPath("/Applications/ZCode.app"), false);
});

test("安装脚本按顺序等待退出、校验签名并支持回滚", () => {
  const script = buildMacSelfInstallScript();
  assert.ok(script.startsWith("#!/bin/bash\n"));
  const order = ["kill -0", "ditto -x -k", "codesign --verify", 'mv "$TARGET_APP"'].map((token) =>
    script.indexOf(token),
  );
  assert.ok(order.every((index) => index !== -1));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(script, /mv "\$STAGE_DIR\/previous\.app" "\$TARGET_APP"/);
});
