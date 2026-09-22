/**
 * SuperGrok 套餐用量：Grok CLI 消费端账单代理。
 *
 * 与 Pi `@juanibiapina/pi-usage`、官方 CLI `/usage` 同源。
 * 只接受已解析的 access token，不读 ~/.pi / ~/.grok。
 */
import type { ProviderAuthUsageWindow } from "@zcode/shared/provider-auth";

export const XAI_BILLING_URL = "https://cli-chat-proxy.grok.com/v1/billing";
export const XAI_BILLING_CREDITS_URL = `${XAI_BILLING_URL}?format=credits`;
const XAI_TOKEN_AUTH_HEADER = "xai-grok-cli";
const DEFAULT_TIMEOUT_MS = 15_000;

export interface XaiSubscriptionUsageFetchOk {
  ok: true;
  windows: ProviderAuthUsageWindow[];
}

export interface XaiSubscriptionUsageFetchErr {
  ok: false;
  reason: "unauthorized" | "failed";
  retryAfterMs?: number;
}

export type XaiSubscriptionUsageFetchResult =
  | XaiSubscriptionUsageFetchOk
  | XaiSubscriptionUsageFetchErr;

export interface XaiSubscriptionUsageFetchDeps {
  accessToken: string;
  fetch: typeof fetch;
  userAgent: string;
  now?: () => number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

interface MonthlyBillingConfig {
  monthlyLimit?: { val?: number };
  used?: { val?: number };
  billingPeriodEnd?: string;
}

interface WeeklyBillingConfig {
  currentPeriod?: { type?: string; start?: string; end?: string };
  creditUsagePercent?: number;
  billingPeriodEnd?: string;
}

export function clampUsagePercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

export function toUsagePercents(usedPercent: number): {
  usedPercent: number;
  remainingPercent: number;
} {
  const used = clampUsagePercent(usedPercent);
  return { usedPercent: used, remainingPercent: clampUsagePercent(100 - used) };
}

export function parseBillingResetAt(value: string | undefined): number | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function parseMonthlyUsageWindow(
  config: MonthlyBillingConfig,
): ProviderAuthUsageWindow | undefined {
  const limit = config.monthlyLimit?.val;
  const used = config.used?.val;
  if (typeof limit !== "number" || limit <= 0 || typeof used !== "number" || used < 0) {
    return undefined;
  }
  const percents = toUsagePercents((used / limit) * 100);
  const resetAt = parseBillingResetAt(config.billingPeriodEnd);
  return {
    kind: "month",
    ...percents,
    used,
    limit,
    ...(resetAt === undefined ? {} : { resetAt }),
  };
}

export function parseWeeklyUsageWindow(
  config: WeeklyBillingConfig,
): ProviderAuthUsageWindow | undefined {
  if (config.currentPeriod?.type !== "USAGE_PERIOD_TYPE_WEEKLY") return undefined;
  const raw = config.creditUsagePercent;
  const percents = toUsagePercents(typeof raw === "number" && Number.isFinite(raw) ? raw : 0);
  const resetAt = parseBillingResetAt(config.billingPeriodEnd ?? config.currentPeriod.end);
  return {
    kind: "week",
    ...percents,
    ...(resetAt === undefined ? {} : { resetAt }),
  };
}

export function parseRetryAfterMs(header: string | null, now: number): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (trimmed.length === 0) return undefined;
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(trimmed);
  if (!Number.isFinite(date)) return undefined;
  return Math.max(0, date - now);
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

async function readJsonObject(response: Response): Promise<Record<string, unknown> | undefined> {
  try {
    return asObject(await response.json());
  } catch {
    return undefined;
  }
}

export async function fetchXaiSubscriptionUsage(
  deps: XaiSubscriptionUsageFetchDeps,
): Promise<XaiSubscriptionUsageFetchResult> {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const headers = {
    Authorization: `Bearer ${deps.accessToken}`,
    Accept: "application/json",
    "x-xai-token-auth": XAI_TOKEN_AUTH_HEADER,
    "User-Agent": deps.userAgent,
  };
  const windows: ProviderAuthUsageWindow[] = [];
  let retryAfterMs: number | undefined;

  const monthly = await getJson(XAI_BILLING_URL, headers, deps, timeoutMs);
  if (monthly.kind === "unauthorized") {
    return { ok: false, reason: "unauthorized", ...retryField(monthly.retryAfterMs) };
  }
  if (monthly.kind === "ok") {
    const monthlyWindow = parseMonthlyUsageWindow(asConfig<MonthlyBillingConfig>(monthly.body));
    if (monthlyWindow) windows.push(monthlyWindow);
  } else {
    retryAfterMs = monthly.retryAfterMs ?? retryAfterMs;
  }

  const weekly = await getJson(XAI_BILLING_CREDITS_URL, headers, deps, timeoutMs);
  if (weekly.kind === "unauthorized" && windows.length === 0) {
    return { ok: false, reason: "unauthorized", ...retryField(weekly.retryAfterMs) };
  }
  if (weekly.kind === "ok") {
    const weeklyWindow = parseWeeklyUsageWindow(asConfig<WeeklyBillingConfig>(weekly.body));
    if (weeklyWindow) windows.push(weeklyWindow);
  } else {
    retryAfterMs = weekly.retryAfterMs ?? retryAfterMs;
  }

  if (windows.length === 0) {
    return { ok: false, reason: "failed", ...retryField(retryAfterMs) };
  }
  windows.sort((left, right) => kindOrder(left.kind) - kindOrder(right.kind));
  return { ok: true, windows };
}

function kindOrder(kind: ProviderAuthUsageWindow["kind"]): number {
  return kind === "week" ? 0 : 1;
}

function retryField(retryAfterMs: number | undefined): { retryAfterMs?: number } {
  return retryAfterMs === undefined ? {} : { retryAfterMs };
}

function asConfig<T>(body: Record<string, unknown>): T {
  return (asObject(body["config"]) ?? {}) as T;
}

type GetJsonResult =
  | { kind: "ok"; body: Record<string, unknown> }
  | { kind: "unauthorized"; retryAfterMs?: number }
  | { kind: "failed"; retryAfterMs?: number };

async function getJson(
  url: string,
  headers: Record<string, string>,
  deps: XaiSubscriptionUsageFetchDeps,
  timeoutMs: number,
): Promise<GetJsonResult> {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  if (deps.signal?.aborted) controller.abort();
  else deps.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const now = deps.now ?? (() => Date.now());
  try {
    const response = await deps.fetch(url, { headers, signal: controller.signal });
    const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"), now());
    if (response.status === 401 || response.status === 403) {
      return { kind: "unauthorized", ...retryField(retryAfterMs) };
    }
    if (!response.ok) return { kind: "failed", ...retryField(retryAfterMs) };
    const body = await readJsonObject(response);
    if (!body) return { kind: "failed", ...retryField(retryAfterMs) };
    return { kind: "ok", body };
  } catch {
    return { kind: "failed" };
  } finally {
    clearTimeout(timeout);
    deps.signal?.removeEventListener("abort", abortFromCaller);
  }
}
