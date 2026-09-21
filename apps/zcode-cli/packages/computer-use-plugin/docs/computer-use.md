# 电脑控制（Kimi Computer Use）

ZCode 的电脑控制由 [Kimi Computer Use](https://www.kimi.com)（Moonshot AI 提供，支持 macOS 与 Windows x64）驱动：
Agent 读取任意 app 的界面结构和截图，完成点击、输入、滚动和拖拽。macOS 上全程在后台进行，不会移动你的鼠标。

## 开始使用

1. 打开「设置 → 电脑控制」，开启「启用电脑控制」。
2. 若显示「未安装」，点击「安装」，会打开一个终端窗口运行官方安装脚本。也可以手动运行：

   - macOS（安装到「应用程序」，可能需要管理员密码）：

     ```bash
     curl -fsSL https://cdn.kimi.com/kimi-computer-use/latest/setup_macos.sh | bash
     ```

   - Windows（PowerShell，按用户安装到 `%LOCALAPPDATA%\KimiCU`，脚本会校验签名）：

     ```powershell
     & ([scriptblock]::Create((irm 'https://cdn.kimi.com/kimi-computer-use-windows/latest/setup_windows.ps1')))
     ```

3. macOS：在「系统设置 → 隐私与安全性」中为 KimiCU 打开「辅助功能」和「屏幕录制」，回到 ZCode 点击刷新。
   Windows 无需额外授权。
4. 新建对话，直接描述想让 ZCode 在电脑上做的事，例如「打开备忘录，把最新一条笔记的标题念给我」。

## 说明

- Windows 版执行操作时会短暂占用键盘和鼠标，期间请不要操作电脑。
- Kimi Computer Use 为 Moonshot AI 的闭源程序，ZCode 不附带其二进制，只调用官方安装脚本。
- 删除、发送、付款等不可逆操作，Agent 会先征求你的同意。
