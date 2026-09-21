import { z } from "zod";

/**
 * Provider 认证抽象的共享契约。
 *
 * 凭据归属于具体 provider（`provider-auth:<authProviderId>`），不再挂在全局客户端 user 上；
 * provider 配置里只保存 `{ type: "provider-oauth", authProviderId }` 引用，不含任何密钥。
 */

export const providerAuthProviderIdSchema = z.enum(["xai"]);
export type ProviderAuthProviderId = z.infer<typeof providerAuthProviderIdSchema>;

/** 模型请求期随 runtime headers 请求携带的认证引用。 */
export const providerAuthRefSchema = z
  .object({
    type: z.literal("provider-oauth"),
    authProviderId: providerAuthProviderIdSchema,
  })
  .strict();
export type ProviderAuthRef = z.infer<typeof providerAuthRefSchema>;

export const providerAuthAccountSchema = z
  .object({
    email: z.string().optional(),
    subject: z.string().optional(),
  })
  .strict();
export type ProviderAuthAccount = z.infer<typeof providerAuthAccountSchema>;

/**
 * connected：有可用凭据；expired：refresh 被服务端拒绝（invalid_grant），需要重新登录；
 * disconnected：从未登录或已登出。
 */
export const providerAuthConnectionStatusSchema = z.enum(["disconnected", "connected", "expired"]);
export type ProviderAuthConnectionStatus = z.infer<typeof providerAuthConnectionStatusSchema>;

export interface ProviderAuthStatus {
  authProviderId: ProviderAuthProviderId;
  status: ProviderAuthConnectionStatus;
  account?: ProviderAuthAccount;
}

/** Device Code 登录开始后 UI 需要展示的材料。 */
export interface ProviderAuthDeviceLoginStart {
  loginId: string;
  authProviderId: ProviderAuthProviderId;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  /** Unix 毫秒。 */
  expiresAt: number;
}

export type ProviderAuthLoginResult =
  | { status: "connected"; account?: ProviderAuthAccount }
  | { status: "cancelled" }
  | { status: "failed"; errorMessage: string };

/** 凭据变化后广播，其他窗口据此刷新卡片状态。 */
export const PROVIDER_AUTH_CHANGED_BROADCAST_CHANNEL = "provider-auth:changed";

export function providerAuthCredentialKey(authProviderId: ProviderAuthProviderId): string {
  return `provider-auth:${authProviderId}`;
}
