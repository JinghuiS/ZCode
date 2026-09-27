# 项目级 Git 侧栏面板

## 行为

右侧侧栏提供每个项目自己的 Git 面板。面板内「变更」在上、「历史」在下，两个区块是手风琴：最多一个展开，展开的那个占满剩余高度。变更区块承载暂存、丢弃与提交；历史区块展示该项目的提交图谱。缺省为变更展开、历史折叠，历史折叠时也不取图谱数据。

点折叠区块的标题即展开它并折叠另一个区块，所以历史不需要拖拽就能拿到整块高度。两个都折叠也是合法状态，此时面板只剩两个标题。

来源选择、刷新与提交入口都是对变更本身的操作，随变更区块一起出现：面板顶部不再有独立工具栏，历史展开时这一行不占高度。

历史区块里不再出现「Git Graph」这类二级标题：区块标题已经说明了它是什么，图谱本体只留列头与提交列表，刷新图标贴在区块标题行右侧（折叠时不显示，因为折叠状态不取数）。

打开 Git 面板不依赖会话状态面板，不依赖该项目是否为外壳（shell）工作区。

本 spec 不包含 fetch / pull / merge / rebase / stash；合并链路单独立项。

side pane 记忆已按项目身份分桶（`buildTaskSidePaneMemoryKey` 返回 `workspaceIdentity?.trim() || workspacePath`），切换项目时恢复该项目自己的 tab 集合。Git tab 的单例 id 因此不会让两个项目互抢，项目隔离在记忆层已经成立；本 spec 不改这一层。

## 历史区块的提交行内展开

展开某次提交时，该提交所在行下面直接插入一块行内展开：完整 hash、父提交，以及该次提交改动的文件清单（文件数、增删行合计、逐文件的 workspace 相对路径、重命名来源与 +/- 行数）。展开块属于提交列表，跟着列表一起滚动，不在面板底部另占一块固定高度。

- 展开高度回传给图谱布局（`layoutGitGraph` 的 `rowGaps`）：展开行之后的提交行与泳道一起下移，连线终点仍是各自提交的位置。
- 对比基线：提交相对其第一父提交；根提交对比空树；合并提交因此展示合并带进第一父分支的文件，而不是空清单。
- 清单只读：不提供单文件 diff，不写 Git，不动工作区。查看某次提交内某个文件的 diff 另行立项。
- 提交的文件清单按 hash 不可变，hook 内按 hash 缓存；重复展开同一提交不再取数。
- 清单按 workspace 作用域裁剪：workspace 是仓库子目录时，不展示该目录之外的文件，与「变更」「分支」两个来源一致。

同一份清单在侧栏历史区块与 `GitGraphDialog` 都可见：两者复用同一个 `GitGraphPane`，各自按自己的 scope 取数，不互相同步选中、展开或滚动位置。

### 所有权

| 事实           | 所有者                                                                            | 写入                             | 持久化   |
| -------------- | --------------------------------------------------------------------------------- | -------------------------------- | -------- |
| 展开的提交     | `GitGraphPane` 局部状态                                                           | 点击提交行切换展开               | 不持久化 |
| 提交文件清单   | `useGitCommitChanges`（hook 内按 scope 与 hash 取数+缓存）                        | 展开提交时取数                   | 不持久化 |
| 提交行展开高度 | 展开块自量后回传 `GitGraphPane`（只喂给图谱布局）                                 | 展开块挂载与内容/宽度变化        | 不持久化 |
| 区块 scope     | `GitGraphPane` 的 `workspacePath` / `workspaceIdentity` / `remoteSessionId` props | 由 GitPane / GitGraphDialog 传入 | 不持久化 |

取数走新增的只读方法 `IGitService.getCommitChanges`（`git diff --numstat`），不新增 Git 写操作；远程项目复用同一 `IGitService` RPC 与 `remoteSessionId` 透传。

## 现状缺口

