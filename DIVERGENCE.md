# 与上游的分叉记录

本仓库 fork 自 [zai-org/ZCode](https://github.com/zai-org/ZCode)，不回流上游。这份文档只服务一件事：
**合并上游新版本时，快速判断每个冲突该保留哪一侧。**

各项改动的设计细节在 `specs/` 下，本文不重复，只给判断规则。

## 上游信息

| 项               | 值                                                             |
| ---------------- | -------------------------------------------------------------- |
| 上游仓库         | `https://github.com/zai-org/ZCode.git`（remote 名 `upstream`） |
| 共同祖先         | `872ad96` "feat: open source"                                  |
| 已合入的上游版本 | v3.14.3（`29628c9`，2026-09-23）                               |

**上游的发布方式是整版本 dump**：开源仓库里一个版本只有一个提交（v3.14.3 一次改 283 个文件），
内部开发历史不公开。因此**无法 cherry-pick 单个修复**，只能整版本合并；只想要某个修复时，
只能自己从 diff 里挑代码手工搬。

## 同步流程

```bash
git fetch upstream --tags
git switch -c sync/upstream-<版本号>
git merge upstream/main
# 按下面的「分叉清单」解冲突
git checkout --ours pnpm-lock.yaml && pnpm install   # lock 的自动合并结果不可信，必须重新生成
pnpm typecheck && pnpm lint && pnpm architecture:check --changed
node --import tsx --test $(git ls-files '*.test.ts' | grep -v node_modules)
# 验证通过后合回 main（用 --no-ff 保留同步点）
```

用 **merge 而不是 rebase**：rebase 会重写本仓所有提交，且每个提交都要重解一遍同样的冲突。

仓库已开启 `rerere`（`git config rerere.enabled true`），v3.14.3 的 6 处冲突解法已记录，
下次相同位置会自动复用。**新 clone 需要重新开启，rerere 记录不随仓库分发。**

版本号策略：目前**跟随上游**（`package.json` 每次必冲突，直接取上游值）。

## 分叉清单

### 1. 删除智谱账号体系与套餐/额度/闲时

相关 spec：[client-login-removal.md](specs/client-login-removal.md)

删掉了客户端登录、WelcomeScreen、Coding Plan 套餐、用量额度、闲时任务、配额重置等整条链路，
共约 110 个文件。涉及的命名：`codingPlan*`、`*Quota*`、`offPeak*`、`usageEntitlement*`、
`startPlan*`、`useOAuth`、`purchase.*`（i18n key）。

**冲突判断规则：**

- 上游新增/修改带上述命名的代码 → **不接**。先确认对应组件文件在本仓是否还存在，
  不存在就直接丢弃该 import 或 JSX 块。
- 自动合并"成功"但引用了本仓已删除的模块 → git 不会报冲突，靠 `pnpm typecheck` 兜住。
- i18n 的 `purchase.*` / 套餐相关 key → 丢弃。

### 2. Provider 级认证抽象

相关 spec：[provider-auth.md](specs/provider-auth.md)

认证凭据从全局客户端 `user` 改为归属具体 provider（`provider-auth:xai` 等），
新增 xAI SuperGrok 设备码登录与订阅用量。智谱 Z.ai/BigModel 账号也改走这套抽象。

新增：`packages/services/src/provider-auth/`、`packages/provider-node/src/provider-auth/`、
`packages/shared/src/provider-auth.ts`、`packages/ui/src/hooks/useProviderAuth*.ts`。

**冲突判断规则：**

- 上游对旧 `user` / OAuth 全局登录的改动 → **不接**，本仓已换成 provider 维度。
- `OfficialMcpCredentialResolverDeps` 在本仓只保留 `credentialService`，
  上游若继续传 `accountRequestAuthService` / `modelSelectionService` → 删掉多余实参。
- 模型设置页分「预置 / 自定义」两段（`presetProviderCatalog.ts`），与上游的分组逻辑不同。

### 3. 电脑控制改由 Kimi Computer Use 提供

相关 spec：[computer-use-kimi.md](specs/computer-use-kimi.md)

上游的 `@zcode/zcode-cua` 是占位包（全部返回不可用），本仓换成 Kimi CU，
支持 macOS（含 Intel）/ Windows，设置页可安装与授权，KimiCU 未安装时隐藏技能。

新增：`apps/zcode-cli/packages/computer-use-plugin/`、
`packages/services/src/kimi-computer-use/`、
`apps/zcode-cli/packages/bootstrap/src/app/computer-use-skill-gate.ts`、
`packages/desktop/src/main/{macos,windows}ComputerUsePreview.ts`。

**冲突判断规则：**

- `collectComputerUseUnavailableSkillPaths` 是本仓独有的技能剔除钩子，
  合并 `create-app.ts` 时**必须保留**，不要被上游的 import 块覆盖掉。
- 上游若给占位包补功能 → 评估后多半不接，本仓走的是另一套实现。

### 4. 桌面端打包与更新源改为本仓 GitHub Releases

相关 spec：[desktop-github-packaging.md](specs/desktop-github-packaging.md)、
[desktop-update-source.md](specs/desktop-update-source.md)

打包走 GitHub Actions（`.github/workflows/desktop-pack.yml`），更新源指向本仓 Releases，
mac 包改 ad-hoc 签名、更新改为退出后自替换 `.app`。

新增：`packages/desktop/src/main/{updateSource,macSelfInstall,macSelfInstallUpdater}.ts`、
`packages/desktop/scripts/generate-update-manifests.mjs`。

**冲突判断规则：**

- 上游对官方更新服务端、签名、发布流程的改动 → **不接**。
- `electron-builder.config.js`、`autoUpdater.ts` 每次都可能冲突，以本仓为准。

### 5. 工作区显示别名

相关 spec：[workspace-display-alias.md](specs/workspace-display-alias.md)

本仓新增功能，上游没有。别名只影响展示，不改 `workspaceIdentity`。

## 高冲突文件

v3.14.3 合并时与上游改动重叠 28 个文件，其中 6 个真冲突。下面这些是反复被两边同时改的，
改动本仓代码时值得多留一份心：

| 文件                                                      | 原因                                   |
| --------------------------------------------------------- | -------------------------------------- |
| `package.json`                                            | 版本号，每次必冲突                     |
| `pnpm-lock.yaml`                                          | 自动合并结果不可信，一律重新生成       |
| `packages/ui/src/i18n/locales/{zh-CN,en-US}.ts`           | 文案条目增删                           |
| `packages/ui/src/hooks/useSettingService.ts`              | 本仓重构过签名，上游持续往里加服务依赖 |
| `packages/ui/src/WorkspaceSidebarFooter.tsx`              | 本仓删了套餐 UI 与相关 props           |
| `apps/zcode-cli/packages/bootstrap/src/app/create-app.ts` | 装配层，两边都在加 gate                |
| `packages/services/src/node.ts`                           | 服务装配，上游持续新增服务注册         |

降低后续成本的做法：自有改动尽量落在**新文件或适配层**，不直接改上游文件。

## 合并历史

### v3.14.3（`2442dfa`）

上游带来：动态工作流（`builtin-workflow-command`、`workflow-seat-gate`、`dynamic-workflow-run-*`）、
飞书/微信机器人（`BotsService`、`BotsDialog`，新增依赖 `@larksuiteoapi/node-sdk`）、
Web 远程控制入口（`WorkspaceWebRemoteControlTrigger`、`WebRemoteControlDialog`）。

需要记住的两个判断：

- 上游把 `/workflow` 的灰度减法移到了 `builtin-prompt-command.ts`，
  本仓自建的 `DYNAMIC_WORKFLOW_GATED_COMMAND_NAMES` 因此删除——上游的新机制已覆盖该需求。
- 上游的 Web 远控入口需要 `workspacePath` / `workspaceIdentity`，
  而这两个 props 早先随套餐用量摘要一起被删掉了，合并时补了回来。
  这类问题 git 不报冲突，只能靠 `pnpm typecheck` 发现。
