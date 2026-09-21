/**
 * xAI Device Authorization Grant（RFC 8628）。
 *
 * 流程与 OpenCode `packages/opencode/src/plugin/xai.ts` 一致：申请 device code → 用户在任意浏览器
 * 输入 user_code 批准 → 轮询 token 端点；运行期用 refresh_token 换新 access_token。
 * device 端点由 xAI `/.well-known/openid-configuration` 的 `device_authorization_endpoint` 公开。
 */

// Grok CLI 公开的 OAuth client（public client，无 secret）。
const XAI_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
const XAI_TOKEN_URL = "https://auth.x.ai/oauth2/token";
const XAI_DEVICE_AUTHORIZATION_URL = "https://auth.x.ai/oauth2/device/code";
const XAI_SCOPE = "openid profile email offline_access grok-cli:access api:access";
const DEVICE_CODE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";

const DEVICE_CODE_DEFAULT_INTERVAL_MS = 5_000;
const DEVICE_CODE_MIN_INTERVAL_MS = 1_000;
const DEVICE_CODE_SLOW_DOWN_INCREMENT_MS = 5_000;
const DEVICE_CODE_DEFAULT_EXPIRES_MS = 5 * 60 * 1000;

export interface XaiOAuthEndpoints {
  tokenUrl: string;
  deviceAuthorizationUrl: string;
}

export const XAI_OAUTH_ENDPOINTS: XaiOAuthEndpoints = {
  tokenUrl: XAI_TOKEN_URL,
  deviceAuthorizationUrl: XAI_DEVICE_AUTHORIZATION_URL,
};

export interface XaiOAuthDeps {
  fetch: typeof fetch;
  userAgent: string;
  endpoints?: XaiOAuthEndpoints;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
}

export interface XaiTokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
}

export interface XaiDeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in?: number;
  interval?: number;
}

/** refresh 被服务端明确拒绝（refresh_token 失效），需要用户重新登录。 */
export class XaiOAuthInvalidGrantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XaiOAuthInvalidGrantError";
  }
}

function formHeaders(userAgent: string): Record<string, string> {
  return {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
    "User-Agent": userAgent,
  };
}

/**
 * 服务端给的秒数可能缺失或是 NaN/负数；直接进 setTimeout 会被当成 0 导致忙轮询，
 * 因此统一归一化并回落默认值。
 */
function positiveSecondsToMs(value: unknown, defaultMs: number): number {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : defaultMs;
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function requestXaiDeviceCode(deps: XaiOAuthDeps): Promise<XaiDeviceCodeResponse> {
  const endpoints = deps.endpoints ?? XAI_OAUTH_ENDPOINTS;
  const response = await deps.fetch(endpoints.deviceAuthorizationUrl, {
    method: "POST",
    headers: formHeaders(deps.userAgent),
    body: new URLSearchParams({ client_id: XAI_CLIENT_ID, scope: XAI_SCOPE }).toString(),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `xAI device code request failed (${response.status})${detail ? `: ${detail}` : ""}`,
    );
  }
  const json = (await response.json()) as XaiDeviceCodeResponse;
  if (!json.device_code || !json.user_code || !json.verification_uri) {
    throw new Error(
      "xAI device code response is missing device_code / user_code / verification_uri",
    );
  }
  return json;
}

export function resolveXaiDeviceCodeExpiresAt(device: XaiDeviceCodeResponse, now: number): number {
  return now + positiveSecondsToMs(device.expires_in, DEVICE_CODE_DEFAULT_EXPIRES_MS);
}

export async function pollXaiDeviceToken(
  device: XaiDeviceCodeResponse,
  deps: XaiOAuthDeps & { signal?: AbortSignal },
): Promise<XaiTokenResponse> {
  const endpoints = deps.endpoints ?? XAI_OAUTH_ENDPOINTS;
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? (() => Date.now());
  const deadline = resolveXaiDeviceCodeExpiresAt(device, now());
  let intervalMs = Math.max(
    positiveSecondsToMs(device.interval, DEVICE_CODE_DEFAULT_INTERVAL_MS),
    DEVICE_CODE_MIN_INTERVAL_MS,
  );

  while (now() < deadline) {
    deps.signal?.throwIfAborted();
    const response = await deps.fetch(endpoints.tokenUrl, {
      method: "POST",
      headers: formHeaders(deps.userAgent),
      body: new URLSearchParams({
        grant_type: DEVICE_CODE_GRANT_TYPE,
        client_id: XAI_CLIENT_ID,
        device_code: device.device_code,
      }).toString(),
      signal: deps.signal,
    });
    if (response.ok) return (await response.json()) as XaiTokenResponse;

    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      error_description?: string;
    };
    const remaining = Math.max(0, deadline - now());
    // RFC 8628 §3.5：authorization_pending 保持间隔继续；slow_down 间隔至少 +5s；其余为终态。
    if (body.error === "authorization_pending") {
      await sleep(Math.min(intervalMs, remaining), deps.signal);
      continue;
    }
    if (body.error === "slow_down") {
      intervalMs += DEVICE_CODE_SLOW_DOWN_INCREMENT_MS;
      await sleep(Math.min(intervalMs, remaining), deps.signal);
      continue;
    }
    if (body.error === "access_denied" || body.error === "authorization_denied") {
      throw new Error("xAI device authorization was denied");
    }
    if (body.error === "expired_token") {
      throw new Error("xAI device code expired, please sign in again");
    }
    const detail = body.error_description ?? body.error ?? "";
    throw new Error(
      `xAI device token exchange failed (${response.status})${detail ? `: ${detail}` : ""}`,
    );
  }
  throw new Error("xAI device authorization timed out");
}

export async function refreshXaiAccessToken(
  refreshToken: string,
  deps: XaiOAuthDeps,
): Promise<XaiTokenResponse> {
  const endpoints = deps.endpoints ?? XAI_OAUTH_ENDPOINTS;
  const response = await deps.fetch(endpoints.tokenUrl, {
    method: "POST",
    headers: formHeaders(deps.userAgent),
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: XAI_CLIENT_ID,
    }).toString(),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    // invalid_grant 表示 refresh_token 已失效或被轮换消费，只能重新登录；其余错误可重试。
    if (response.status === 400 && detail.includes("invalid_grant")) {
      throw new XaiOAuthInvalidGrantError(`xAI refresh token rejected: ${detail}`);
    }
    throw new Error(`xAI token refresh failed (${response.status})${detail ? `: ${detail}` : ""}`);
  }
  return (await response.json()) as XaiTokenResponse;
}
