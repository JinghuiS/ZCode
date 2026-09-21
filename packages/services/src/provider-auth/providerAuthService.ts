import { join } from "node:path";
import { PROVIDER_AUTH_CHANGED_BROADCAST_CHANNEL } from "@zcode/shared";
import { withFileLock } from "@zcode/shared/node";
import {
  createXaiProviderAuthAdapter,
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
}): ProviderAuthServiceBundle {
  const lockFile = join(getAppConfigDir(), "provider-auth.lock");
  const store: ProviderAuthCredentialStore = {
    load: (key) => options.credentialService.load(key),
    save: (key, value) => options.credentialService.save(key, value),
    delete: (key) => options.credentialService.delete(key),
    withLock: (operation) =>
      withFileLock(lockFile, operation, { lockMaxWaitMs: PROVIDER_AUTH_LOCK_MAX_WAIT_MS }),
  };
  const engine = new ProviderAuthEngine({
    store,
    adapters: [
      createXaiProviderAuthAdapter({
        fetch: options.fetch ?? fetch,
        userAgent: `zcode/${options.appVersion}`,
      }),
    ],
    onChanged: (authProviderId) => {
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
    logout: (authProviderId) => engine.logout(authProviderId),
  };

  return { service, engine };
}
