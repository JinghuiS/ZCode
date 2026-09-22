#!/bin/sh
# 调用 Kimi Computer Use 官方安装脚本：下载 KimiCU.app 到 /Applications、注册 launchd 服务并请求系统权限。
# /Applications 不可写时官方脚本会请求 sudo 密码，因此必须在用户可见的终端中运行。
set -eu

if [ "$(uname -s)" != "Darwin" ]; then
  echo "Kimi Computer Use 目前仅支持 macOS。" >&2
  exit 1
fi

# 官方脚本固定下载 Apple 芯片（arm64）版 KimiCU.app.zip；Intel Mac 上只把下载地址换成 CDN 上
# Moonshot 签名并公证的 KimiCU-x86_64.app.zip，其余步骤沿用官方脚本。
if [ "$(sysctl -n hw.optional.arm64 2>/dev/null)" = "1" ]; then
  curl -fsSL https://cdn.kimi.com/kimi-computer-use/latest/setup_macos.sh | bash
else
  curl -fsSL https://cdn.kimi.com/kimi-computer-use/latest/setup_macos.sh \
    | sed 's#\$VERSION/KimiCU\.app\.zip#$VERSION/KimiCU-x86_64.app.zip#' \
    | bash
fi

echo
echo "安装完成。请在「系统设置 → 隐私与安全性」中为 KimiCU 打开「辅助功能」和「屏幕录制」，"
echo "然后回到 ZCode「设置 → 电脑控制」点击刷新。"
