# 移除客户端登录与账号入口

## 背景

开源版不再要求用户登录 ZCode 客户端。原先「客户端登录」与智谱 / Z.AI 供应商 OAuth 共用同一套凭据：
启动时没有可用 provider、会话过期、退出登录后都会强制打开全屏 WelcomeScreen。

## 产品规则

1. **不再有客户端登录**
   - 启动时不再因缺少可用 provider 而打开 WelcomeScreen，直接进入工作区；未配置模型时由聊天错误条引导到「设置 → 模型」。
   - 供应商 OAuth 失效（`reauthentication-required` / JWT 失效广播）只提示过期，不再打开全屏登录页；用户在模型设置里重新连接。
   - 侧栏底部、快捷面板不再提供「连接使用 / 断开连接」；移除 App 级 logout（清 OAuth + 重启）。
2. **保留供应商登录**
   - 模型设置里智谱 / Z.AI 的「连接」仍通过 `requestLoginEntry` 打开 WelcomeScreen 完成 OAuth 或 API Key 配置。
   - WelcomeScreen 仅由该入口打开，必须提供「取消」出口；完成或取消后回到原页面。
   - 断开供应商连接走模型设置内已有的 unlink 流程。
3. **侧栏底部菜单**
   - 左侧固定展示「ZCode」，只作为语言、主题、界面模式、缩放的偏好菜单入口。
   - 移除套餐徽标、用量摘要与「升级」入口；聊天错误条移除「升级」按钮，只保留「设置模型」。
4. **模型设置不再按智谱固定分组**
   - 左侧导航只有一个「供应商」标题：智谱家族条目在前，自定义供应商在后（仍可拖拽排序）。
   - 「添加供应商」模板页不再分「智谱 / 其他」，统一列表，bigmodel / zai 模板排在前面。

## 状态所有者

| 状态 | 所有者 | 说明 |
| --- | --- | --- |
| WelcomeScreen 是否打开 | `Root`（`welcomeScreenOpenReason`，仅 `provider-request`） | 只由 store 的 `loginEntryRequest` 触发 |
| 供应商 OAuth 用户信息 `user` | Zustand store（OAuth 恢复 / 成功回调写入） | 仅会话分享等依赖云端鉴权的功能读取，不再作为客户端登录态 |

```text
模型设置「连接」 → store.requestLoginEntry → Root: reason=provider-request → WelcomeScreen
WelcomeScreen 完成(oauth/apiKey/skip) → refreshAppSettings → reason=null
WelcomeScreen 取消 → reason=null
```

## 验收场景

- 全新数据目录启动：不出现登录页，直接进入工作区。
- 侧栏底部菜单：无账号名、套餐徽标、用量、升级、连接 / 断开连接。
- 快捷面板搜索「连接 / login」：无结果。
- 模型设置：左侧只有「供应商」一个标题；点击智谱 Coding Plan 的连接能打开 OAuth 页，点「取消」能返回。
- 添加供应商：模板无分组标题。
