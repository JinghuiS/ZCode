# 桌面更新源：GitHub Releases

## 目标

分叉发行后，桌面端的「检查更新 → 提示 → 下载 → 安装」全部以本仓库的 GitHub Releases 为准：

- 更新清单（`latest.yml` / `latest-mac.yml` / `latest-linux.yml`）作为 Release 资产发布，不再依赖官方服务端 manifest 接口；
- 版本比较、release notes、下载地址都来自该 Release；
- 启动期强制升级 gate 不再读取官方 `/api/v1/client/configs`，避免分叉版本落后官方时把用户推向官方安装包。

官方服务端 manifest 路径保留为 `service` 更新源，用于联调与回退，不作为默认值。

## 概念边界

| 概念          | 含义                                                                | 所有者                                                                 |
| ------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 更新源        | `github` / `service` 二选一                                         | `packages/desktop/src/main/updateSource.ts`                            |
| 更新清单      | 每个平台一个 electron-updater YAML，列出该平台全部架构产物与 sha512 | `packages/desktop/scripts/generate-update-manifests.mjs`（发布侧生成） |
| Release 资产  | 安装包 + 清单 + blockmap                                            | `.github/workflows/desktop-pack.yml` 的 release job                    |
| 更新状态机    | checking / available / downloading / downloaded，与 renderer 的载荷 | `packages/desktop/src/main/autoUpdater.ts`                             |
| 强制升级 gate | 启动前最低版本校验                                                  | `packages/desktop/src/main/forceUpdateGuard.ts`                        |

更新源只决定「从哪里取版本与产物」，不改变 electron-updater 的下载、校验、安装流程，也不改变 renderer 侧的弹窗状态机。

## 更新源解析

解析顺序（前者优先，同一层里显式的更新源类型优先于仓库取值）：

1. `ZCODE_UPDATE_FEED_URL` 环境变量或 `--zcode-update-feed-url` 启动参数：仍表示 `service` + 该 manifest URL。仅在未打包构建生效，打包版忽略（沿用既有行为）。
2. `ZCODE_UPDATE_SOURCE` 环境变量：`github` 或 `service`；其它取值忽略并记录警告。
3. `ZCODE_UPDATE_GITHUB_REPO` 环境变量：`owner/repo` 或 GitHub 仓库 URL，等价于选择 `github`。
4. 构建期注入的 `__ZCODE_UPDATE_SOURCE__`。
5. 构建期注入的 `__ZCODE_UPDATE_GITHUB_REPO__`（CI 用 `${{ github.repository }}` 注入，任何 fork 无需改代码）。
6. 兜底：`github` + `DEFAULT_UPDATE_GITHUB_REPO`。

`ZCODE_UPDATE_SOURCE=service` 必须能压过 CI 注入的仓库值，回退时不需要重新打包。

## 更新清单与产物选择

发布侧按 tag 生成清单，只描述该平台实际存在的产物：

- `latest-mac.yml`：`.zip`（Squirrel.Mac 只认 zip；`.dmg` 不参与自动更新）；
- `latest.yml`：NSIS `.exe`；
- `latest-linux.yml`：`.AppImage`、`.deb`、`.rpm`、`.pkg.tar.zst`。

规则：

- `files[]` 列出该平台**所有架构**的产物，文件名含 `arm64` / `x64`；electron-updater 的 `findFile` 按 `process.arch` 在文件名里匹配，因此一台机器只会拿到同架构产物。
- 架构名必须是 `process.arch` 取值（`x64` / `arm64`）。electron-builder 的 `${arch}` 宏在 Linux 上会改写成 `x86_64` / `amd64` / `aarch64`，客户端匹配不到就会退回第一个文件而装错架构；因此 Linux 的 `artifactName` 直接写目标架构，清单脚本也会跳过非 `process.arch` 写法的产物。
- 每个条目带 `sha512`（base64）与 `size`；存在 `<产物>.blockmap` 时额外写 `blockMapSize`，用于差分下载。
- 顶层 `path` / `sha512` 指向该平台的首选产物（mac = zip、win = exe、linux = AppImage），兼容只读旧字段的客户端。
- 资产文件名必须是 URL 安全字符集：GitHub provider 解析下载路径时会把空格替换成 `-`，含空格的文件名会 404。生成脚本遇到不安全文件名时跳过该文件并告警，不产出该平台的清单。
- 版本号取 tag 去掉 `v` 前缀；同一 Release 内多 job 产物由单一 release job 合并生成，避免每个架构各自写同名清单互相覆盖。

