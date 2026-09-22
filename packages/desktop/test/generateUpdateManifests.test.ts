import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildUpdateManifests,
  classifyArtifact,
  generateUpdateManifests,
  parseArgs,
  serializeUpdateManifest,
} from "../scripts/generate-update-manifests.mjs";

test("识别平台与架构", () => {
  assert.deepEqual(classifyArtifact("ZCode-3.14.0-mac-arm64.zip"), {
    platform: "mac",
    extension: ".zip",
    arch: "arm64",
  });
  assert.deepEqual(classifyArtifact("ZCode-3.14.0-win-x64.exe"), {
    platform: "win",
    extension: ".exe",
    arch: "x64",
  });
  assert.deepEqual(classifyArtifact("ZCode-3.14.0-linux-x64.pkg.tar.zst"), {
    platform: "linux",
    extension: ".pkg.tar.zst",
    arch: "x64",
  });
  assert.deepEqual(classifyArtifact("ZCode-3.14.0-linux-arm64.AppImage"), {
    platform: "linux",
    extension: ".appimage",
    arch: "arm64",
  });
  // .dmg 不参与自动更新，但同平台要能识别出来并被清单排除
  assert.deepEqual(classifyArtifact("ZCode-3.14.0-mac-arm64.dmg"), {
    platform: "mac",
    extension: null,
    arch: null,
  });
  assert.equal(classifyArtifact("builder-debug.yml"), null);
});

test("同一平台的全部架构写进一份清单，blockmap 带上 blockMapSize", () => {
  const manifests = buildUpdateManifests(
    [
      {
        fileName: "ZCode-3.14.0-mac-arm64.zip",
        sha512: "arm-sha",
        size: 100,
        blockMapSize: 10,
      },
      { fileName: "ZCode-3.14.0-mac-x64.zip", sha512: "x64-sha", size: 90 },
    ],
    { version: "3.14.0", releaseDate: "2026-09-22T00:00:00.000Z" },
  );

  const mac = manifests.get("mac");
  assert.equal(mac?.channelFile, "latest-mac.yml");
  assert.equal(mac?.manifest.version, "3.14.0");
  assert.deepEqual(
    mac?.manifest.files.map((file) => file.url),
    ["ZCode-3.14.0-mac-arm64.zip", "ZCode-3.14.0-mac-x64.zip"],
  );
  assert.equal(mac?.manifest.files[0]?.blockMapSize, 10);
  assert.equal(mac?.manifest.path, "ZCode-3.14.0-mac-arm64.zip");
  assert.equal(mac?.manifest.sha512, "arm-sha");
});

test("缺少可安装产物或缺少架构标识时跳过并告警", () => {
  const warnings = [];
  const manifests = buildUpdateManifests(
    [
      { fileName: "ZCode-3.14.0-mac-arm64.dmg", sha512: "dmg", size: 1 },
      { fileName: "ZCode-3.14.0-win-beta.exe", sha512: "noarch", size: 1 },
    ],
    {
      version: "3.14.0",
      releaseDate: "2026-09-22T00:00:00.000Z",
      warn: (message) => warnings.push(message),
    },
  );

  assert.equal(manifests.size, 0);
  assert.equal(warnings.length, 2);
  assert.ok(warnings.some((message) => message.includes("mac")));
  assert.ok(warnings.some((message) => message.includes("架构")));
});

test("序列化结果可被 YAML 解析为期望字段", () => {
  const manifests = buildUpdateManifests(
    [{ fileName: "ZCode-3.14.0-win-x64.exe", sha512: "sha+with/special=", size: 42 }],
    { version: "3.14.0", releaseDate: "2026-09-22T00:00:00.000Z" },
  );
  const serialized = serializeUpdateManifest(manifests.get("win")?.manifest);

  // base64 里的 + / = 必须保持字符串字面量，不能让解析器当成特殊语法
  assert.match(serialized, /^version: "3\.14\.0"$/m);
  assert.match(serialized, /^  - url: "ZCode-3\.14\.0-win-x64\.exe"$/m);
  assert.match(serialized, /^    sha512: "sha\+with\/special="$/m);
  assert.match(serialized, /^    size: 42$/m);
  assert.match(serialized, /^path: "ZCode-3\.14\.0-win-x64\.exe"$/m);
  assert.match(serialized, /^releaseDate: "2026-09-22T00:00:00\.000Z"$/m);
});

