# 调用 Kimi Computer Use（Windows x64）官方安装脚本：按用户安装到 %LOCALAPPDATA%\KimiCU，
# 脚本会校验运行时的 SHA-256 与 Authenticode 签名。
$ErrorActionPreference = 'Stop'
$setup = Invoke-RestMethod -Uri 'https://cdn.kimi.com/kimi-computer-use-windows/latest/setup_windows.ps1'
& ([scriptblock]::Create($setup))
Write-Host ''
Write-Host '安装完成。请回到 ZCode「设置 → 电脑控制」点击刷新。'
