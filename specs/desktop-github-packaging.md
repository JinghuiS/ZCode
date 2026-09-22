# GitHub 桌面安装包流水线

## 目标

用 GitHub Actions 在原生 runner 上构建 Windows、macOS、Linux 桌面安装包。打包入口只走仓库已有的 `pnpm bundle:desktop`，不在 YAML 里直接调用 `electron-builder`。

本流水线产出可分发的安装包；不替代 `pnpm release` 的版本号/changelog/tag。签名与公证是可选后置步骤，缺证书时仍应产出未签名包。

## 概念边界

| 概念                              | 含义                                                     | 本期                                            |
| --------------------------------- | -------------------------------------------------------- | ----------------------------------------------- |
| 桌面打包                          | `packages/desktop/scripts/bundle.mjs` → electron-builder | 实现                                            |
| GitHub Release 附件               | tag `v*` 构建成功后挂到该 tag 的 Release                 | 实现                                            |
| macOS 公证 / stapler              | build 之后的独立阶段                                     | 不做；`electron-builder` 保持 `notarize: false` |
| Windows Authenticode              | `CSC_LINK` 等 electron-builder 标准证书                  | 不做强制；未配置则未签名                        |
| CLI / SEA / `pnpm build:zcode`    | 另一条发行物                                             | 不在本流水线                                    |
| 远程 workspace 资产（`mock-cdn`） | `prepare:remote-assets`                                  | 默认跳过，缩短 GitHub 托管 runner 耗时          |

## 状态所有者

| 状态                      | 所有者                                                                                             |
| ------------------------- | -------------------------------------------------------------------------------------------------- |
| 安装包内容与校验          | `packages/desktop/scripts/bundle.mjs`（prepare → build → electron-builder → asar 校验 → 体积审计） |
| 产品身份 / 文件名后缀     | `desktop-product-identity.mjs`（`ZCODE_ENV`、`ZCODE_PREVIEW_IDENTITY`）                            |
| 版本号                    | 根目录 `package.json`，由 `pnpm release` 打 `v${version}` tag                                      |
| 跨平台构建编排            | `.github/workflows/desktop-pack.yml`                                                               |
| 安装包分发                | GitHub Actions artifact；tag 构建再写入 GitHub Release                                             |
| 更新清单（`latest*.yml`） | `packages/desktop/scripts/generate-update-manifests.mjs`（release job 生成）                       |

流水线不拥有应用运行时状态，也不改 electron-builder 的 generic publish URL：运行时更新源由客户端按 `specs/desktop-update-source.md` 解析，打包产物里的占位 feed 不参与更新。

## 触发

- 手动：`workflow_dispatch`，可选择 `ZCODE_ENV` 与是否使用 Preview 身份。
- 发布：推送 `v*` tag（与 `.release-it.mjs` 的 `tagName: v${version}` 对齐）。此时固定 `ZCODE_ENV=production`、正式身份。

不在每次 `main` 提交上自动打包。

打包时注入 `ZCODE_UPDATE_GITHUB_REPO=${{ github.repository }}`，安装包因此把发行仓库记为更新源；fork 不需要改代码或配置。

## 矩阵

每个组合使用**目标 OS 的原生 runner**，禁止 Linux 交叉编 Windows/macOS。`node-pty` 在非 Windows 上会 `electron-rebuild`，必须与目标平台一致。

| 目标        | Runner                                    | 命令                                             | 输出目录                      |
| ----------- | ----------------------------------------- | ------------------------------------------------ | ----------------------------- |
| mac arm64   | `macos-15`                                | `pnpm bundle:desktop -- --os mac --arch arm64`   | `packages/desktop/dist-arm64` |
| mac x64     | `macos-15-intel`（Intel / larger runner） | `pnpm bundle:desktop -- --os mac --arch x64`     | `packages/desktop/dist-x64`   |
| win x64     | `windows-latest`                          | `pnpm bundle:desktop -- --os win --arch x64`     | `packages/desktop/dist-x64`   |
| win arm64   | `windows-11-arm`                          | `pnpm bundle:desktop -- --os win --arch arm64`   | `packages/desktop/dist-arm64` |
| linux x64   | `ubuntu-22.04`                            | `pnpm bundle:desktop -- --os linux --arch x64`   | `packages/desktop/dist-x64`   |
| linux arm64 | `ubuntu-22.04-arm`                        | `pnpm bundle:desktop -- --os linux --arch arm64` | `packages/desktop/dist-arm64` |

