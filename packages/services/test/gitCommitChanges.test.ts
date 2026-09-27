import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createGitService } from "../src/git/gitService.js";

const gitSkipReason =
  spawnSync("git", ["--version"], { stdio: "ignore" }).status === 0
    ? false
    : "git is not available in this environment";

function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile("git", args, { cwd }, (error, stdout, stderr) => {
      if (error) {
        rejectPromise(new Error(`git ${args.join(" ")} failed: ${stderr || error.message}`));
        return;
      }
      resolvePromise(stdout);
    });
  });
}

async function createWorkspace(t: { after: (fn: () => Promise<void>) => void }): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "zcode-git-commit-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  await runGit(root, ["init", "-q", "-b", "main", "."]);
  await runGit(root, ["config", "user.email", "test@example.com"]);
  await runGit(root, ["config", "user.name", "Test"]);
  await runGit(root, ["config", "commit.gpgsign", "false"]);
  return root;
}

async function writeWorkspaceFile(root: string, relativePath: string, content: string) {
  const absolutePath = join(root, relativePath);
  await mkdir(join(absolutePath, ".."), { recursive: true });
  await writeFile(absolutePath, content, "utf-8");
}

async function commitAll(root: string, message: string): Promise<string> {
  await runGit(root, ["add", "-A"]);
  await runGit(root, ["commit", "-q", "-m", message]);
  return (await runGit(root, ["rev-parse", "HEAD"])).trim();
}

test("提交文件清单按第一父提交对比合并提交", { skip: gitSkipReason }, async (t) => {
  const root = await createWorkspace(t);
  await writeWorkspaceFile(root, "base.txt", "base\n");
  await commitAll(root, "base");

  await runGit(root, ["checkout", "-q", "-b", "side"]);
  await writeWorkspaceFile(root, "side.txt", "side\n");
  await commitAll(root, "side");

  await runGit(root, ["checkout", "-q", "main"]);
  await writeWorkspaceFile(root, "main.txt", "main\n");
  await commitAll(root, "main");

  await runGit(root, ["merge", "-q", "--no-ff", "-m", "merge side", "side"]);
  const mergeHash = (await runGit(root, ["rev-parse", "HEAD"])).trim();
  assert.equal(
    (await runGit(root, ["rev-list", "--parents", "-n", "1", mergeHash])).trim().split(/\s+/)
      .length,
    3,
    "合并提交应有两个父提交",
  );

  const result = await createGitService().getCommitChanges({
    workspacePath: root,
    commitHash: mergeHash,
  });

  // 只有第一父分支缺少的文件才算这次合并带来的改动；按第二个父提交对比会多出 main.txt。
  assert.deepEqual(result.files.map((file) => file.workspaceRelativePath).sort(), ["side.txt"]);
  assert.equal(result.commitHash, mergeHash);
});

test("根提交按空树对比列出全部文件", { skip: gitSkipReason }, async (t) => {
  const root = await createWorkspace(t);
  await writeWorkspaceFile(root, "a.txt", "a\n");
  await writeWorkspaceFile(root, "sub/b.txt", "b\n");
  const rootHash = await commitAll(root, "root");

  const result = await createGitService().getCommitChanges({
    workspacePath: root,
    commitHash: rootHash,
  });

  assert.deepEqual(
    result.files.map((file) => [file.workspaceRelativePath, file.kind, file.added, file.removed]),
    [
      ["a.txt", "added", 1, 0],
      ["sub/b.txt", "added", 1, 0],
    ],
  );
});

test("重命名与普通改动给出各自的来源与行数", { skip: gitSkipReason }, async (t) => {
  const root = await createWorkspace(t);
  await writeWorkspaceFile(root, "keep.txt", "l1\nl2\nl3\nl4\nl5\n");
  await commitAll(root, "keep");

  await runGit(root, ["mv", "keep.txt", "renamed.txt"]);
  await writeWorkspaceFile(root, "renamed.txt", "l1\nl2\nl3\nl4\nl5\nl6\n");
  await writeWorkspaceFile(root, "added.txt", "x\ny\n");
  const commitHash = await commitAll(root, "rename and add");

  const result = await createGitService().getCommitChanges({
    workspacePath: root,
    commitHash,
  });
  const files = new Map(result.files.map((file) => [file.workspaceRelativePath, file]));

  const renamed = files.get("renamed.txt");
  assert.equal(renamed?.kind, "renamed");
  assert.equal(renamed?.originalWorkspaceRelativePath, "keep.txt");
  assert.equal(renamed?.added, 1);
  assert.equal(renamed?.removed, 0);

  const added = files.get("added.txt");
  assert.equal(added?.kind, "added");
  assert.equal(added?.originalWorkspaceRelativePath, null);
  assert.equal(added?.added, 2);
});

test("提交没有文件变更时返回空清单", { skip: gitSkipReason }, async (t) => {
  const root = await createWorkspace(t);
  await writeWorkspaceFile(root, "a.txt", "a\n");
  await commitAll(root, "first");
  await runGit(root, ["commit", "-q", "--allow-empty", "-m", "empty"]);
  const emptyHash = (await runGit(root, ["rev-parse", "HEAD"])).trim();

  const result = await createGitService().getCommitChanges({
    workspacePath: root,
    commitHash: emptyHash,
  });

  assert.deepEqual(result.files, []);
});

test("workspace 是仓库子目录时只返回该目录内的文件", { skip: gitSkipReason }, async (t) => {
  const root = await createWorkspace(t);
  await writeWorkspaceFile(root, "root.txt", "root\n");
  await writeWorkspaceFile(root, "pkg/pkg.txt", "pkg\n");
  const commitHash = await commitAll(root, "add files");

  const result = await createGitService().getCommitChanges({
    workspacePath: join(root, "pkg"),
    commitHash,
  });

  assert.deepEqual(
    result.files.map((file) => [file.repoRelativePath, file.workspaceRelativePath]),
    [["pkg/pkg.txt", "pkg.txt"]],
  );
});

test("workspace 不在 Git 仓库内时返回空清单", { skip: gitSkipReason }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "zcode-git-plain-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const result = await createGitService().getCommitChanges({
    workspacePath: root,
    commitHash: "0123456789abcdef0123456789abcdef01234567",
  });

  assert.deepEqual(result.files, []);
});

test("非法或未知的提交哈希被拒绝", { skip: gitSkipReason }, async (t) => {
  const root = await createWorkspace(t);
  await writeWorkspaceFile(root, "a.txt", "a\n");
  await commitAll(root, "first");
  const gitService = createGitService();

  // hash 会直接进入 git argv，非十六进制对象名必须在服务调用前就被挡掉。
  await assert.rejects(
    gitService.getCommitChanges({ workspacePath: root, commitHash: "--help" }),
    /Invalid commit hash/,
  );
  await assert.rejects(
    gitService.getCommitChanges({
      workspacePath: root,
      commitHash: "0123456789abcdef0123456789abcdef01234567",
    }),
  );
});
