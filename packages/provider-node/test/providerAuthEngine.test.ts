import assert from "node:assert/strict";
import test from "node:test";
import {
  ProviderAuthEngine,
  ProviderAuthInvalidGrantError,
  type ProviderAuthAdapter,
  type ProviderAuthCredentialStore,
  type ProviderAuthTokenSet,
} from "../src/provider-auth/provider-auth-engine.js";
import { pollXaiDeviceToken } from "../src/provider-auth/xai-device-oauth.js";

function createMemoryStore(): ProviderAuthCredentialStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  let tail = Promise.resolve();
  return {
    data,
    load: async (key) => data.get(key) ?? null,
    save: async (key, value) => void data.set(key, value),
    delete: async (key) => void data.delete(key),
    // 模拟跨进程互斥：串行执行。
    withLock<T>(operation: () => Promise<T>): Promise<T> {
      const run = tail.then(operation);
      tail = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
}

function seedCredential(
  store: ProviderAuthCredentialStore & { data: Map<string, string> },
  credential: Record<string, unknown>,
) {
  store.data.set("provider-auth:xai", JSON.stringify({ version: 1, ...credential }));
}

function createAdapter(
  refresh: (refreshToken: string) => Promise<ProviderAuthTokenSet>,
): ProviderAuthAdapter {
  return {
    authProviderId: "xai",
    startLogin: async () => {
      throw new Error("not used");
    },
    refresh,
  };
}

const NOW = 1_000_000_000_000;

test("未过期的 token 直接返回，不触发刷新", async () => {
  const store = createMemoryStore();
  seedCredential(store, { access: "a1", refresh: "r1", expiresAt: NOW + 3600_000 });
  let refreshCalls = 0;
  const engine = new ProviderAuthEngine({
    store,
    adapters: [createAdapter(async () => (refreshCalls++, { access: "x", expiresAt: 0 }))],
    now: () => NOW,
  });
  assert.equal(await engine.resolveAccessToken("xai"), "a1");
  assert.equal(refreshCalls, 0);
});

test("临近过期时刷新并写回轮换后的 refresh token；并发请求只刷新一次", async () => {
  const store = createMemoryStore();
  seedCredential(store, { access: "a1", refresh: "r1", expiresAt: NOW + 60_000 });
  const seen: string[] = [];
  const engine = new ProviderAuthEngine({
    store,
    adapters: [
      createAdapter(async (refreshToken) => {
        seen.push(refreshToken);
        return { access: "a2", refresh: "r2", expiresAt: NOW + 3600_000 };
      }),
    ],
    now: () => NOW,
  });
  const tokens = await Promise.all([
    engine.resolveAccessToken("xai"),
    engine.resolveAccessToken("xai"),
    engine.resolveAccessToken("xai"),
  ]);
  assert.deepEqual(tokens, ["a2", "a2", "a2"]);
  assert.deepEqual(seen, ["r1"]);
  const stored = JSON.parse(store.data.get("provider-auth:xai") ?? "{}");
  assert.equal(stored.refresh, "r2");
});

test("拿锁后发现其他进程已刷新，直接使用新 token，不再消耗 refresh token", async () => {
  const store = createMemoryStore();
  seedCredential(store, { access: "a1", refresh: "r1", expiresAt: NOW + 60_000 });
  let refreshCalls = 0;
  const engine = new ProviderAuthEngine({
    store,
    adapters: [createAdapter(async () => (refreshCalls++, { access: "x", expiresAt: 0 }))],
    now: () => NOW,
  });
  // 模拟另一个 Host 进程在本进程读到旧凭据后、拿锁前完成刷新。
  const originalWithLock = store.withLock.bind(store);
  store.withLock = (operation) => {
    seedCredential(store, { access: "a-other", refresh: "r-other", expiresAt: NOW + 3600_000 });
    return originalWithLock(operation);
  };
  assert.equal(await engine.resolveAccessToken("xai"), "a-other");
  assert.equal(refreshCalls, 0);
});

test("invalid_grant 标记凭据失效，状态变为 expired，后续请求给出重新登录提示", async () => {
  const store = createMemoryStore();
  seedCredential(store, { access: "a1", refresh: "r1", expiresAt: NOW - 1 });
  const changed: string[] = [];
  const engine = new ProviderAuthEngine({
    store,
    adapters: [
      createAdapter(async () => {
        throw new ProviderAuthInvalidGrantError("invalid_grant");
      }),
    ],
    now: () => NOW,
    onChanged: (id) => changed.push(id),
  });
  await assert.rejects(engine.resolveAccessToken("xai"), ProviderAuthInvalidGrantError);
  assert.equal((await engine.getStatus("xai")).status, "expired");
  assert.deepEqual(changed, ["xai"]);
  await assert.rejects(engine.resolveAccessToken("xai"), /sign in again/);
});

test("网络错误不清除凭据，下次请求可重试", async () => {
  const store = createMemoryStore();
  seedCredential(store, { access: "a1", refresh: "r1", expiresAt: NOW - 1 });
  let attempt = 0;
  const engine = new ProviderAuthEngine({
    store,
    adapters: [
      createAdapter(async () => {
        attempt++;
        if (attempt === 1) throw new Error("ECONNRESET");
        return { access: "a2", expiresAt: NOW + 3600_000 };
      }),
    ],
    now: () => NOW,
  });
  await assert.rejects(engine.resolveAccessToken("xai"), /ECONNRESET/);
  assert.equal((await engine.getStatus("xai")).status, "connected");
  assert.equal(await engine.resolveAccessToken("xai"), "a2");
});

test("未登录时返回明确错误；登出后状态为 disconnected", async () => {
  const store = createMemoryStore();
  const engine = new ProviderAuthEngine({
    store,
    adapters: [createAdapter(async () => ({ access: "x", expiresAt: 0 }))],
    now: () => NOW,
  });
  await assert.rejects(engine.resolveAccessToken("xai"), /not connected/);
  seedCredential(store, { access: "a1", expiresAt: NOW + 3600_000 });
  assert.equal((await engine.getStatus("xai")).status, "connected");
  await engine.logout("xai");
  assert.equal((await engine.getStatus("xai")).status, "disconnected");
});

test("设备码轮询：pending 继续、slow_down 增加间隔、成功返回 token", async () => {
  const responses = [
    { status: 400, body: { error: "authorization_pending" } },
    { status: 400, body: { error: "slow_down" } },
    { status: 200, body: { access_token: "a1", refresh_token: "r1", expires_in: 3600 } },
  ];
  const sleeps: number[] = [];
  let clock = NOW;
  const tokens = await pollXaiDeviceToken(
    {
      device_code: "d",
      user_code: "U",
      verification_uri: "https://x",
      interval: 5,
      expires_in: 600,
    },
    {
      userAgent: "test",
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
      fetch: (async () => {
        const next = responses.shift()!;
        return new Response(JSON.stringify(next.body), { status: next.status });
      }) as typeof fetch,
    },
  );
  assert.equal(tokens.access_token, "a1");
  assert.deepEqual(sleeps, [5000, 10000]);
});

test("设备码轮询：用户拒绝授权时报错", async () => {
  await assert.rejects(
    pollXaiDeviceToken(
      { device_code: "d", user_code: "U", verification_uri: "https://x" },
      {
        userAgent: "test",
        sleep: async () => undefined,
        fetch: (async () =>
          new Response(JSON.stringify({ error: "access_denied" }), {
            status: 400,
          })) as typeof fetch,
      },
    ),
    /denied/,
  );
});
