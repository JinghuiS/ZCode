import assert from "node:assert/strict";
import test from "node:test";
import {
  appSettingsPatchSchema,
  appSettingsSchema,
} from "../../shared/src/validationAppSettings.js";
import {
  mergeWorkspaceDisplayAliasPatch,
  resolveWorkspaceDisplayName,
} from "../../shared/src/workspace-display-name.js";

test("workspace display alias falls back to path leaf and ignores conversation workspaces", () => {
  const aliases = {
    "/Users/me/code/frontend": "客户 A",
    "remote:ssh:host:22:me:/home/me/frontend": "线上 frontend",
  };

  assert.equal(
    resolveWorkspaceDisplayName({
      workspacePath: "/Users/me/code/frontend",
      aliases,
    }),
    "客户 A",
  );
  assert.equal(
    resolveWorkspaceDisplayName({
      workspacePath: "/home/me/frontend",
      workspaceIdentity: "remote:ssh:host:22:me:/home/me/frontend",
      aliases,
    }),
    "线上 frontend",
  );
  assert.equal(
    resolveWorkspaceDisplayName({
      workspacePath: "/Users/me/code/frontend",
      workspacePurpose: "conversation",
      aliases,
    }),
    "frontend",
  );
  assert.equal(
    resolveWorkspaceDisplayName({
      workspacePath: "/Users/me/code/other",
      aliases,
    }),
    "other",
  );
});

test("alias patches merge by workspace key and empty values delete the override", () => {
  const merged = mergeWorkspaceDisplayAliasPatch(
    {
      "/a/frontend": "客户 A",
      "/b/frontend": "客户 B",
    },
    {
      "/b/frontend": "",
      "/c/frontend": "客户 C",
    },
  );

  assert.deepEqual(merged, {
    "/a/frontend": "客户 A",
    "/c/frontend": "客户 C",
  });
});

test("settings patch keeps empty alias values so the owner can clear a single key", () => {
  const parsed = appSettingsPatchSchema.parse({
    workspaceDisplayAliases: {
      "/a/frontend": "",
    },
  });
  assert.equal(parsed.workspaceDisplayAliases?.["/a/frontend"], "");

  const stored = appSettingsSchema.parse({
    workspaceDisplayAliases: mergeWorkspaceDisplayAliasPatch(
      { "/a/frontend": "客户 A", "/b/frontend": "客户 B" },
      parsed.workspaceDisplayAliases,
    ),
  });
  assert.deepEqual(stored.workspaceDisplayAliases, {
    "/b/frontend": "客户 B",
  });
});
