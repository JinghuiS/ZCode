#!/usr/bin/env node
// 编译 macOS 电脑控制预览辅助程序（ScreenCaptureKit：目标窗口解析 + 单窗口取流）。
// 非 darwin / 无 swiftc 时跳过：预览窗仍可亮空壳。

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = join(packageRoot, "native", "macos-cua-preview", "main.swift");
const outputDir = join(packageRoot, "resources", "macos-cua-preview");
const outputPath = join(outputDir, "zcode-cua-preview");

if (process.platform !== "darwin") {
  console.log("[cua-preview] 跳过：仅 macOS 需要");
  process.exit(0);
}

if (!existsSync(sourcePath)) {
  console.error(`[cua-preview] 源文件缺失：${sourcePath}`);
  process.exit(1);
}

function hasSwiftc() {
  try {
    execFileSync("xcrun", ["--find", "swiftc"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

if (!hasSwiftc()) {
  console.warn("[cua-preview] 未找到 swiftc（需 Xcode Command Line Tools）；跳过构建。");
  process.exit(0);
}

mkdirSync(outputDir, { recursive: true });

try {
  execFileSync(
    "xcrun",
    ["swiftc", "-O", "-target", "arm64-apple-macos12.3", sourcePath, "-o", `${outputPath}-arm64`],
    { stdio: "inherit" },
  );
  execFileSync(
    "xcrun",
    ["swiftc", "-O", "-target", "x86_64-apple-macos12.3", sourcePath, "-o", `${outputPath}-x86_64`],
    { stdio: "inherit" },
  );
  execFileSync(
    "lipo",
    ["-create", `${outputPath}-arm64`, `${outputPath}-x86_64`, "-output", outputPath],
    { stdio: "inherit" },
  );
  execFileSync("rm", ["-f", `${outputPath}-arm64`, `${outputPath}-x86_64`]);
  console.log(`[cua-preview] 已构建 universal 二进制：${outputPath}`);
} catch (error) {
  console.warn(
    "[cua-preview] 构建失败；预览窗仍可亮空壳：",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(0);
}
