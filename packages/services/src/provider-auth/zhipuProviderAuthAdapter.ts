import { BIGMODEL_PROVIDER_ID, ZAI_PROVIDER_ID } from "@zcode/shared";
import type { ProviderAuthAdapter } from "@zcode/provider-node";
import type { AccountApiProviderId } from "../model-provider/accountProviderApiTypes.js";
import type { IOAuthService } from "../oauth/oauth.js";

// 智谱账号的 API Key 不过期；用远期时间戳让引擎永远不走刷新分支。
const NON_EXPIRING_KEY_EXPIRES_AT = Number.MAX_SAFE_INTEGER;
const POLL_INTERVAL_MS = 2_000;
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;

interface ZhipuProviderAuthAdapterDeps {
  family: "zai" | "bigmodel";
  oauthService: Pick<
    IOAuthService,
    "startOAuthWithPolling" | "pollPendingOAuth" | "cancelPending" | "logout"
  >;
  loadAccessToken(provider: AccountApiProviderId): Promise<string | null>;
  loadAccountName(provider: AccountApiProviderId): Promise<string | undefined>;
  /** 用智谱登录态解析（或创建）账号下名为 ZCode 的 API Key。 */
  resolveApiKey(provider: AccountApiProviderId, accessToken: string): Promise<string | null>;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  now?: () => number;
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * 智谱 Z.ai / BigModel 账号登录。
 *
 * 账号登录本质是「自动获取 API Key」：复用现有智谱 OAuth（后端轮询 flow）拿到登录态，
 * 再用登录态解析账号下的 API Key，存为 provider-auth:<family>，请求期直接下发该 Key。
 * 登录完成以「出现新的 access token」判定，桌面 deep link 与后端轮询两条路径都能识别。
 */
export function createZhipuProviderAuthAdapter(
  deps: ZhipuProviderAuthAdapterDeps,
): ProviderAuthAdapter {
  const provider: AccountApiProviderId =
    deps.family === "zai" ? ZAI_PROVIDER_ID : BIGMODEL_PROVIDER_ID;
  const sleep = deps.sleep ?? abortableSleep;
  const now = deps.now ?? (() => Date.now());

  return {
    authProviderId: deps.family,
    async startLogin() {
      const previousAccessToken = await deps.loadAccessToken(provider);
      const start = await deps.oauthService.startOAuthWithPolling(provider);
      const expiresAt = now() + LOGIN_TIMEOUT_MS;
      return {
        kind: "browser",
        verificationUri: start.authorizeUrl,
        expiresAt,
        poll: async (signal) => {
          try {
            while (now() < expiresAt) {
              // 推进后端 flow；成功时 oauthService 会写入新的登录凭据。
              await deps.oauthService.pollPendingOAuth();
              const accessToken = await deps.loadAccessToken(provider);
              if (accessToken && accessToken !== previousAccessToken) {
                const apiKey = await deps.resolveApiKey(provider, accessToken);
                if (!apiKey) {
                  throw new Error("未能从智谱账号获取 API Key，请确认账号已开通 API 服务");
                }
                const name = await deps.loadAccountName(provider);
                return {
                  access: apiKey,
                  expiresAt: NON_EXPIRING_KEY_EXPIRES_AT,
                  ...(name ? { account: { name } } : {}),
                };
              }
              await sleep(POLL_INTERVAL_MS, signal);
            }
            throw new Error("智谱账号授权超时，请重新登录");
          } catch (error) {
            if (signal.aborted) await deps.oauthService.cancelPending(provider).catch(() => {});
            throw error;
          }
        },
      };
    },
    async onLogout() {
      // 智谱登录态同时服务于会话分享、官方 MCP 等能力；登出 provider 时一并清理，避免残留。
      await deps.oauthService.logout(provider);
    },
  };
}
