# computer-use（官方插件）

ZCode「电脑控制」官方插件，基于 Kimi Computer Use（macOS / Windows x64）的 `kimi-cu mcp` stdio server。

- `.zcode-plugin/plugin.json`：声明 `kimi-cu` MCP server；seed 时由宿主改写为 ZCode 自带 Node 运行
  `dist/mcp/server.js`（手写启动器，定位本机 KimiCU 并以继承的 stdio 启动 `kimi-cu mcp`）。
- `scripts/install-kimi-cu.sh` / `scripts/install-kimi-cu.ps1`：调用官方安装脚本。
- `skills/computer-use/SKILL.md`：给模型的工作流与安全约束。

设计见仓库 `specs/computer-use-kimi.md`。
