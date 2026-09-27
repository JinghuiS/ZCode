import assert from "node:assert/strict";
import test from "node:test";
import type { GitCommitFileChange } from "@zcode/shared";
import { getCommitFileRenameSource, summarizeCommitFiles } from "../src/git-graph/commitFiles.js";

function buildCommitFile(overrides: Partial<GitCommitFileChange> = {}): GitCommitFileChange {
  return {
    path: "/repo/src/a.ts",
    repoRelativePath: "src/a.ts",
    workspaceRelativePath: "src/a.ts",
    originalWorkspaceRelativePath: null,
    kind: "modified",
    added: 0,
    removed: 0,
    ...overrides,
  };
}

test("commit file summary counts files and sums line stats", () => {
  const summary = summarizeCommitFiles([
    buildCommitFile({ repoRelativePath: "src/a.ts", added: 12, removed: 3 }),
    buildCommitFile({
      repoRelativePath: "src/b.ts",
      workspaceRelativePath: "src/b.ts",
      kind: "renamed",
      originalWorkspaceRelativePath: "src/old-b.ts",
      added: 0,
      removed: 0,
    }),
    buildCommitFile({ repoRelativePath: "src/c.ts", kind: "deleted", added: 0, removed: 7 }),
  ]);

  assert.deepEqual(summary, { count: 3, added: 12, removed: 10 });
});

test("commit file summary of a commit without changes is zeroed", () => {
  assert.deepEqual(summarizeCommitFiles([]), { count: 0, added: 0, removed: 0 });
});

test("rename source path is only shown for renamed files", () => {
  assert.equal(
    getCommitFileRenameSource(
      buildCommitFile({
        kind: "renamed",
        originalWorkspaceRelativePath: "src/old-b.ts",
      }),
    ),
    "src/old-b.ts",
  );

  // kind 与来源路径由服务层的 numstat 解析共同决定；只按路径判断会把普通改动误标成重命名。
  assert.equal(
    getCommitFileRenameSource(
      buildCommitFile({ kind: "modified", originalWorkspaceRelativePath: "src/old-b.ts" }),
    ),
    null,
  );
  assert.equal(getCommitFileRenameSource(buildCommitFile({ kind: "renamed" })), null);
  assert.equal(
    getCommitFileRenameSource(
      buildCommitFile({ kind: "renamed", originalWorkspaceRelativePath: "  " }),
    ),
    null,
  );
});
