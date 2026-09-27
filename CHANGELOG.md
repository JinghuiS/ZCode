# Changelog

## [3.16.0](https://github.com/JinghuiS/ZCode/compare/v3.15.0...v3.16.0) (2026-09-27)

### Features

* **services:** 新增只读 getCommitChanges 取提交文件清单 ([653e4bd](https://github.com/JinghuiS/ZCode/commit/653e4bdf0744af0da2f3726b62ed6dd95cd64ea1))
  * 对比基线是第一个父提交，根提交用 diff-tree --root 按空树对比，合并提交因此展示合并带进第一父分支的文件而不是空清单。
  * commit hash 经 normalizeCommitHash 限制为十六进制对象名，避免传入的字符串被 git 当作选项或 ref 表达式解析。
  * 抽出的 GitNumstatChange 与 toNumstatChanges 同时供分支比较和提交清单复用。

* **ui:** Git 图谱提交行内展开文件清单 ([e33667f](https://github.com/JinghuiS/ZCode/commit/e33667f6561bf4849c99bbd5211e6a64825f64ce))
  * 展开高度回传给 layoutGitGraph 的 rowGaps，展开行之后的提交与泳道一起下移，连线终点仍是各自提交的位置。
  * 清单按 hash 不可变，在 useGitCommitChanges 内按 scope 与 hash 缓存，切走提交时用请求版本丢弃 late resolve 的旧响应，失败不写缓存以便重试。
  * 图谱的取数与分页抽成 useGitCommitGraph，侧栏历史区块与 GitGraphDialog 共用，两者各自持有选中与分页，不互相同步。
  * GitGraphDialog 补 workspaceIdentity 与 remoteSessionId 透传，并接回自己的标题行与刷新按钮。
  * 新增 packages/ui 的 test script，覆盖提交清单汇总与行间距布局。

* **ui:** Git 面板进侧栏并接入项目级区块手风琴 ([c7c7c84](https://github.com/JinghuiS/ZCode/commit/c7c7c847606607227b4d2cedf0e637e9c97d0b96))
  * Git tab 在创建时冻结 workspaceKey、workspacePath、workspaceIdentity 与 remoteSessionId，GitPane 与 GitGraphPane 的 scope 一律取自 tab 自身；项目隔离仍由 side pane 记忆分桶提供，tab id 保持单例。
  * 变更在上、历史在下，两个区块是手风琴：展开一个即折叠另一个，展开的占满剩余高度，两个都折叠也合法。折叠态是 tab 的事实，由 setGitSidePaneSectionCollapsed 唯一实现，重开已存在的面板继承既有折叠态。
  * 来源选择、刷新与 GitActionMenu 提交入口随变更区块一起出现；历史展开时这一行不占高度，图谱拿到整块面板。
  * 历史区块折叠时不取数，展开时重新拉第一页；刷新图标贴在区块标题行右侧，图谱本体不再有二级标题行。
  * 侧栏 launcher「审查」项补未提交变更数徽标，复用 getGitDirtyFileCount。


### Documentation

* 补充项目级 Git 侧栏面板 spec ([ed359e2](https://github.com/JinghuiS/ZCode/commit/ed359e27b306a750be386a5d870db520b8671a6a))

## [3.15.0](https://github.com/JinghuiS/ZCode/compare/v3.14.2...v3.15.0) (2026-09-25)

### Features

* update v3.14.3 ([29628c9](https://github.com/JinghuiS/ZCode/commit/29628c9acdb81b703bbd4080c207a0e7ce5e276e))
  * The concurrency limit of a running workflow can now be adjusted directly, without stopping the task.
  * Optimized the reuse logic when modifying and restarting workflows.
  * Improved the real-time status display for large workflows.
  * Improved the efficiency of workflow script submission and modification, reducing token consumption.
  * Fixed an issue where workflows could cause the interface to crash in some cases.
  * Fixed an issue where buttons on workflow cards were sometimes pushed out of the interface.
  * Fixed an issue where the workflow tool took up too much context.


### Bug Fixes

* **desktop:** 自动更新退出被窗口吞掉时补硬退出兜底 ([f2bcc65](https://github.com/JinghuiS/ZCode/commit/f2bcc653a0a5ff6193909a938357044f046e6944))

* **services:** 官方 MCP 凭证解析不再传已移除的账号依赖 ([872854d](https://github.com/JinghuiS/ZCode/commit/872854d5db20352fb402558bc862a322d41564fc))


### Documentation

* 修正 DIVERGENCE.md 的测试命令 ([9fba630](https://github.com/JinghuiS/ZCode/commit/9fba630168d5d9226980814d17fa5a40e93e7343))

* 补充与上游 fork 的分叉记录 ([7bf26a2](https://github.com/JinghuiS/ZCode/commit/7bf26a282385e45b9db793ada56dfdd27876d1f7))
