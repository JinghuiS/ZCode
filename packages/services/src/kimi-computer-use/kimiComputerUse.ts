import { ServiceChannels } from "@zcode/shared";
import { createServiceDescriptor } from "../descriptors.js";

export interface KimiComputerUsePermissions {
  accessibility: boolean;
  screenRecording: boolean;
}

export type KimiComputerUsePlatform = "macos" | "windows";

/** platform：非 macOS / Windows；macos-version：KimiCU 要求 macOS 14 及以上。 */
export type KimiComputerUseUnsupportedReason = "platform" | "macos-version";

export type KimiComputerUseStatus =
  | { supported: false; reason: KimiComputerUseUnsupportedReason }
  | { supported: true; platform: KimiComputerUsePlatform; installed: false }
  | {
      supported: true;
      platform: KimiComputerUsePlatform;
      installed: true;
      version?: string;
      /**
       * macOS：以 KimiCU 后台服务上报为准，服务未响应时为 null。
       * Windows：没有系统级授权项，恒为 null。
       */
      permissions: KimiComputerUsePermissions | null;
      /**
       * macOS：已安装的 kimi-cu 不含本机 CPU 架构（例如 Intel Mac 装了 arm64 版），
       * 无法启动，需要重新安装对应架构的版本。
       */
      archMismatch?: boolean;
    };

/**
 * 电脑控制（Kimi Computer Use）的本机状态与安装入口。
 *
 * KimiCU.app 为第三方闭源程序：ZCode 只探测安装与授权状态、拉起官方安装脚本，
 * 不分发二进制，也不在后台静默安装（官方脚本可能需要管理员密码）。
 */
export interface IKimiComputerUseService {
  getStatus(): Promise<KimiComputerUseStatus>;
  /** 在用户可见的窗口中运行官方安装脚本（macOS：「终端」；Windows：PowerShell）。 */
  openInstaller(): Promise<void>;
  /** macOS：让 KimiCU 弹出辅助功能与屏幕录制的系统授权。 */
  requestPermissions(): Promise<void>;
}

export const IKimiComputerUseService = createServiceDescriptor<IKimiComputerUseService>(
  ServiceChannels.KimiComputerUse,
);
