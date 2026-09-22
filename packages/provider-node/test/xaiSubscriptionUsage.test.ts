import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchXaiSubscriptionUsage,
  parseMonthlyUsageWindow,
  parseWeeklyUsageWindow,
  toUsagePercents,
  XAI_BILLING_CREDITS_URL,
  XAI_BILLING_URL,
} from "../src/provider-auth/xai-subscription-usage.js";

test("toUsagePercents 把已用占比转成剩余，并夹在 0–100", () => {
  assert.deepEqual(toUsagePercents(11), { usedPercent: 11, remainingPercent: 89 });
  assert.deepEqual(toUsagePercents(25), { usedPercent: 25, remainingPercent: 75 });
  assert.deepEqual(toUsagePercents(-4), { usedPercent: 0, remainingPercent: 100 });
  assert.deepEqual(toUsagePercents(140), { usedPercent: 100, remainingPercent: 0 });
});

test("月度窗口用 used/limit 计算百分比", () => {
  const window = parseMonthlyUsageWindow({
    monthlyLimit: { val: 100000 },
    used: { val: 25000 },
    billingPeriodEnd: "2026-08-01T00:00:00+00:00",
  });
  assert.deepEqual(window, {
    kind: "month",
    usedPercent: 25,
    remainingPercent: 75,
    used: 25000,
    limit: 100000,
    resetAt: Date.parse("2026-08-01T00:00:00+00:00"),
  });
});

test("周池只接受 WEEKLY period；缺百分比按 0 已用", () => {
  assert.equal(
    parseWeeklyUsageWindow({
      currentPeriod: { type: "USAGE_PERIOD_TYPE_MONTHLY" },
      creditUsagePercent: 11,
    }),
    undefined,
  );
  const window = parseWeeklyUsageWindow({
    currentPeriod: {
      type: "USAGE_PERIOD_TYPE_WEEKLY",
      start: "2026-07-17T00:00:00+00:00",
      end: "2026-07-24T00:00:00+00:00",
    },
    billingPeriodEnd: "2026-07-24T00:00:00+00:00",
  });
  assert.equal(window?.kind, "week");
  assert.equal(window?.usedPercent, 0);
  assert.equal(window?.remainingPercent, 100);
});

test("fetchXaiSubscriptionUsage 合并周/月窗口，周在前", async () => {
  const seen: string[] = [];
  const result = await fetchXaiSubscriptionUsage({
    accessToken: "tok",
    userAgent: "zcode/test",
    fetch: async (input, init) => {
      const url = String(input);
      seen.push(url);
      const auth = new Headers(init?.headers).get("Authorization");
      const marker = new Headers(init?.headers).get("x-xai-token-auth");
      assert.equal(auth, "Bearer tok");
      assert.equal(marker, "xai-grok-cli");
      if (url === XAI_BILLING_URL) {
        return jsonResponse({
          config: {
            monthlyLimit: { val: 100000 },
            used: { val: 25000 },
            billingPeriodEnd: "2026-08-01T00:00:00+00:00",
          },
        });
      }
      if (url === XAI_BILLING_CREDITS_URL) {
        return jsonResponse({
          config: {
            currentPeriod: {
              type: "USAGE_PERIOD_TYPE_WEEKLY",
              end: "2026-07-24T00:00:00+00:00",
            },
            creditUsagePercent: 11,
            billingPeriodEnd: "2026-07-24T00:00:00+00:00",
          },
        });
      }
      return new Response("missing", { status: 404 });
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(seen, [XAI_BILLING_URL, XAI_BILLING_CREDITS_URL]);
  assert.equal(result.windows[0]?.kind, "week");
  assert.equal(result.windows[0]?.remainingPercent, 89);
  assert.equal(result.windows[1]?.kind, "month");
  assert.equal(result.windows[1]?.remainingPercent, 75);
});

test("月度 401 不登出语义：返回 unauthorized，且不再打周池", async () => {
  let calls = 0;
  const result = await fetchXaiSubscriptionUsage({
    accessToken: "tok",
    userAgent: "zcode/test",
    fetch: async () => {
      calls += 1;
      return new Response("no", { status: 401 });
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, { ok: false, reason: "unauthorized" });
});

test("只有月度成功时仍返回 ready 窗口", async () => {
  const result = await fetchXaiSubscriptionUsage({
    accessToken: "tok",
    userAgent: "zcode/test",
    fetch: async (input) => {
      if (String(input) === XAI_BILLING_URL) {
        return jsonResponse({
          config: { monthlyLimit: { val: 10 }, used: { val: 1 } },
        });
      }
      return new Response("down", { status: 500 });
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.windows.length, 1);
  assert.equal(result.windows[0]?.kind, "month");
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
