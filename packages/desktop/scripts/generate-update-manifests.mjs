#!/usr/bin/env node
/**
 * 生成 electron-updater 的 `latest*.yml` 更新清单。
 *
 * 桌面端默认以本仓库的 GitHub Releases 为更新源（见 specs/desktop-update-source.md）：
 * Release 资产里必须有清单，客户端才知道新版本号、产物地址与 sha512。electron-builder 生成的
 * 清单指向打包时的 generic 占位地址（`http://localhost:8081`），且每个架构各自产出一份同名
 * `latest*.yml` 会互相覆盖，因此清单统一在 release job 里按最终产物生成一次。
 *
 * 用法：
 *   node packages/desktop/scripts/generate-update-manifests.mjs \
 *     --dist <安装包目录> [--out <清单输出目录>] --tag v3.14.0 [--repo owner/repo]
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** 平台 → 清单文件名与产物扩展名（小写，含点）。 */
export const PLATFORM_MANIFESTS = Object.freeze({
  mac: { channelFile: "latest-mac.yml", extensions: Object.freeze([".zip"]) },
  win: { channelFile: "latest.yml", extensions: Object.freeze([".exe"]) },
  linux: {
    channelFile: "latest-linux.yml",
    extensions: Object.freeze([".appimage", ".deb", ".rpm", ".pkg.tar.zst"]),
  },
});

/** 顶层 path/sha512 指向的首选产物：客户端读旧字段时也要拿到能安装的包。 */
const PRIMARY_EXTENSION_BY_PLATFORM = Object.freeze({
  mac: ".zip",
  win: ".exe",
  linux: ".appimage",
});

// 只接受 Node 的 process.arch 取值：electron-updater 的 findFile 按 process.arch 在文件名里匹配，
// x86_64 / amd64 / aarch64 这类写法客户端匹配不到，会退回第一个文件而装错架构，因此不写进清单。
const ARCH_TOKENS = Object.freeze(["arm64", "x64", "ia32", "armv7l", "universal"]);

// GitHub provider 解析下载路径时会把空格替换成 `-`（electron-updater GitHubProvider.resolveFiles），
// 含空格的文件名会直接 404；非 ASCII 同样可能在中间层被改写。这里只接受 URL 安全字符集。
const SAFE_FILE_NAME_PATTERN = /^[A-Za-z0-9._@+-]+$/;

export function parseArgs(argv) {
  const options = { dist: "", out: "", tag: "", repo: "", releaseDate: "" };
  const switches = {
    "--dist": "dist",
    "--out": "out",
    "--tag": "tag",
    "--repo": "repo",
    "--release-date": "releaseDate",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [name, inlineValue] = arg.includes("=") ? arg.split(/=(.*)/s, 2) : [arg, undefined];
    const key = switches[name];
    if (!key) {
      continue;
    }
    options[key] = (inlineValue ?? argv[index + 1] ?? "").trim();
    if (inlineValue === undefined) {
      index += 1;
    }
  }

  return options;
}

/**
 * 从产物文件名解析目标平台与架构。
 *
 * 文件名形如 `${productName}-${version}-${mac|win|linux}-${arch}[_TEST].${ext}`
 * （packages/desktop/electron-builder.config.js 的 buildDesktopArtifactName）。
 */
export function classifyArtifact(fileName) {
  const lower = fileName.toLowerCase();
  for (const [platform, config] of Object.entries(PLATFORM_MANIFESTS)) {
    if (!lower.includes(`-${platform}-`)) {
      continue;
    }
    const extension = config.extensions.find((candidate) => lower.endsWith(candidate));
    if (!extension) {
      return { platform, extension: null, arch: null };
    }
    const arch = ARCH_TOKENS.find((token) => lower.includes(`-${token}`)) ?? null;
    return { platform, extension, arch };
  }

  return null;
}

/** 安装包是几百 MB 级产物，按流计算 sha512，避免整包读进内存。 */
async function computeFileSha512(filePath) {
  const hash = createHash("sha512");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("base64");
}

/**
 * 按平台聚合产物并生成清单对象。
 *
 * @param {{ fileName: string; sha512: string; size: number; blockMapSize?: number }[]} artifacts
 * @param {{ version: string; releaseDate: string; warn?: (message: string) => void }} options
 */
