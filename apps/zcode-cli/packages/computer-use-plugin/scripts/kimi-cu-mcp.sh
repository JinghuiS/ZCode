#!/bin/sh
# 电脑控制插件的 MCP 入口：定位本机 KimiCU.app 并以 stdio 方式启动 `kimi-cu mcp`。
# KimiCU 为 Moonshot AI 提供的闭源程序，插件不分发二进制，未安装时给出官方安装指引。
set -eu

for APP_ROOT in "/Applications/KimiCU.app" "$HOME/Applications/KimiCU.app"; do
  BIN="$APP_ROOT/Contents/MacOS/kimi-cu"
  if [ -x "$BIN" ]; then
    exec "$BIN" mcp
  fi
done

if [ "$(uname -s)" != "Darwin" ]; then
  echo "电脑控制（Kimi Computer Use）目前仅支持 macOS。" >&2
  exit 1
fi

echo "KimiCU.app 未安装。请在 ZCode「设置 → 电脑控制」中点击安装，或在终端运行：" >&2
echo "  curl -fsSL https://cdn.kimi.com/kimi-computer-use/latest/setup_macos.sh | bash" >&2
exit 1
