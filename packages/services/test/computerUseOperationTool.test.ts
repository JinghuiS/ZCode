import assert from "node:assert/strict";
import test from "node:test";
import {
  isComputerUseMcpToolName,
  isComputerUseOperationToolCall,
  readComputerUseTargetFromToolInput,
} from "../../shared/src/computer-use-operation-tool.ts";

test("kimi-cu 插件命名空间工具名算电脑控制", () => {
  assert.equal(
    isComputerUseMcpToolName("mcp__plugin_computer-use_kimi-cu__click"),
    true,
  );
  assert.equal(isComputerUseMcpToolName("mcp__kimi-cu__get_app_state"), true);
});

test("旧官方 CUA 工具名仍算电脑控制", () => {
  assert.equal(isComputerUseMcpToolName("mcp__computer-use__click"), true);
  assert.equal(
    isComputerUseMcpToolName("mcp__plugin_zcode-cua_computer-use__screenshot"),
    true,
  );
});

test("浏览器 node_repl 不算电脑控制", () => {
  assert.equal(
    isComputerUseOperationToolCall({
      toolName: "mcp__node_repl__js",
      input: { code: "await agent.browsers.getDefault()" },
    }),
    false,
  );
});

test("旧 node_repl CUA 引导语句仍算电脑控制", () => {
  assert.equal(
    isComputerUseOperationToolCall({
      toolName: "mcp__node_repl__js",
      input: { code: "await setupComputerUseRuntime({ globals: globalThis });" },
    }),
    true,
  );
});

test("无关 MCP 不算电脑控制", () => {
  assert.equal(isComputerUseMcpToolName("mcp__browser-use__js"), false);
  assert.equal(
    isComputerUseOperationToolCall({ toolName: "Bash", input: { command: "ls" } }),
    false,
  );
});

test("从 kimi-cu 工具参数读取 pid/app/window_id", () => {
  assert.deepEqual(
    readComputerUseTargetFromToolInput({
      pid: 785,
      app: "com.apple.finder",
      window_id: 6726,
    }),
    { pid: 785, app: "com.apple.finder", windowId: 6726 },
  );
  assert.equal(readComputerUseTargetFromToolInput({ text: "hello" }), undefined);
  assert.deepEqual(
    readComputerUseTargetFromToolInput({ arguments: { pid: 42, app: "com.apple.finder" } }),
    { pid: 42, app: "com.apple.finder" },
  );
});