并行 job 必须设置 `ZCODE_DESKTOP_DIST_DIR`，避免 electron-builder 清空彼此的 `.app` / unpacked 目录。mac x64 必须跑在 Intel runner 上：Apple Silicon 上打出的 x64 包会带上 host 架构的 `node-pty`。若仓库没有 `macos-15-intel` 权限，该 job 会失败，其余平台因 `fail-fast: false` 仍会出包。

`fail-fast: false`：单一平台失败不取消其余平台。tag 发布要求矩阵全部成功。

## 构建环境

- Node `24.14.0`、pnpm `10.33.2`（与 `mise.toml` 一致）。
- `pnpm install --frozen-lockfile`，不要跑 `pnpm bootstrap`。
- `HUSKY=0`。
- `ZCODE_SKIP_REMOTE_ASSETS=1`。Windows 安装包不依赖 `mock-cdn`；GitHub 托管 runner 上全平台默认跳过，避免远程资源下载把 job 拉到超时。
- `ZCODE_ENABLE_WINDOWS_BROWSER_IMPORT` 保持未开启。
- GitHub 托管 runner 使用官方 Electron / electron-builder-binaries 下载地址，不依赖 npmmirror。
- `ELECTRON_CACHE`、`ELECTRON_BUILDER_CACHE`、`TMPDIR`/`TEMP` 落在工作区内，跨 run 缓存下载件。
- Linux job 安装 `rpm`、`cpio`、`fakeroot`、`dpkg`、`xz-utils`、`libarchive-tools`、编译工具链；AppImage 设置 `APPIMAGE_EXTRACT_AND_RUN=1`。
- Windows 打开 `core.longpaths`。
- `CSC_IDENTITY_AUTO_DISCOVERY=false`，避免 runner 钥匙串里的无关证书让未签名构建失败。

## 产物

electron-builder 目标保持现有配置：

| OS    | 文件                                        |
| ----- | ------------------------------------------- |
| mac   | `.dmg`、`.zip`                              |
| win   | NSIS `.exe`                                 |
| linux | `.AppImage`、`.deb`、`.rpm`、`.pkg.tar.zst` |

文件名仍由 `electron-builder.config.js` 生成：`${productName}-${version}-{mac\|win\|linux}-${arch}[_TEST].${ext}`。

上传这些安装包与同名 `*.blockmap`；不上传 unpacked 目录，也不上传 electron-builder 生成的、
指向 `http://localhost:8081` 的 updater yml。

## 更新清单

Release 里额外发布由 `packages/desktop/scripts/generate-update-manifests.mjs` 现场生成的
`latest.yml` / `latest-mac.yml` / `latest-linux.yml`，桌面端以它们判断新版本、产物地址与 sha512。

- 生成发生在 release job（所有平台产物已汇总到 `dist/`），因此每个平台只有一份清单，
  不会被各架构 job 的同名产物互相覆盖；`files[]` 里同时列出该平台全部架构。
- 生成脚本只用 Node 内置模块，release job 不跑 `pnpm install`。
- 清单与文件名规则、渠道规则、推送预发布版本的要求见 `specs/desktop-update-source.md`。

## 失败语义

- `bundle.mjs` 非 0 退出 → job 失败。
- 找不到对应扩展名的安装包 → 上传步骤失败。
- 矩阵中任一平台失败 → tag 不创建/不更新 Release。
- 清单生成失败（缺 `--tag`、无可用产物、产物文件名含空格等非 URL 安全字符） → release job 失败，不发布半套 Release。
- 证书类 secret 未配置 → 继续打未签名包，不算失败。
- 不在 build job 上设置 `APPLE_APP_SPECIFIC_PASSWORD`，避免 electron-builder 在 DMG 生成前尝试公证。

## 验收

1. 在 GitHub 上手动运行 `Desktop Pack`，六个矩阵 job 各自上传对应安装包 artifact。
2. 推送或存在 `v*` tag 时，六个 job 成功后 Release 附带全部安装包、`*.blockmap` 与三个平台的 `latest*.yml`。
3. 本地 `pnpm bundle:desktop -- --help` 与 README 中的流水线说明一致：入口仍是 `pnpm bundle:desktop`。
4. 未配置 Apple/Windows 证书时，macOS/Windows job 仍能完成（未签名）。
5. tag 带预发布后缀（如 `v3.15.0-preview.1`）时，新建的 Release 标记为 prerelease，正式渠道客户端不会收到它。
