# 工作区显示别名

## 行为

用户可以为已打开的项目设置一个只存在于 ZCode 里的显示名。别名用于区分文件夹名相同或难以辨认的项目，不改磁盘路径、不改远程目录、不改 `workspaceIdentity`。

空别名或与路径叶子名相同的输入视为清除覆盖，界面回退到文件夹名。

## 所有权

| 事实        | 所有者                                         | 写入                                | 持久化                        |
| ----------- | ---------------------------------------------- | ----------------------------------- | ----------------------------- |
| 显示别名    | 本机 `AppSettings.workspaceDisplayAliases`     | `settingService.update` 按 key 合并 | `setting.json`                |
| 工作区身份  | `workspaceIdentity?.trim() \|\| workspacePath` | 不因别名变化                        | 不变                          |
| 执行路径    | `workspacePath`                                | 不因别名变化                        | 不变                          |
| `tab.label` | 窗口 tab store 的展示投影                      | 由别名派生，不单独持久化            | 不写入 `lastWorkspaceSession` |

别名 map 的 key 必须是 `workspaceIdentity?.trim() || workspacePath`。本地项目用路径，远端项目用 identity，同路径的本机与 SSH/WSL/Docker 互不影响。

`settingService.update` 对 `workspaceDisplayAliases` 做按 key 合并：补丁里的空值删除对应 key，不得整表覆盖，避免两个窗口同时改不同项目时互相冲掉。

## 展示

有别名时，以下表面使用同一解析结果：

- 侧栏项目名、拖拽预览
- 窗口标题 `ZCode / {name}`
- 顶栏工作区上下文（路径叶子被别名替换；真实路径仍在路径 tooltip）
- 命令面板、插件作用域、自动化/已保存工作流的项目选项
- 空态项目切换菜单、归档任务的项目名、文件树标题

SSH 的 `[SSH: alias]` 仍叠在显示名之后，不是项目别名。

`workspacePurpose === "conversation"` 的 backing workspace 不提供重命名，也不应用别名。

## 入口

侧栏项目行「更多」菜单增加「重命名」。复用任务重命名对话框的交互（含 IME Enter 不提交）。确认空值或文件夹名则清除别名。只读、断连远端仍允许改显示名。移除侧栏项目不删除已存别名。

## 不变量

- 别名不是 identity，不能用于去重、缓存、队列、任务索引或 RPC 路由。
- `workspacePath` 仍是 cwd、Git、文件操作和路径展示的唯一来源。
- 不重命名磁盘目录，不改远程路径。
- 允许两个项目使用相同显示名；用路径或远端 host 作为第二信息区分。
- 桌面 `desktop-continuous` 与手机 `web-remote-replayable` 不另做协议；若手机读到同一份本机 `AppSettings`，直接显示别名。

## 验收

1. 两个本地文件夹都叫 `frontend` 时，可为其中一个设置别名；侧栏与窗口标题立即显示别名，磁盘路径不变。
2. 重启后别名仍在；会话恢复仍按路径/identity 匹配工作区。
3. 清除别名后恢复文件夹名。
4. 本机与 SSH 打开同一路径时可分别命名。
5. 未改名的项目行为与改前一致。
