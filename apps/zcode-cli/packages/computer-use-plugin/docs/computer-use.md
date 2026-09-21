# 电脑控制（Kimi Computer Use）

ZCode 的电脑控制由 [Kimi Computer Use](https://www.kimi.com)（Moonshot AI 提供，macOS）驱动：
Agent 读取任意 app 的无障碍树和截图，在后台完成点击、输入、滚动和拖拽，不会移动你的鼠标，也不会把目标 app 切到前台。

## 开始使用

1. 打开「设置 → 电脑控制」，开启「启用电脑控制」。
2. 若显示「未安装」，点击「安装」。系统终端会运行官方安装脚本，把 KimiCU.app 安装到「应用程序」，
   如需管理员密码请在终端中输入。也可以手动运行：

   ```bash
   curl -fsSL https://cdn.kimi.com/kimi-computer-use/latest/setup_macos.sh | bash
   ```

3. 在「系统设置 → 隐私与安全性」中为 KimiCU 打开「辅助功能」和「屏幕录制」，回到 ZCode 点击刷新。
4. 新建对话，直接描述想让 ZCode 在电脑上做的事，例如「打开备忘录，把最新一条笔记的标题念给我」。

## 说明

- 目前仅支持 macOS；Windows 版本后续接入。
- KimiCU.app 为 Moonshot AI 的闭源程序，ZCode 不附带其二进制，只调用官方安装脚本。
- 删除、发送、付款等不可逆操作，Agent 会先征求你的同意。