| 缺口                                                                                                                                                                     | 位置                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Git 面板内没有提交入口，提交只在会话状态面板的 `GitActionMenu` 里                                                                                                        | `packages/ui/src/GitPane.tsx`                                                      |
| tab 不带 `workspacePath` / `workspaceIdentity` / `remoteSessionId`，`GitPane` 读外壳变量；侧栏记忆由 effect 在 render 之后切换，切项目当帧会用新项目路径渲染旧项目的 tab | `packages/ui/src/app-shell/AnimatedSidePanePanel.tsx`                              |
| launcher 入口名为「审查」且无变更数提示，用户按 Git 找不到                                                                                                               | `packages/ui/src/app-shell/AnimatedSidePanePanel.tsx`                              |
| `GitGraphPane` 已按 Pane 设计并从包入口导出，却只被 `GitGraphDialog` 使用，侧栏内无历史区块                                                                              | `packages/ui/src/git-graph/`                                                       |
| 提交详情只给出主题/作者/日期/父提交，看不到该次提交改了哪些文件；服务层也没有按提交取文件清单的只读方法                                                                  | `packages/ui/src/git-graph/GitGraphCommitDetail.tsx`、`packages/services/src/git/` |

| 提交详情是面板底部的固定块，文件清单挤在里面吃掉图谱高度；两个区块靠拖拽分隔条分配高度，历史拉不到整块高度 | `packages/ui/src/git-graph/GitGraphPane.tsx`、`packages/ui/src/GitPane.tsx` |

## 所有权

| 事实         | 所有者                                                                                | 写入                   | 持久化                      |
| ------------ | ------------------------------------------------------------------------------------- | ---------------------- | --------------------------- |
| Git tab 身份 | tab 自带 `workspaceKey` / `workspacePath` / `workspaceIdentity?` / `remoteSessionId?` | tab 创建时冻结，不后补 | workspace 级 side pane 记忆 |
| Git 仓库状态 | 外壳单份 `useGitRepository`（当前项目）                                               | `refresh` / 变更后回写 | 不持久化                    |
| 变更数徽标   | 由该 scope 的 `GitRefreshResult` 派生                                                 | 不单独写入             | 不持久化                    |
| 区块展开状态 | Git tab 的 `changesCollapsed` / `historyCollapsed`（互斥，最多一个展开）              | 点击区块标题           | 随 side pane 记忆           |

Git tab 沿用单例 id `"git"`：项目隔离由 side pane 记忆的分桶提供，tab id 不重复承载这件事。tab 上的 `workspaceKey` 等字段是创建时冻结的身份快照，供渲染与关闭时比对，不作为隔离手段。

`GitPane` 与 `GitGraphPane` 的 workspace 身份一律取自 tab 自身，不再读外壳的 `workspaceAbsPath` / `workspaceIdentity` / `workspaceRemoteSessionId`，比照 `PlanDetailSidePane` 按 scope 路由、不做外壳身份分支的既有做法。

Git 仓库状态仍由外壳单份 `useGitRepository` 持有：侧栏 tab 恒属当前项目，外壳那份就是该项目的状态，不另开第二份取数，避免同项目重复 `git status` 与重复 watcher。

## 范围外

`WorkbenchPane` 用 `isShellWorkspace` 决定状态面板是否拿到 Git 数据，这是与「外壳单份 Git 状态」配套的正确保护：分屏里非当前项目的 pane 若复用外壳那份，展示的就是别的项目的 Git 事实。让这类 pane 也有 Git 区块需要 per-pane 取数，与本 spec「不开第二份取数」冲突，另行立项，本轮不动这道判断。

## 入口

- 侧栏 tab launcher 的「审查」项即 Git 面板入口，补未提交变更数徽标（去重后的文件数，复用 `getGitDirtyFileCount`）；已打开时该项按既有规则从 launcher 隐去。
- 变更区块内嵌 `GitActionMenu`（与来源选择、刷新同一行）：提交入口过去只在会话状态面板，打开 Git 面板反而无法提交。复用同一个组件，不另建提交对话框。
- 会话状态面板的 Changes 行保留，行为不变。
- 分支切换器菜单底部的「Git 图谱」与 `GitGraphDialog` 保留，作为全屏查看图谱的独立入口；图谱本体不再自带标题行，对话框自己渲染标题与刷新。

侧栏历史区块与 `GitGraphDialog` 复用同一个 `GitGraphPane` 组件，并按各自的 scope 取数。两者是同一事实的两个展示入口，不各自持有提交图谱状态，也不互相同步折叠或选中状态。

