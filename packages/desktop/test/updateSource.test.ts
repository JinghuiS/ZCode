import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_UPDATE_GITHUB_REPO,
  buildGithubReleaseUrl,
  normalizeUpdateSourceKind,
  parseGithubRepo,
  resolveDesktopUpdateSource,
  resolveUpdateReleaseUrl,
} from "../src/main/updateSource.ts";

test("解析 GitHub 仓库坐标", () => {
  assert.deepEqual(parseGithubRepo("JinghuiS/ZCode"), { owner: "JinghuiS", repo: "ZCode" });
  assert.deepEqual(parseGithubRepo("https://github.com/JinghuiS/ZCode"), {
    owner: "JinghuiS",
    repo: "ZCode",
  });
  assert.deepEqual(parseGithubRepo("https://github.com/JinghuiS/ZCode.git"), {
    owner: "JinghuiS",
    repo: "ZCode",
  });
  assert.deepEqual(parseGithubRepo("git@github.com:JinghuiS/ZCode.git"), {
    owner: "JinghuiS",
    repo: "ZCode",
  });
  // 带额外路径段与首尾空白的地址同样要归一化到前两段
  assert.deepEqual(parseGithubRepo("  https://github.com/JinghuiS/ZCode/releases  "), {
    owner: "JinghuiS",
    repo: "ZCode",
  });
});

test("非法仓库坐标返回 null", () => {
  assert.equal(parseGithubRepo(""), null);
  assert.equal(parseGithubRepo(undefined), null);
  assert.equal(parseGithubRepo("ZCode"), null);
  assert.equal(parseGithubRepo("owner/"), null);
  assert.equal(parseGithubRepo("/repo"), null);
  assert.equal(parseGithubRepo("owner/re po"), null);
});

test("更新源类型只接受 github 与 service", () => {
  assert.equal(normalizeUpdateSourceKind(" GitHub "), "github");
  assert.equal(normalizeUpdateSourceKind("service"), "service");
  assert.equal(normalizeUpdateSourceKind("gitlab"), null);
  assert.equal(normalizeUpdateSourceKind(undefined), null);
});

test("未配置时使用兜底仓库的 GitHub 更新源", () => {
  assert.deepEqual(resolveDesktopUpdateSource({ env: {} }), {
    kind: "github",
    owner: "JinghuiS",
    repo: "ZCode",
  });
});

test("环境变量仓库覆盖构建期注入与兜底仓库", () => {
  assert.deepEqual(
    resolveDesktopUpdateSource({
      env: { ZCODE_UPDATE_GITHUB_REPO: "acme/zcode" },
      bakedRepo: "baked/repo",
    }),
    { kind: "github", owner: "acme", repo: "zcode" },
  );
  assert.deepEqual(resolveDesktopUpdateSource({ env: {}, bakedRepo: "baked/repo" }), {
    kind: "github",
    owner: "baked",
    repo: "repo",
  });
});

test("显式 service 源可单独生效（回退不依赖 GitHub 仓库）", () => {
  assert.deepEqual(
    resolveDesktopUpdateSource({ env: { ZCODE_UPDATE_SOURCE: "service" }, bakedRepo: "a/b" }),
    { kind: "service" },
  );
  assert.deepEqual(
    resolveDesktopUpdateSource({ env: {}, bakedSource: "service", bakedRepo: "a/b" }),
    { kind: "service" },
  );
});

test("显式 github 源缺少仓库时回退到构建期注入或兜底仓库", () => {
  assert.deepEqual(resolveDesktopUpdateSource({ env: { ZCODE_UPDATE_SOURCE: "github" } }), {
    kind: "github",
    owner: "JinghuiS",
    repo: "ZCode",
  });
  assert.deepEqual(
    resolveDesktopUpdateSource({
      env: { ZCODE_UPDATE_SOURCE: "github" },
      bakedRepo: "baked/repo",
    }),
    { kind: "github", owner: "baked", repo: "repo" },
  );
});

test("仓库写错时告警并回退兜底仓库，不切回官方服务端源", () => {
  const warnings: string[] = [];
  const source = resolveDesktopUpdateSource({
    env: { ZCODE_UPDATE_GITHUB_REPO: "not-a-repo" },
    warn: (message) => warnings.push(message),
  });

  assert.deepEqual(source, {
    kind: "github",
    owner: "JinghuiS",
    repo: "ZCode",
  });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? "", /not-a-repo/);
});

test("更新源类型取值非法时告警并忽略该项", () => {
  const warnings: string[] = [];
  const source = resolveDesktopUpdateSource({
    env: { ZCODE_UPDATE_SOURCE: "gitlab", ZCODE_UPDATE_GITHUB_REPO: "acme/zcode" },
    warn: (message) => warnings.push(message),
  });

  assert.deepEqual(source, { kind: "github", owner: "acme", repo: "zcode" });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? "", /gitlab/);
});

test("默认仓库常量与解析结果一致", () => {
  assert.equal(DEFAULT_UPDATE_GITHUB_REPO, "JinghuiS/ZCode");
});

test("GitHub 源的 Release 页面地址由 tag 或版本号推导", () => {
  const source = { kind: "github" as const, owner: "acme", repo: "zcode" };
  assert.equal(
    resolveUpdateReleaseUrl(source, { tag: "v3.15.0", version: "3.15.0" }),
    "https://github.com/acme/zcode/releases/tag/v3.15.0",
  );
  assert.equal(
    resolveUpdateReleaseUrl(source, { tag: null, version: "3.15.0" }),
    "https://github.com/acme/zcode/releases/tag/v3.15.0",
  );
  assert.equal(
    resolveUpdateReleaseUrl(source, { tag: null, version: "v3.15.0" }),
    "https://github.com/acme/zcode/releases/tag/v3.15.0",
  );
  assert.equal(resolveUpdateReleaseUrl(source, { tag: null, version: null }), undefined);
  assert.equal(
    buildGithubReleaseUrl(source, "v3.15.0"),
    "https://github.com/acme/zcode/releases/tag/v3.15.0",
  );
});

test("服务端 manifest 源不提供发布页地址", () => {
  assert.equal(
    resolveUpdateReleaseUrl({ kind: "service" }, { tag: "v3.15.0", version: "3.15.0" }),
    undefined,
  );
});