test("命令行参数支持空格与等号两种写法", () => {
  assert.deepEqual(parseArgs(["--dist", "dist", "--tag=v3.14.0", "--repo", "acme/zcode"]), {
    dist: "dist",
    out: "",
    tag: "v3.14.0",
    repo: "acme/zcode",
    releaseDate: "",
  });
});

test("按产物生成清单文件并写入 sha512", async () => {
  const distDir = await mkdtemp(join(tmpdir(), "zcode-update-manifest-"));
  const appImage = Buffer.from("fake-appimage-payload");
  await writeFile(join(distDir, "ZCode-3.14.0-linux-x64.AppImage"), appImage);
  await writeFile(join(distDir, "ZCode-3.14.0-linux-arm64.AppImage"), appImage);
  await writeFile(join(distDir, "ZCode-3.14.0-linux-x64.AppImage.blockmap"), Buffer.from("bm"));

  const result = await generateUpdateManifests({
    dist: distDir,
    tag: "v3.14.0",
    releaseDate: "2026-09-22T00:00:00.000Z",
    warn: () => {},
  });

  assert.equal(result.version, "3.14.0");
  assert.deepEqual(
    result.manifests.map((entry) => entry.channelFile),
    ["latest-linux.yml"],
  );

  const manifest = await readFile(join(distDir, "latest-linux.yml"), "utf8");
  const expectedSha512 = createHash("sha512").update(appImage).digest("base64");
  assert.match(
    manifest,
    new RegExp(`^    sha512: "${expectedSha512.replace(/[+/=]/g, "\\$&")}"$`, "m"),
  );
  assert.match(manifest, /^    blockMapSize: 2$/m);
  assert.match(manifest, /"ZCode-3\.14\.0-linux-arm64\.AppImage"/);
});

test("tag 缺失或没有可用产物时失败", async () => {
  const distDir = await mkdtemp(join(tmpdir(), "zcode-update-manifest-empty-"));
  await assert.rejects(
    () => generateUpdateManifests({ dist: distDir, tag: "", warn: () => {} }),
    /--tag/,
  );
  await assert.rejects(
    () => generateUpdateManifests({ dist: distDir, tag: "v3.14.0", warn: () => {} }),
    /没有可用的安装包产物/,
  );
});

test("文件名含空格等非 URL 安全字符时跳过，避免 GitHub 下载路径 404", async () => {
  const distDir = await mkdtemp(join(tmpdir(), "zcode-update-manifest-unsafe-"));
  await writeFile(join(distDir, "ZCode Preview-3.14.0-mac-arm64.zip"), Buffer.from("x"));
  const warnings = [];

  await assert.rejects(
    () =>
      generateUpdateManifests({
        dist: distDir,
        tag: "v3.14.0",
        warn: (message) => warnings.push(message),
      }),
    /没有可用的安装包产物/,
  );
  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? "", /URL 安全/);
});

test("Linux 产物架构名不是 process.arch 取值时不写进清单", () => {
  // electron-updater 按 process.arch（x64/arm64）在文件名里匹配，x86_64/amd64/aarch64 匹配不到会装错架构。
  const warnings: string[] = [];
  const manifests = buildUpdateManifests(
    [
      "ZCode-3.14.0-linux-x64.AppImage",
      "ZCode-3.14.0-linux-arm64.AppImage",
      "ZCode-3.14.0-linux-x86_64.rpm",
      "ZCode-3.14.0-linux-amd64.deb",
      "ZCode-3.14.0-linux-aarch64.rpm",
    ].map((fileName) => ({ fileName, sha512: "sha", size: 1 })),
    {
      version: "3.14.0",
      releaseDate: "2026-09-22T00:00:00.000Z",
      warn: (message) => warnings.push(message),
    },
  );

  assert.deepEqual(
    manifests.get("linux")?.manifest.files.map((file) => file.url),
    ["ZCode-3.14.0-linux-arm64.AppImage", "ZCode-3.14.0-linux-x64.AppImage"],
  );
  assert.equal(warnings.length, 3);
});
