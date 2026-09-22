/**
 * 桌面更新源解析。
 *
 * 本仓库是分叉发行：默认跟随自己的 GitHub Releases（清单 `latest*.yml` 与安装包都是
 * 该 Release 的资产），不再依赖官方服务端 manifest 接口，也不会因为服务端强更配置
 * 把分叉用户推向官方安装包。`service` 源保留给联调与回退。
 *
 * 本文件保持零依赖（不 import 任何模块），便于 node:test 直接执行。
 */

declare const __ZCODE_UPDATE_SOURCE__: string | undefined;
declare const __ZCODE_UPDATE_GITHUB_REPO__: string | undefined;

export type DesktopUpdateSourceKind = "github" | "service";

export interface DesktopGithubUpdateSource {
  kind: "github";
  owner: string;
  repo: string;
}

export interface DesktopServiceUpdateSource {
  kind: "service";
}

export type DesktopUpdateSource = DesktopGithubUpdateSource | DesktopServiceUpdateSource;

/** 兜底更新源仓库。CI 通过 __ZCODE_UPDATE_GITHUB_REPO__ 注入实际仓库，任何 fork 无需改代码。 */
const DEFAULT_GITHUB_SOURCE: DesktopGithubUpdateSource = {
  kind: "github",
  owner: "JinghuiS",
  repo: "ZCode",
};

export const DEFAULT_UPDATE_GITHUB_REPO = `${DEFAULT_GITHUB_SOURCE.owner}/${DEFAULT_GITHUB_SOURCE.repo}`;

const GITHUB_REPO_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9._-]+$/;

export function normalizeUpdateSourceKind(
  value: string | null | undefined,
): DesktopUpdateSourceKind | null {
  const normalized = value?.trim().toLowerCase();
  return normalized === "github" || normalized === "service" ? normalized : null;
}

/**
 * 接受 `owner/repo`、`https://github.com/owner/repo(.git)`、`git@github.com:owner/repo.git`
 * 以及带额外路径段的仓库地址，取前两段作为仓库坐标。无法解析时返回 null。
 */
export function parseGithubRepo(
  value: string | null | undefined,
): { owner: string; repo: string } | null {
  const raw = value?.trim();
  if (!raw) {
    return null;
  }

  const segments = raw
    .replace(/^https?:\/\/(?:www\.)?github\.com\//i, "")
    .replace(/^git@github\.com:/i, "")
    .replace(/^github\.com\//i, "")
    .split("/")
    .filter((segment) => segment.length > 0);
  const owner = segments[0] ?? "";
  const repo = (segments[1] ?? "").replace(/\.git$/i, "");
  if (!GITHUB_REPO_PATTERN.test(`${owner}/${repo}`)) {
    return null;
  }

  return { owner, repo };
}

export interface ResolveDesktopUpdateSourceOptions {
  env?: Record<string, string | undefined>;
  /** 构建期注入的 __ZCODE_UPDATE_SOURCE__，缺失时传空。 */
  bakedSource?: string | null;
  /** 构建期注入的 __ZCODE_UPDATE_GITHUB_REPO__，缺失时传空。 */
  bakedRepo?: string | null;
  warn?: (message: string) => void;
}

/**
 * 解析顺序：环境变量 > 构建期注入 > 兜底仓库；同一层里显式的更新源类型优先于仓库取值。
 *
 * - `ZCODE_UPDATE_FEED_URL` 由 autoUpdater 单独处理，不在这里解析（它表示 service 源的 manifest 覆盖）。
 * - 仓库地址非法时告警并回退到兜底仓库，不静默切回官方服务端源，避免分叉用户被推去官方安装包。
 * - 场景约束：CI 会注入 `__ZCODE_UPDATE_GITHUB_REPO__`，因此显式指定 `service` 时必须能压过它，
 *   否则“用 service 源打包”无法生效。
 */
export function resolveDesktopUpdateSource(
  options: ResolveDesktopUpdateSourceOptions = {},
): DesktopUpdateSource {
  const env = options.env ?? {};
  const warn = options.warn ?? (() => {});
  const envRepo = env["ZCODE_UPDATE_GITHUB_REPO"];
  const githubSourceFrom = (
    ...candidates: Array<string | null | undefined>
  ): DesktopGithubUpdateSource => {
    for (const candidate of candidates) {
      const repo = parseGithubRepo(candidate);
      if (repo) {
        return { kind: "github", owner: repo.owner, repo: repo.repo };
      }
    }
    const configured = candidates.find((candidate) => candidate?.trim());
    if (configured) {
      // 空值代表“未配置”，直接走兜底仓库；只有配置了却解析不了才告警。
      warn(`[update-source] ignore invalid github repository value=${configured}`);
    }
    return DEFAULT_GITHUB_SOURCE;
  };

  const envSourceKind = env["ZCODE_UPDATE_SOURCE"];
  const normalizedEnvKind = normalizeUpdateSourceKind(envSourceKind);
  if (envSourceKind?.trim() && !normalizedEnvKind) {
    warn(`[update-source] ignore invalid ZCODE_UPDATE_SOURCE=${envSourceKind}`);
  }
  if (normalizedEnvKind === "service") {
    return { kind: "service" };
  }
  if (normalizedEnvKind === "github") {
    return githubSourceFrom(envRepo, options.bakedRepo);
  }
  if (envRepo?.trim()) {
    return githubSourceFrom(envRepo, options.bakedRepo);
  }

  const bakedSourceKind = options.bakedSource;
  const normalizedBakedKind = normalizeUpdateSourceKind(bakedSourceKind);
  if (bakedSourceKind?.trim() && !normalizedBakedKind) {
    warn(`[update-source] ignore invalid __ZCODE_UPDATE_SOURCE__=${bakedSourceKind}`);
  }
  if (normalizedBakedKind === "service") {
    return { kind: "service" };
  }
  if (normalizedBakedKind === "github") {
    return githubSourceFrom(envRepo, options.bakedRepo);
  }

  return githubSourceFrom(options.bakedRepo);
}

/**
 * 读取运行时环境与构建期注入值。构建期值只在打包时存在，未打包（dev）时为 undefined，
 * 因此统一用 typeof 判定，避免 ReferenceError。
 */
export function resolveDesktopUpdateSourceFromRuntime(
  env: Record<string, string | undefined> = process.env,
): DesktopUpdateSource {
  return resolveDesktopUpdateSource({
    env,
    bakedSource: typeof __ZCODE_UPDATE_SOURCE__ === "undefined" ? "" : __ZCODE_UPDATE_SOURCE__,
    bakedRepo:
      typeof __ZCODE_UPDATE_GITHUB_REPO__ === "undefined" ? "" : __ZCODE_UPDATE_GITHUB_REPO__,
  });
}

export function buildGithubReleaseUrl(source: DesktopGithubUpdateSource, tag: string): string {
  return `https://github.com/${source.owner}/${source.repo}/releases/tag/${encodeURIComponent(tag)}`;
}

/**
 * 更新弹窗的「查看发布页面」链接。只有 GitHub 更新源有对应 Release 页面，
 * service 源返回 undefined（renderer 不展示入口，行为与改动前一致）。
 */
export function resolveUpdateReleaseUrl(
  source: DesktopUpdateSource,
  options: { tag?: string | null; version?: string | null },
): string | undefined {
  if (source.kind !== "github") {
    return undefined;
  }

  const tag =
    options.tag?.trim() ||
    (options.version?.trim() ? `v${options.version.trim().replace(/^v/i, "")}` : "");
  return tag ? buildGithubReleaseUrl(source, tag) : undefined;
}
