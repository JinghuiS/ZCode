import { join } from "node:path";
import {
  PROVIDER_AUTH_CHANGED_BROADCAST_CHANNEL,
  type ProviderAuthProviderId,
  type ProviderAuthSubscriptionUsage,
} from "@zcode/shared";
import { withFileLock } from "@zcode/shared/node";
import {
  createXaiProviderAuthAdapter,
  fetchXaiSubscriptionUsage,
  ProviderAuthEngine,
  type ProviderAuthCredentialStore,
} from "@zcode/provider-node";
import type { IBroadcastService } from "../broadcast/broadcast.js";
import type { ICredentialService } from "../credential/credential.js";
import { createServiceLogger } from "../logger/serviceLogger.js";
import { getAppConfigDir } from "../paths.js";
import type { IProviderAuthService } from "./providerAuth.js";

const logger = createServiceLogger("providerAuthService");

// 刷新 token 需要一次网络往返；其他进程等锁的上限要覆盖它，避免误判超时。
const PROVIDER_AUTH_LOCK_MAX_WAIT_MS = 60_000;
const USAGE_SUCCESS_TTL_MS = 5 * 60 * 1000;
const USAGE_FAILURE_BACKOFF_MS = 30_000;

interface CachedUsage {
  expiresAt: number;
  value: ProviderAuthSubscriptionUsage;
}

export interface ProviderAuthServiceBundle {
  /** 注册到 RPC 的 UI 门面，不含 token 读取能力。 */
  service: IProviderAuthService;
  /** Host 内部使用：模型请求期解析 access token。 */
  engine: ProviderAuthEngine;
}

export function createProviderAuthService(options: {
  credentialService: ICredentialService;
  broadcastService: Pick<IBroadcastService, "send">;
  appVersion: string;
  fetch?: typeof fetch;
  now?: () => number;
}): ProviderAuthServiceBundle {
  const lockFile = join(getAppConfigDir(), "provider-auth.lock");
  const store: ProviderAuthCredentialStore = {
    load: (key) => options.credentialService.load(key),
    save: (key, value) => options.credentialService.save(key, value),
    delete: (key) => options.credentialService.delete(key),
    withLock: (operation) =>
      withFileLock(lockFile, operation, { lockMaxWaitMs: PROVIDER_AUTH_LOCK_MAX_WAIT_MS }),
  };
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? (() => Date.now());
  const usageCache = new Map<ProviderAuthProviderId, CachedUsage>();
  const usageFlights = new Map<ProviderAuthProviderId, Promise<ProviderAuthSubscriptionUsage>>();
  const engine = new ProviderAuthEngine({
    store,
    adapters: [
      createXaiProviderAuthAdapter({
        fetch: fetchImpl,
        userAgent: `zcode/${options.appVersion}`,
      }),
    ],
    onChanged: (authProviderId) => {
      usageCache.delete(authProviderId);
      logger.info("provider auth changed", { authProviderId });
      void options.broadcastService.send({
        channel: PROVIDER_AUTH_CHANGED_BROADCAST_CHANNEL,
        payload: { authProviderId },
      });
    },
  });

  const service: IProviderAuthService = {
    getStatus: (authProviderId) => engine.getStatus(authProviderId),
    async startLogin(authProviderId) {
      const start = await engine.startLogin(authProviderId);
      logger.info("provider login started", { authProviderId, loginId: start.loginId });
      return start;
    },
    async awaitLogin(loginId) {
      const result = await engine.awaitLogin(loginId);
      logger.info("provider login finished", { loginId, status: result.status });
      return result;
    },
    async cancelLogin(loginId) {
      engine.cancelLogin(loginId);
    },
    async logout(authProviderId) {
      usageCache.delete(authProviderId);
      await engine.logout(authProviderId);
    },
    async getSubscriptionUsage(input) {
      if (input.authProviderId !== "xai") return { status: "unsupported" };
      const cached = usageCache.get(input.authProviderId);
      // 手动刷新只绕过成功快照；失败退避仍生效，避免 429 连打。
      if (
        cached &&
        cached.expiresAt > now() &&
        (!input.forceRefresh || cached.value.status !== "ready")
      ) {
        return cached.value;
      }
      const inflight = usageFlights.get(input.authProviderId);
      if (inflight) return inflight;
      const flight = loadXaiSubscriptionUsage({
        engine,
        fetchImpl,
        userAgent: `zcode/${options.appVersion}`,
        now,
      })
        .then((result) => {
          usageCache.set(input.authProviderId, {
            value: result.value,
            expiresAt: now() + result.ttlMs,
          });
          return result.value;
        })
        .finally(() => {
          usageFlights.delete(input.authProviderId);
        });
      usageFlights.set(input.authProviderId, flight);
      return flight;
    },
  };

  return { service, engine };
}

async function loadXaiSubscriptionUsage(input: {
  engine: ProviderAuthEngine;
  fetchImpl: typeof fetch;
  userAgent: string;
  now: () => number;
}): Promise<{ value: ProviderAuthSubscriptionUsage; ttlMs: number }> {
  let accessToken: string;
  try {
    accessToken = await input.engine.resolveAccessToken("xai");
  } catch {
    return { value: { status: "unavailable" }, ttlMs: USAGE_FAILURE_BACKOFF_MS };
  }
  const fetched = await fetchXaiSubscriptionUsage({
    accessToken,
    fetch: input.fetchImpl,
    userAgent: input.userAgent,
    now: input.now,
  });
  if (!fetched.ok) {
    logger.warn("xAI SuperGrok 用量查询失败", { reason: fetched.reason });
    return {
      value: { status: "unavailable" },
      ttlMs: fetched.retryAfterMs ?? USAGE_FAILURE_BACKOFF_MS,
    };
  }
  return {
    value: {
      status: "ready",
      fetchedAt: input.now(),
      windows: fetched.windows,
    },
    ttlMs: USAGE_SUCCESS_TTL_MS,
  };
}
