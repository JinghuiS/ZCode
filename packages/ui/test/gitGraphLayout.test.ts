import assert from "node:assert/strict";
import test from "node:test";
import type { GitGraphCommit } from "@zcode/shared";
import { layoutGitGraph } from "../src/git-graph/layout.js";

function buildCommit(hash: string, parents: string[]): GitGraphCommit {
  return {
    hash,
    parents,
    refs: [],
    subject: hash,
    authorName: "tester",
    authoredAtMs: 0,
  };
}

/** 一条直线的历史：c0 -> c1 -> c2 -> c3。 */
const LINEAR_COMMITS: GitGraphCommit[] = [
  buildCommit("c0", ["c1"]),
  buildCommit("c1", ["c2"]),
  buildCommit("c2", ["c3"]),
  buildCommit("c3", []),
];

function parsePathEndY(path: string): number {
  const numbers = path.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  return numbers[numbers.length - 1]!;
}

test("commit graph rows are laid out on a uniform pitch by default", () => {
  const layout = layoutGitGraph(LINEAR_COMMITS);
  const pitch = layout.rows[1]!.y - layout.rows[0]!.y;

  assert.equal(pitch, layout.rowHeight);
  for (const [index, row] of layout.rows.entries()) {
    assert.equal(row.y, layout.rows[0]!.y + index * layout.rowHeight);
  }
});

test("row gaps shift later rows and their lane lines", () => {
  const base = layoutGitGraph(LINEAR_COMMITS);
  const gap = 240;
  const withGap = layoutGitGraph(LINEAR_COMMITS, { rowGaps: { 1: gap } });

  // 展开行自身不动，它之后的每一行整体下移同样的高度。
  assert.equal(withGap.rows[0]!.y, base.rows[0]!.y);
  assert.equal(withGap.rows[1]!.y, base.rows[1]!.y);
  for (const index of [2, 3]) {
    assert.equal(withGap.rows[index]!.y, base.rows[index]!.y + gap);
  }

  // 画布高度随之增加，连线终点跟随下移后的行，泳道不会与提交行错位。
  assert.equal(withGap.height, base.height + gap);
  const shiftedEdge = withGap.edges.find((edge) => edge.toHash === "c2");
  assert.ok(shiftedEdge, "expected an edge into c2");
  assert.equal(parsePathEndY(shiftedEdge.path), withGap.rows[2]!.y);
});

test("negative or zero row gaps leave the layout unchanged", () => {
  const base = layoutGitGraph(LINEAR_COMMITS);
  const withEmptyGaps = layoutGitGraph(LINEAR_COMMITS, { rowGaps: { 1: 0, 2: -40 } });

  assert.deepEqual(
    withEmptyGaps.rows.map((row) => row.y),
    base.rows.map((row) => row.y),
  );
  assert.equal(withEmptyGaps.height, base.height);
});
