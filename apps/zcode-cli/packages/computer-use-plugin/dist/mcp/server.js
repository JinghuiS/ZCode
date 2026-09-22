// 电脑控制插件的 MCP 入口（手写源码，无构建步骤）。
//
// 官方插件的 MCP server 由 ZCode 自带的 Node 以 `__zcode-plugin-host <server.js>` 方式加载并调用 main()，
// 因此同一份启动器在 macOS 与 Windows 上都可用，不依赖系统 shell 或 PATH 中的 node。
// main() 定位本机 Kimi Computer Use（macOS: KimiCU.app；Windows: kimi-cu.exe），以继承的 stdio
// 启动 `kimi-cu mcp`，MCP 帧直接在 Agent 与 kimi-cu 之间传递。KimiCU 为 Moonshot AI 的闭源程序，插件不分发二进制。
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const MACOS_INSTALL_COMMAND =
  "curl -fsSL https://cdn.kimi.com/kimi-computer-use/latest/setup_macos.sh | bash";
const WINDOWS_INSTALL_COMMAND =
  "powershell -NoProfile -ExecutionPolicy Bypass -Command \"& ([scriptblock]::Create((irm 'https://cdn.kimi.com/kimi-computer-use-windows/latest/setup_windows.ps1')))\"";

/** 与 Host 侧 KimiComputerUseService 的探测顺序保持一致。 */
export function resolveKimiComputerUseExecutable(
  platform = process.platform,
  env = process.env,
) {
  if (platform === "darwin") {
    return [
      "/Applications/KimiCU.app/Contents/MacOS/kimi-cu",
      join(homedir(), "Applications", "KimiCU.app", "Contents", "MacOS", "kimi-cu"),
    ].find((candidate) => existsSync(candidate));
  }
  if (platform === "win32") {
    const candidates = [
      env.KIMI_CU_WINDOWS_EXE,
      env.KIMI_CU_WINDOWS_HOME ? join(env.KIMI_CU_WINDOWS_HOME, "kimi-cu.exe") : undefined,
      env.LOCALAPPDATA ? join(env.LOCALAPPDATA, "KimiCU", "kimi-cu.exe") : undefined,
      env.ProgramFiles ? join(env.ProgramFiles, "KimiCU", "kimi-cu.exe") : undefined,
    ];
    return candidates.find((candidate) => candidate?.trim() && existsSync(candidate));
  }
  return undefined;
}

function missingExecutableMessage(platform) {
  if (platform === "darwin") {
    return `KimiCU.app 未安装。请在 ZCode「设置 → 电脑控制」中点击安装，或在终端运行：\n  ${MACOS_INSTALL_COMMAND}\n`;
  }
  if (platform === "win32") {
    return `Kimi Computer Use 未安装。请在 ZCode「设置 → 电脑控制」中点击安装，或在 PowerShell 中运行：\n  ${WINDOWS_INSTALL_COMMAND}\n`;
  }
  return "电脑控制（Kimi Computer Use）目前仅支持 macOS 与 Windows x64。\n";
}

/**
 * 应答一条 JSON-RPC 请求；返回 undefined 表示不需要回复（通知）。
 * KimiCU 未安装时的空 MCP 只声明 tools 能力且工具列表为空，其余方法按「未实现」回复。
 */
export function handleUnavailableRequest(message, instructions) {
  if (!message || typeof message !== "object" || message.id === undefined || message.id === null) {
    return undefined;
  }
  const reply = (result) => ({ jsonrpc: "2.0", id: message.id, result });
  switch (message.method) {
    case "initialize":
      return reply({
        protocolVersion: message.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "kimi-cu", version: "unavailable" },
        instructions,
      });
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: [] });
    default:
      return {
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32601, message: `Kimi Computer Use 未安装，不支持 ${message.method}` },
      };
  }
}

/**
 * 插件默认开启，但 KimiCU 需用户自行安装。未安装时直接退出会让每个会话的 MCP 列表都出现
 * 一个报错的 server；这里改为挂一个无工具的空 MCP 直到连接关闭，安装指引写入 stderr 与 instructions。
 * 安装后新开对话即会重新探测并启动真正的 kimi-cu。
 */
export async function serveUnavailable(message) {
  process.stderr.write(message);
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      continue;
    }
    const response = handleUnavailableRequest(request, message.trim());
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  }
}

export async function main() {
  const executable = resolveKimiComputerUseExecutable();
  if (!executable) {
    await serveUnavailable(missingExecutableMessage(process.platform));
    return;
  }

  const child = spawn(executable, ["mcp"], { stdio: "inherit", windowsHide: true });
  // Agent 关闭 MCP 连接时会结束宿主进程；把终止信号转给 kimi-cu，避免残留子进程。
  const forward = (signal) => {
    if (!child.killed) child.kill(signal);
  };
  process.once("SIGTERM", forward);
  process.once("SIGINT", forward);

  const exitCode = await new Promise((resolve) => {
    child.once("error", (error) => {
      process.stderr.write(`无法启动 Kimi Computer Use：${error.message}\n`);
      resolve(1);
    });
    child.once("exit", (code, signal) => resolve(signal ? 1 : (code ?? 1)));
  });
  process.exitCode = exitCode;
}
