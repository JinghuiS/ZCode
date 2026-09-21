import { ServiceChannels } from "@zcode/shared";
import { createServiceDescriptor } from "../descriptors.js";

export interface KimiComputerUsePermissions {
  accessibility: boolean;
  screenRecording: boolean;
}

export type KimiComputerUseStatus =
  | { supported: false }
  | { supported: true; installed: false }
  | {
      supported: true;
      installed: true;
      version?: string;
      /** 以 KimiCU 后台服务上报为准；服务未响应时为 null。 */
      permissions: KimiComputerUsePermissions | null;
    };

/**
 * 电脑控制（Kimi Computer Use）的本机状态与安装入口。
 *
 * KimiCU.app 为第三方闭源程序：ZCode 只探测安装与授权状态、拉起官方安装脚本，
 * 不分发二进制，也不在后台静默安装（官方脚本可能需要管理员密码）。
 */
export interface IKimiComputerUseService {
  getStatus(): Promise<KimiComputerUseStatus>;
  /** macOS：在系统「终端」中运行官方安装脚本。 */
  openInstaller(): Promise<void>;
  /** 让 KimiCU 弹出辅助功能与屏幕录制的系统授权。 */
  requestPermissions(): Promise<void>;
}

export const IKimiComputerUseService = createServiceDescriptor<IKimiComputerUseService>(
  ServiceChannels.KimiComputerUse,
);