export function buildUpdateManifests(artifacts, options) {
  const warn = options.warn ?? (() => {});
  const grouped = new Map();

  for (const artifact of artifacts) {
    const classified = classifyArtifact(artifact.fileName);
    if (!classified) {
      warn(`[update-manifest] 跳过无法识别平台的产物：${artifact.fileName}`);
      continue;
    }
    if (!classified.extension) {
      warn(`[update-manifest] 跳过不在清单范围内的产物：${artifact.fileName}`);
      continue;
    }
    if (!classified.arch) {
      // electron-updater 的 findFile 依据文件名里的 process.arch 选择产物；
      // 名字里没有架构标识时多架构发布会让客户端拿到别的架构包。
      warn(`[update-manifest] 跳过文件名缺少架构标识的产物：${artifact.fileName}`);
      continue;
    }

    const files = grouped.get(classified.platform) ?? [];
    files.push({
      url: artifact.fileName,
      sha512: artifact.sha512,
      size: artifact.size,
      ...(artifact.blockMapSize ? { blockMapSize: artifact.blockMapSize } : {}),
    });
    grouped.set(classified.platform, files);
  }

  const manifests = new Map();
  for (const [platform, files] of grouped) {
    const primaryExtension = PRIMARY_EXTENSION_BY_PLATFORM[platform];
    const primary = files.find((file) => file.url.toLowerCase().endsWith(primaryExtension));
    if (!primary) {
      warn(`[update-manifest] ${platform} 缺少可安装产物（${primaryExtension}），跳过该平台清单`);
      continue;
    }

    manifests.set(platform, {
      channelFile: PLATFORM_MANIFESTS[platform].channelFile,
      manifest: {
        version: options.version,
        files: files.sort((left, right) => left.url.localeCompare(right.url)),
        path: primary.url,
        sha512: primary.sha512,
        releaseDate: options.releaseDate,
      },
    });
  }

  return manifests;
}

function quote(value) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** 手写序列化：清单结构固定，避免在 release job 里再引入 YAML 依赖。 */
export function serializeUpdateManifest(manifest) {
  const lines = [`version: ${quote(manifest.version)}`, "files:"];
  for (const file of manifest.files) {
    lines.push(`  - url: ${quote(file.url)}`);
    lines.push(`    sha512: ${quote(file.sha512)}`);
    lines.push(`    size: ${file.size}`);
    if (file.blockMapSize) {
      lines.push(`    blockMapSize: ${file.blockMapSize}`);
    }
  }
  lines.push(`path: ${quote(manifest.path)}`);
  lines.push(`sha512: ${quote(manifest.sha512)}`);
  lines.push(`releaseDate: ${quote(manifest.releaseDate)}`);
  return `${lines.join("\n")}\n`;
}

async function readArtifacts(distDir, warn) {
  const entries = await readdir(distDir, { withFileTypes: true });
  const artifacts = [];
  const blockMapSizes = new Map();

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    if (entry.name.endsWith(".blockmap")) {
      const blockMapStat = await stat(join(distDir, entry.name));
      blockMapSizes.set(entry.name.slice(0, -".blockmap".length), blockMapStat.size);
    }
  }

  for (const entry of entries) {
    if (!entry.isFile() || entry.name.endsWith(".blockmap") || entry.name.startsWith("latest")) {
      continue;
    }
    if (!SAFE_FILE_NAME_PATTERN.test(entry.name)) {
      warn(`[update-manifest] 跳过文件名非 URL 安全的产物：${entry.name}`);
      continue;
    }

    const filePath = join(distDir, entry.name);
    const fileStat = await stat(filePath);
    artifacts.push({
      fileName: entry.name,
      sha512: await computeFileSha512(filePath),
      size: fileStat.size,
      ...(blockMapSizes.has(entry.name) ? { blockMapSize: blockMapSizes.get(entry.name) } : {}),
    });
  }

  return artifacts;
}

function normalizeVersion(tag) {
  return tag.trim().replace(/^v/i, "");
}

export async function generateUpdateManifests(options) {
  const warn = options.warn ?? ((message) => console.warn(message));
  const version = normalizeVersion(options.tag);
  if (!version) {
    throw new Error("--tag 必填，例如 --tag v3.14.0");
  }
  const distDir = resolve(options.dist);
  const outDir = resolve(options.out || options.dist);
  const releaseDate = options.releaseDate || new Date().toISOString();

  const artifacts = await readArtifacts(distDir, warn);
  if (artifacts.length === 0) {
    throw new Error(`没有可用的安装包产物：${distDir}`);
  }

  const manifests = buildUpdateManifests(artifacts, { version, releaseDate, warn });
  const written = [];
  for (const { channelFile, manifest } of manifests.values()) {
    const target = join(outDir, channelFile);
    await writeFile(target, serializeUpdateManifest(manifest), "utf8");
    written.push({ channelFile, target, fileCount: manifest.files.length });
    console.log(
      `[update-manifest] 写入 ${channelFile} version=${version} files=${manifest.files
        .map((file) => file.url)
        .join(",")}`,
    );
  }

  if (written.length === 0) {
    throw new Error(`没有生成任何更新清单，请检查产物命名：${distDir}`);
  }

  return { version, releaseDate, manifests: written, artifacts: artifacts.length };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.dist) {
    throw new Error("--dist 必填");
  }

  const result = await generateUpdateManifests(options);
  const repo = options.repo ? ` repo=${options.repo}` : "";
  console.log(
    `[update-manifest] 完成 version=${result.version} artifacts=${result.artifacts} manifests=${result.manifests.length}${repo}`,
  );
}

const entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (entryHref === import.meta.url) {
  try {
    await main();
  } catch (error) {
    console.error(`[update-manifest] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