## 迁移

无。tab id 不变，旧记忆可直接恢复。`workspaceKey` 与 `workspacePath` 在 tab 上是必填：side pane 记忆是 module-level `Map`（`taskSidePaneMemory`），不落盘、不跨进程存活，所以不存在缺字段的历史 tab。折叠字段改用手风琴语义后：同进程里已经开着的旧 tab 若两个区块都展开，下一次点击任一标题即收敛到「只剩一个展开」；`ResizablePanelGroup` 的 `git-pane-sections` 高度比例不再读写，残留的 `localStorage` 键成为死数据。

## 不变量

- 身份 key 统一为 `workspaceIdentity?.trim() || workspacePath`；`workspacePath` 仍是 cwd、Git 命令与路径展示的唯一来源。
- 一个项目最多一个 Git tab；重复打开为激活，不新建，且不重置已有折叠态。
- 项目隔离只由 side pane 记忆分桶提供，不在 tab id 或渲染分支里重复实现。
- 折叠是 tab 的事实，手风琴互斥由 `setGitSidePaneSectionCollapsed` 唯一实现；面板不使用库的 collapse，渲染层不再各自推导「另一个区块该不该收」，也不保留第二条展开状态。
- 行内展开高度是展示事实：只用于把展开行之后的泳道下移，不写回 tab、不持久化、不参与取数。
- 变更数徽标是展示投影，不得作为提交或刷新的判据。
- 不新增 Git 写操作；提交、暂存、丢弃、推送仍走既有 `IGitService` 方法。
- 远程项目复用既有 `IGitService` RPC 注册与 `remoteSessionId` 透传，不为侧栏另建链路。
- 手机远控复用桌面已有 attachment，不另起 Host 或会话。

## 验收

1. 在项目 A 打开 Git 面板后切到项目 B，面板展示 B 自己的变更与分支；切换当帧不出现 A 的 tab 配 B 的路径。
2. 侧栏 Git 入口在当前项目是 Git 仓库时可点，非仓库时给出明确空态而非灰掉无反馈。
3. 侧栏 Git 入口的变更数徽标随文件改动刷新；徽标为 0 时入口仍可打开。
4. 两个区块是手风琴：点历史即收起变更并让历史占满面板高度，点变更回到变更展开；两个都折叠合法，此时面板只剩两个标题。
5. 展开的区块占满剩余高度，展开状态在重开 tab 后保持；面板不再有拖拽分隔条与高度比例记忆。
6. 分支菜单的「Git 图谱」仍弹出对话框，与侧栏历史区块展示同一项目的同一份图谱。
7. 本机与 SSH 打开同一路径时，两个 Git 面板各自独立。
8. 旧 side pane 记忆恢复后 Git tab 仍在原位，其余 tab 的顺序与激活项不受影响。
9. 提交、暂存、丢弃、推送与生成提交消息的行为与改前一致。
10. 同一项目下不因侧栏打开而出现第二份 `git status` 或第二个文件 watcher。
11. 展开某次提交后，文件清单直接出现在该提交行下面（含重命名来源与 +/- 行数），跟着提交列表滚动；面板底部不再出现固定高度的详情块。
12. 行内展开时，展开行之后的提交与泳道一起下移，不错位；合并提交的清单按第一父提交对比且非空；根提交按空树对比；空提交给出「没有文件变更」空态而不是一直 loading。
13. 切换到另一个提交（或折叠后再选提交）时，清单跟着展开的提交走，不残留上一个提交的文件；折叠再展开同一提交不重复取数（hook 缓存在 scope 与 hash 上）；取数失败在展开块内给出错误文案，不把图谱换成错误页。
14. 侧栏历史区块与 `GitGraphDialog` 都能看到同一提交的同一份行内清单，两者的选中、展开、滚动互不影响。
15. 来源选择、刷新与提交入口都在变更区块内：变更折叠时它们随之隐藏，历史展开时面板顶部没有空出的工具栏，图谱拿到整块高度。
16. 历史区块里没有二级标题行：区块标题下面直接是列头与提交列表，刷新图标在区块标题行右侧；折叠时刷新不显示。
