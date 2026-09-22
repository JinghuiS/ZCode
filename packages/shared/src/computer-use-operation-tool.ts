/**
 * 电脑控制操作生命周期：这个 tool call 是否应点亮本机预览窗。
 *
 * 判定只看工具名（以及旧 node_repl cell 的引导语句），不解析动作名。
 * KimiCU 运行时 server 名为 plugin:computer-use:kimi-cu，模型可见工具名为
 * mcp__plugin_computer-use_kimi-cu__<action>。
 */
import { KIMI_COMPUTER_USE_MCP_SERVER_NAME } from "./mcp.js";

const NODE_REPL_JS_TOOL_NAME = "mcp__node_repl__js";
const COMPUTER_USE_RUNTIME_BOOTSTRAP = "setupComputerUseRuntime";
const KIMI_CU_NAME_TOKEN = KIMI_COMPUTER_USE_MCP_SERVER_NAME.replaceAll("-", "_");
const MAX_APP_ID_LENGTH = 256;

export interface ComputerUseTarget {
  pid?: number;
  app?: string;
  windowId?: number;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function normalizeMcpToolName(toolName: string): string {
  return toolName.trim().toLowerCase().replaceAll("-", "_");
}

function readPositiveInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^(?:0|[1-9]\d*)$/u.test(value.trim())) {
    const parsed = Number(value.trim());
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

/**
 * 旧官方 CUA 与 KimiCU 的 MCP 工具名。不含 node_repl：那个还要看 cell 源码。
 */
export function isComputerUseMcpToolName(toolName: string): boolean {
  const normalized = normalizeMcpToolName(toolName);
  if (!normalized.startsWith("mcp__")) return false;
  if (normalized.includes(KIMI_CU_NAME_TOKEN)) return true;
  return normalized.includes("computer_use");
}

export function isComputerUseOperationToolCall(input: {
  toolName: string;
  input?: unknown;
}): boolean {
  const toolName = input.toolName.trim();
  if (isComputerUseMcpToolName(toolName)) return true;
  if (toolName !== NODE_REPL_JS_TOOL_NAME) return false;
  const code = nonEmptyString(asRecord(input.input).code);
  return Boolean(code?.includes(COMPUTER_USE_RUNTIME_BOOTSTRAP));
}

function readTargetFromRecord(record: Record<string, unknown>): ComputerUseTarget | undefined {
  const pid = readPositiveInt(record.pid);
  const windowId = readPositiveInt(record.window_id) ?? readPositiveInt(record.windowId);
  const appRaw = nonEmptyString(record.app)?.trim();
  const app = appRaw && appRaw.length <= MAX_APP_ID_LENGTH ? appRaw : undefined;
  if (pid === undefined && windowId === undefined && app === undefined) return undefined;
  return {
    ...(pid !== undefined ? { pid } : {}),
    ...(app ? { app } : {}),
    ...(windowId !== undefined ? { windowId } : {}),
  };
}

/** 从 kimi-cu 工具参数读取目标窗口身份；没有可用字段时返回 undefined。 */
export function readComputerUseTargetFromToolInput(
  input: unknown,
): ComputerUseTarget | undefined {
  const record = asRecord(input);
  return readTargetFromRecord(record) ?? readTargetFromRecord(asRecord(record.arguments));
}
