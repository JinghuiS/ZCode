import assert from "node:assert/strict";
import test from "node:test";
import { createProviderAuthService } from "../src/provider-auth/providerAuthService.js";
import type { ICredentialService } from "../src/credential/credential.js";
import { XAI_BILLING_CREDITS_URL, XAI_BILLING_URL } from "@zcode/provider-node";

function createMemoryCredentials(): ICredentialService & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    load: async (key) => data.get(key) ?? null,
    save: async (key, value) => void data.set(key, value),
    delete: async (key) => void data.delete(key),
  };
}

function seedXai(store: ICredentialService & { data: Map<string, string> }) {
  store.data.set(
    "provider-auth:xai",
    JSON.stringify({
      version: 1,
      access: "a1",
      refresh: "r1",
      expiresAt: Date.now() + 3600_000,
    }),
  );
}

test("非 xAI 账号不发网，直接 unsupported", async () => {
  let calls = 0;
  const { service } = createProviderAuthService({
    credentialService: createMemoryCredentials(),
    broadcastService: { send: async () => undefined },
    appVersion: "test",
    fetch: async () => {
      calls += 1;
      return new Response("no", { status: 500 });
    },
  });
  assert.deepEqual(await service.getSubscriptionUsage({ authProviderId: "zai" }), {
    status: "unsupported",
  });
  assert.equal(calls, 0);
});

test("未连接 xAI 不发网，返回 unavailable", async () => {
  let calls = 0;
  const { service } = createProviderAuthService({
    credentialService: createMemoryCredentials(),
    broadcastService: { send: async () => undefined },
    appVersion: "test",
    fetch: async () => {
      calls += 1;
      return new Response("no", { status: 500 });
    },
  });
  assert.deepEqual(await service.getSubscriptionUsage({ authProviderId: "xai" }), {
    status: "unavailable",
  });
  assert.equal(calls, 0);
});

test("已连接时拉取周/月窗口；成功结果 5 分钟内不重复打网", async () => {
  const credentials = createMemoryCredentials();
  seedXai(credentials);
  let calls = 0;
  const { service } = createProviderAuthService({
    credentialService: credentials,
    broadcastService: { send: async () => undefined },
    appVersion: "test",
    now: () => 1_000,
    fetch: async (input) => {
      calls += 1;
      const url = String(input);
      if (url === XAI_BILLING_URL) {
        return json({ config: { monthlyLimit: { val: 100 }, used: { val: 25 } } });
      }
      if (url === XAI_BILLING_CREDITS_URL) {
        return json({
          config: {
            currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY" },
            creditUsagePercent: 11,
          },
        });
      }
      return new Response("missing", { status: 404 });
    },
  });
  const first = await service.getSubscriptionUsage({ authProviderId: "xai" });
  const second = await service.getSubscriptionUsage({ authProviderId: "xai" });
  assert.equal(first.status, "ready");
  assert.deepEqual(first, second);
  assert.equal(calls, 2);
  if (first.status !== "ready") return;
  assert.equal(first.windows[0]?.kind, "week");
  assert.equal(first.windows[0]?.remainingPercent, 89);
});

test("用量接口 401 返回 unavailable，不登出", async () => {
  const credentials = createMemoryCredentials();
  seedXai(credentials);
  const { service } = createProviderAuthService({
    credentialService: credentials,
    broadcastService: { send: async () => undefined },
    appVersion: "test",
    fetch: async () => new Response("no", { status: 401 }),
  });
  assert.deepEqual(await service.getSubscriptionUsage({ authProviderId: "xai" }), {
    status: "unavailable",
  });
  assert.equal((await service.getStatus("xai")).status, "connected");
  assert.equal(credentials.data.has("provider-auth:xai"), true);
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
