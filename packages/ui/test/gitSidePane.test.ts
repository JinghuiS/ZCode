import assert from "node:assert/strict";
import test from "node:test";
import {
  activateGitSidePane,
  setGitSidePaneSectionCollapsed,
  toggleGitSidePane,
  type GitSidePaneScope,
  type GitSidePaneTab,
} from "../src/lib/workspaceSidePane.js";

const LOCAL_SCOPE: GitSidePaneScope = {
  workspaceKey: "/Users/me/code/app",
  workspacePath: "/Users/me/code/app",
};

const REMOTE_SCOPE: GitSidePaneScope = {
  workspaceKey: "remote:ssh:host:22:me:/home/me/app",
  workspacePath: "/home/me/app",
  workspaceIdentity: "remote:ssh:host:22:me:/home/me/app",
  remoteSessionId: "session-1",
};

function getGitTab(state: ReturnType<typeof activateGitSidePane>): GitSidePaneTab {
  const tab = state.tabs.find((candidate) => candidate.type === "git");
  assert.ok(tab, "expected a git tab");
  return tab as GitSidePaneTab;
}

test("git side pane tab freezes the workspace identity it was opened with", () => {
  const local = getGitTab(activateGitSidePane(null, LOCAL_SCOPE));
  assert.equal(local.workspaceKey, "/Users/me/code/app");
  assert.equal(local.workspacePath, "/Users/me/code/app");
  assert.equal(local.workspaceIdentity, undefined);
  assert.equal(local.remoteSessionId, undefined);

  const remote = getGitTab(activateGitSidePane(null, REMOTE_SCOPE));
  assert.equal(remote.workspaceKey, "remote:ssh:host:22:me:/home/me/app");
  assert.equal(remote.workspacePath, "/home/me/app");
  assert.equal(remote.workspaceIdentity, "remote:ssh:host:22:me:/home/me/app");
  // remoteSessionId 必须创建时冻结，否则远程项目的 Git tab 关不掉。
  assert.equal(remote.remoteSessionId, "session-1");
});

test("reopening the git side pane keeps the expanded section the user chose", () => {
  const opened = activateGitSidePane(null, LOCAL_SCOPE);
  // 新面板缺省是变更展开、历史折叠（手风琴初始态）。
  assert.equal(getGitTab(opened).changesCollapsed, false);
  assert.equal(getGitTab(opened).historyCollapsed, true);

  const historyExpanded = setGitSidePaneSectionCollapsed(opened, {
    tabId: "git",
    section: "history",
    collapsed: false,
  });
  assert.equal(getGitTab(historyExpanded!).changesCollapsed, true);
  assert.equal(getGitTab(historyExpanded!).historyCollapsed, false);

  // 再次打开同一个面板不得把展开的区块重置回缺省态。
  const reopened = activateGitSidePane(historyExpanded, LOCAL_SCOPE);
  assert.equal(getGitTab(reopened).changesCollapsed, true);
  assert.equal(getGitTab(reopened).historyCollapsed, false);
});

test("git side pane sections behave as an accordion", () => {
  const opened = activateGitSidePane(null, LOCAL_SCOPE);
  const historyExpanded = setGitSidePaneSectionCollapsed(opened, {
    tabId: "git",
    section: "history",
    collapsed: false,
  });
  // 展开历史即折叠变更：展开的区块要能占满整块高度。
  assert.equal(getGitTab(historyExpanded!).changesCollapsed, true);
  assert.equal(getGitTab(historyExpanded!).historyCollapsed, false);

  const changesExpanded = setGitSidePaneSectionCollapsed(historyExpanded, {
    tabId: "git",
    section: "changes",
    collapsed: false,
  });
  assert.equal(getGitTab(changesExpanded!).changesCollapsed, false);
  assert.equal(getGitTab(changesExpanded!).historyCollapsed, true);

  // 两个都折叠是允许的：再点展开的那个区块只是把它自己收起来。
  const bothCollapsed = setGitSidePaneSectionCollapsed(changesExpanded, {
    tabId: "git",
    section: "changes",
    collapsed: true,
  });
  assert.equal(getGitTab(bothCollapsed!).changesCollapsed, true);
  assert.equal(getGitTab(bothCollapsed!).historyCollapsed, true);
});

test("setting a collapsed section is a no-op when no git tab is open", () => {
  assert.equal(
    setGitSidePaneSectionCollapsed(null, {
      tabId: "git",
      section: "history",
      collapsed: true,
    }),
    null,
  );

  const withoutGit = { tabs: [], activeTabId: "" };
  assert.equal(
    setGitSidePaneSectionCollapsed(withoutGit, {
      tabId: "git",
      section: "history",
      collapsed: true,
    }),
    withoutGit,
  );
});

test("toggling the git side pane closes it only when it is the active tab", () => {
  const opened = activateGitSidePane(null, LOCAL_SCOPE);
  const closed = toggleGitSidePane(opened, LOCAL_SCOPE);
  assert.equal(
    closed?.tabs.some((tab) => tab.type === "git") ?? false,
    false,
    "active git tab should close",
  );

  const reopened = toggleGitSidePane(closed, LOCAL_SCOPE);
  assert.equal(getGitTab(reopened!).workspaceKey, LOCAL_SCOPE.workspaceKey);
});
