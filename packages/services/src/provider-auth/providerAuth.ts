import {
  ServiceChannels,
  type ProviderAuthDeviceLoginStart,
  type ProviderAuthLoginResult,
  type ProviderAuthProviderId,
  type ProviderAuthStatus,
} from "@zcode/shared";
import { createServiceDescriptor } from "../descriptors.js";

/**
 * Provider 级认证服务（RPC 面向 UI）。
 *
 * 只暴露状态与登录流程；access token 永不经 RPC 下发给渲染进程，
 * 模型请求期的鉴权材料由 Host 内部的 ProviderAuthEngine 直接交给 Agent。
 */
export interface IProviderAuthService {
  getStatus(authProviderId: ProviderAuthProviderId): Promise<ProviderAuthStatus>;
  startDeviceLogin(authProviderId: ProviderAuthProviderId): Promise<ProviderAuthDeviceLoginStart>;
  /** 长等待：用户完成授权、取消或失败后返回。 */
  awaitLogin(loginId: string): Promise<ProviderAuthLoginResult>;
  cancelLogin(loginId: string): Promise<void>;
  logout(authProviderId: ProviderAuthProviderId): Promise<void>;
}

export const IProviderAuthService = createServiceDescriptor<IProviderAuthService>(
  ServiceChannels.ProviderAuth,
);