## 渠道：只发正式版

- 分叉发行只使用正式版：GitHub 更新源固定 `autoUpdater.allowPrerelease = false`，只读 `/releases/latest`，不随「接收 preview 版本」设置变化。
- 必须显式关掉：electron-updater 在当前版本带预发布后缀时会默认打开 `allowPrerelease`，此时 GitHubProvider 只匹配同名预发布 tag，正式版永远选不中。
- 误打的预发布 tag（如 `v3.15.0-rc.1`）会被 CI 标为 GitHub prerelease，客户端不会收到它。
- 清单文件名始终是 `latest*`。

## 版本判定依据

- 本地版本：已安装包内 `package.json` 的版本，即打包时根目录 `package.json` 的 `version`（electron-updater 读 `app.getVersion()`）。
- 远端版本：该 Release 的 `latest*.yml` 里的 `version`，由发布侧按 tag 写入（`v3.14.0` → `3.14.0`）。
- 判定：`semver.gt(远端, 本地)` 且不是用户跳过的版本；相等或更低不提示（不允许降级）。因此 **tag 与打包时 `package.json` 版本必须一致**（`pnpm release` 保证这一点），否则会出现「装的是 tag 版本、清单里却是另一个版本」的错位。
- 已下载待安装的版本（ready）另有一层比较：远端版本不高于 ready 版本时保留已下载的包，不重复下载。
- 开发态用 `ZCODE_AUTO_UPDATE_DEV` 才启用检查，并可用 `ZCODE_AUTO_UPDATE_DEV_VERSION` / `--zcode-auto-update-dev-version` 覆盖本地版本，用来复现升级流程。

## 强制升级 gate

- `service` 更新源：保持读取服务端 `/api/v1/client/configs`（行为不变）。
- `github` 更新源：默认不读取官方配置，跳过启动强更校验并记录 info 日志。
- 分叉若仍需强更，设置 `ZCODE_FORCE_UPDATE_CONFIG_URL` 指向自持的配置地址，响应结构与官方一致（`{ code: 0, data: { configs: { forceUpdate: { minimalVersion } } } }`）；地址不可用时沿用既有的「离线跳过」语义。
- 强更弹窗的「手动升级」按钮在 GitHub 更新源下打开 `https://github.com/<owner>/<repo>/releases`，不再打开官方下载页。

## 失败语义

- 仓库地址写错（格式非法）：记录 warn 并回退到兜底仓库，不切回官方服务端源，不阻断启动。
- 更新源类型取值非法：记录 warn 并忽略该项，继续按后续优先级解析。
- Release 缺少清单或产物：electron-updater 报错，手动检查更新返回 `error`，不做静默降级到官方源。
- 清单缺 sha512：不允许下载（electron-updater 直接拒绝），发布侧必须在生成阶段补齐。
- 强更配置地址请求失败：跳过强更校验（既有行为）。

## 验收

1. 打 `v*` tag 后 Release 资产包含六个平台的安装包、`latest*.yml`，以及存在的 `*.blockmap`。
2. 已安装的正式包在下一版本 Release 发布后，菜单「检查更新」提示新版本，弹窗标题/发布时间/更新说明来自该 Release 正文。
3. 点击「下载更新」从 GitHub Release 资产下载，校验 sha512 通过；Windows 与 Linux 能完成安装。
4. 弹窗「查看发布页面」在状态带 `releaseUrl` 时打开 `https://github.com/<owner>/<repo>/releases/tag/<tag>`。
5. 无论 `receivePreviewUpdates` 取值如何，客户端都不会收到标记为 prerelease 的版本。
6. `ZCODE_UPDATE_SOURCE=service` 的构建仍走服务端 manifest，`ZCODE_UPDATE_FEED_URL`（未打包）仍可覆盖 manifest URL。
7. `github` 更新源的构建不再请求 `zcode.z.ai/api/v1/client/configs`。

## 未覆盖

- macOS 未签名包：Squirrel.Mac 校验代码签名，未签名构建即使下载成功也无法自动安装。该场景以「查看发布页面」手动下载为准，签名与公证见 `specs/desktop-github-packaging.md`。
- 差分下载只在本地缓存中存在上一版安装包时生效，否则回落全量下载。
