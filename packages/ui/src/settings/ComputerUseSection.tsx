// 设置页「电脑控制 (Computer Use)」分区：
//  - 总开关：开/关官方电脑控制插件（连带其 kimi-cu MCP server 与 skill 一起启用/禁用）。
//  - 输入框入口开关：控制输入框常驻「电脑操作」按钮的显隐。
//  - Kimi Computer Use 状态（不依赖插件开关）：安装与版本，macOS 另有辅助功能 / 屏幕录制授权，提供安装与授权入口。
// 电脑控制由 Kimi Computer Use（macOS: KimiCU.app；Windows x64: kimi-cu.exe）提供，见 specs/computer-use-kimi.md。
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import type { RemoteTarget } from "@zcode/shared";
import { isRemoteWorkspaceIdentity, ZCODE_CUA_OFFICIAL_PLUGIN_ID } from "@zcode/shared";
import type { KimiComputerUseStatus } from "@zcode/services";
import { Button } from "@/components/ui/button.js";
import { toast } from "@/components/ui/toast.js";
import { Switch } from "@/components/ui/switch.js";
import { useKimiComputerUseStatus } from "@/hooks/useKimiComputerUseStatus.js";
import { useServices } from "@/hooks/useServices.js";
import { useSettings } from "@/hooks/useSettingService.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { usePluginManagementStore } from "@/store/pluginManagementStore.js";
import { SettingsBadge, SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";
import { StatusDot, type StatusDotTone } from "@/settings/StatusDot.js";
import { runAfterSuccessfulPluginEnabledChange } from "@/settings/pluginEnabledChange.js";
import {
  isComputerUseRemoteOrLinux,
  resolveComputerUseAvailability,
} from "@/settings/computerUseAvailability.js";

interface ComputerUseSectionProps {
  isDesktop?: boolean;
  isMacDesktop?: boolean;
  isWindowsDesktop?: boolean;
  workspacePath?: string | null;
  workspaceIdentity?: string;
  remoteSessionId?: string | null;
  remoteTarget?: RemoteTarget | null;
  localWorkspacePath?: string | null;
}

type PermissionState = "granted" | "missing" | "unknown";

function resolvePermissionState(
  status: KimiComputerUseStatus | null,
  kind: "accessibility" | "screenRecording",
): PermissionState {
  if (!status?.supported || !status.installed || !status.permissions) return "unknown";
  return status.permissions[kind] ? "granted" : "missing";
}

export function ComputerUseSection({
  isDesktop = false,
  isMacDesktop,
  isWindowsDesktop = false,
  workspacePath,
  workspaceIdentity,
  remoteSessionId,
  remoteTarget,
}: ComputerUseSectionProps) {
  const { intl } = useZCodeIntl();
  const services = useServices();
  const pluginManagementService = services.pluginManagementService;
  const isLocalWorkspace =
    !remoteSessionId &&
    !remoteTarget &&
    !(workspaceIdentity?.trim() && isRemoteWorkspaceIdentity(workspaceIdentity.trim()));
  const availability = resolveComputerUseAvailability({
    isDesktop: isDesktop || isWindowsDesktop,
    isMacDesktop,
    isWindowsDesktop,
    remoteSessionId,
    remoteTarget,
    workspaceIdentity,
  });
  // KimiCU 作用于运行 Host 的本机：远端 workspace 不提供设置；是否支持当前系统由 Host 探测。
  const supportsComputerUseSettings = isLocalWorkspace;

  // 总开关 = 官方电脑控制插件启用态（切换即同步启用/禁用插件及其 MCP + skill）。
  const plugins = usePluginManagementStore((state) => state.plugins);
  const setPluginEnabled = usePluginManagementStore((state) => state.setEnabled);
  const initializePlugins = usePluginManagementStore((state) => state.initialize);
  const togglingPluginId = usePluginManagementStore((state) => state.togglingPluginId);
  const cuaPlugin = plugins.find((plugin) => plugin.id === ZCODE_CUA_OFFICIAL_PLUGIN_ID);
  const cuaEnabled = cuaPlugin?.enabled ?? false;
  const cuaToggling = togglingPluginId === ZCODE_CUA_OFFICIAL_PLUGIN_ID;

  const {
    status: kimiStatus,
    loading: kimiLoading,
    refresh: refreshKimiStatus,
  } = useKimiComputerUseStatus(supportsComputerUseSettings);

  const mountedRef = useRef(true);
  const pluginToggleGenerationRef = useRef(0);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      pluginToggleGenerationRef.current += 1;
    };
  }, []);

  const initRef = useRef(false);
  useEffect(() => {
    if (
      initRef.current ||
      !supportsComputerUseSettings ||
      !workspacePath ||
      !pluginManagementService
    )
      return;
    initRef.current = true;
    // 复用 Plugins 分区同一条初始化路径，确保 store 已加载电脑控制插件的 enabled 态。
    void initializePlugins({
      workspacePath,
      workspaceIdentity,
      pluginService: pluginManagementService,
    });
  }, [
    supportsComputerUseSettings,
    workspacePath,
    workspaceIdentity,
    pluginManagementService,
    initializePlugins,
  ]);

  const onTogglePlugin = useCallback(
    async (next: boolean) => {
      if (!pluginManagementService) return;
      const operationGeneration = ++pluginToggleGenerationRef.current;
      const completed = await runAfterSuccessfulPluginEnabledChange({
        submit: () => setPluginEnabled(ZCODE_CUA_OFFICIAL_PLUGIN_ID, next, pluginManagementService),
        isCurrent: () =>
          mountedRef.current && pluginToggleGenerationRef.current === operationGeneration,
        onSuccess: () => {
          if (!next) {
            toast(intl.formatMessage({ id: "settings.computerUse.disabledToast" }));
          }
        },
      });
      if (!completed && mountedRef.current) {
        const message = usePluginManagementStore.getState().error;
        if (message) toast(message);
      }
    },
    [pluginManagementService, setPluginEnabled, intl],
  );

  // 输入框常驻入口的显隐。隐藏开关用 useSettings().update 写入
  // （直连 settingService 只落盘不刷新共享 snapshot，输入框按钮读不到新值）。
  // 乐观更新本地开关，失败回滚并提示。
  const { settings: appSettings, update: updateAppSettings } = useSettings();
  const [composerEntryHiddenOverride, setComposerEntryHiddenOverride] = useState<boolean | null>(
    null,
  );
  const [composerEntrySaving, setComposerEntrySaving] = useState(false);
  // 默认隐藏，与 useCuaComposerEntry 同口径：只有显式存过 false 才算展示。
  const persistedComposerEntryHidden = appSettings?.computerUseComposerEntryHidden !== false;
  const composerEntryVisible = !(composerEntryHiddenOverride ?? persistedComposerEntryHidden);
  useEffect(() => {
    if (composerEntryHiddenOverride === null) return;
    if (persistedComposerEntryHidden === composerEntryHiddenOverride) {
      setComposerEntryHiddenOverride(null);
    }
  }, [composerEntryHiddenOverride, persistedComposerEntryHidden]);
  const onToggleComposerEntry = useCallback(
    async (visible: boolean) => {
      const nextHidden = !visible;
      setComposerEntryHiddenOverride(nextHidden);
      setComposerEntrySaving(true);
      try {
        await updateAppSettings({ computerUseComposerEntryHidden: nextHidden });
      } catch (error) {
        if (mountedRef.current) {
          setComposerEntryHiddenOverride(null);
          toast(
            intl.formatMessage(
              { id: "settings.computerUse.composerEntry.saveFailed" },
              { error: error instanceof Error ? error.message : String(error) },
            ),
          );
        }
      } finally {
        if (mountedRef.current) setComposerEntrySaving(false);
      }
    },
    [intl, updateAppSettings],
  );

  const onInstall = useCallback(async () => {
    try {
      await services.kimiComputerUseService.openInstaller();
    } catch (error) {
      toast(
        intl.formatMessage(
          { id: "settings.computerUse.kimi.installFailed" },
          { error: error instanceof Error ? error.message : String(error) },
        ),
      );
    }
  }, [services.kimiComputerUseService, intl]);

  const onRequestPermissions = useCallback(async () => {
    try {
      await services.kimiComputerUseService.requestPermissions();
    } catch (error) {
      toast(
        intl.formatMessage(
          { id: "settings.computerUse.kimi.grantFailed" },
          { error: error instanceof Error ? error.message : String(error) },
        ),
      );
    }
  }, [services.kimiComputerUseService, intl]);

  if (!supportsComputerUseSettings) {
    // 远端环境若直接 return null，设置页只剩标题，会让用户误以为页面加载失败。
    return (
      <div className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-ui-base text-warning">
        <p className="font-medium">
          {intl.formatMessage({ id: "settings.computerUse.unsupported.title" })}
        </p>
        <p className="mt-1 text-ui-sm text-foreground-subtle">
          {intl.formatMessage({
            id:
              isComputerUseRemoteOrLinux(availability) && availability.kind === "local-linux"
                ? "settings.computerUse.unsupported.linuxDescription"
                : "settings.computerUse.unsupported.remoteDescription",
          })}
        </p>
      </div>
    );
  }

  const installView = ((): { tone: StatusDotTone; text: string } => {
    if (!kimiStatus) {
      return {
        tone: "muted",
        text: intl.formatMessage({ id: "settings.computerUse.kimi.checking" }),
      };
    }
    if (!kimiStatus.supported) {
      return {
        tone: "muted",
        text: intl.formatMessage({ id: "settings.computerUse.kimi.unsupported" }),
      };
    }
    if (!kimiStatus.installed) {
      return {
        tone: "red",
        text: intl.formatMessage({ id: "settings.computerUse.kimi.notInstalled" }),
      };
    }
    return {
      tone: "green",
      text: kimiStatus.version
        ? intl.formatMessage(
            { id: "settings.computerUse.kimi.installed" },
            { version: kimiStatus.version },
          )
        : intl.formatMessage({ id: "settings.computerUse.kimi.installedNoVersion" }),
    };
  })();

  const permissionView = (state: PermissionState): { tone: StatusDotTone; text: string } => {
    if (state === "granted") {
      return { tone: "green", text: intl.formatMessage({ id: "cuaPermission.status.granted" }) };
    }
    if (state === "missing") {
      return { tone: "red", text: intl.formatMessage({ id: "cuaPermission.status.missing" }) };
    }
    return { tone: "muted", text: intl.formatMessage({ id: "cuaPermission.status.unknown" }) };
  };

  const renderBadge = (view: { tone: StatusDotTone; text: string }): ReactNode => (
    <SettingsBadge>
      <span className="inline-flex items-center gap-1.5">
        <StatusDot tone={view.tone} />
        {view.text}
      </span>
    </SettingsBadge>
  );

  const renderGrantDetail = (state: PermissionState): ReactNode =>
    state === "granted" ? undefined : (
      <div className="flex flex-col items-start gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void onRequestPermissions()}
        >
          {intl.formatMessage({ id: "settings.computerUse.kimi.grant" })}
        </Button>
        <span className="text-ui-sm text-foreground-subtlest">
          {intl.formatMessage({ id: "settings.computerUse.kimi.grantHint" })}
        </span>
      </div>
    );

  const kimiInstalled = Boolean(kimiStatus?.supported && kimiStatus.installed);
  // 只有 macOS 需要系统级授权（辅助功能 / 屏幕录制）；Windows 版无授权项。
  const isKimiMacOs = kimiStatus?.supported === true && kimiStatus.platform === "macos";
  const isKimiWindows = kimiStatus?.supported === true && kimiStatus.platform === "windows";
  const serviceUnavailable =
    isKimiMacOs && kimiStatus?.supported === true && kimiStatus.installed
      ? kimiStatus.permissions === null
      : false;
  const accessibilityState = resolvePermissionState(kimiStatus, "accessibility");
  const screenRecordingState = resolvePermissionState(kimiStatus, "screenRecording");

  return (
    <div className="space-y-4">
      <SettingsGroupCard>
        <SettingsRow
          label={intl.formatMessage({ id: "settings.computerUse.toggleLabel" })}
          description={intl.formatMessage({
            // 插件启停按工作区读写；没有打开工作区时开关置灰，这里说明原因而不是只留灰态。
            id: workspacePath
              ? "settings.computerUse.toggleDescription"
              : "settings.computerUse.toggleRequiresWorkspace",
          })}
          control={
            <Switch
              aria-label={intl.formatMessage({ id: "settings.computerUse.toggleLabel" })}
              checked={cuaEnabled}
              disabled={cuaToggling || !workspacePath}
              onCheckedChange={(checked) => void onTogglePlugin(checked)}
            />
          }
        />
        {/* 电脑控制关闭时输入框按钮无论如何都不渲染，此时置灰开关并说明前置条件。 */}
        <SettingsRow
          label={intl.formatMessage({ id: "settings.computerUse.composerEntry.label" })}
          description={intl.formatMessage({
            id: cuaEnabled
              ? "settings.computerUse.composerEntry.description"
              : "settings.computerUse.composerEntry.requiresEnabled",
          })}
          control={
            <Switch
              aria-label={intl.formatMessage({ id: "settings.computerUse.composerEntry.label" })}
              checked={composerEntryVisible}
              disabled={composerEntrySaving || !cuaEnabled}
              onCheckedChange={(checked) => void onToggleComposerEntry(checked)}
            />
          }
        />
      </SettingsGroupCard>

      {/* KimiCU 状态独立于插件开关：未启用时也要能看到「未安装 → 安装」，否则新用户无从下手。 */}
      <SettingsGroupCard>
        <SettingsRow
          controlLayout="wide"
          label={intl.formatMessage({ id: "settings.computerUse.kimi.title" })}
          description={intl.formatMessage({ id: "settings.computerUse.kimi.description" })}
          control={
            <div className="flex items-center gap-2">
              {renderBadge(installView)}
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={intl.formatMessage({ id: "settings.computerUse.kimi.refresh" })}
                title={intl.formatMessage({ id: "settings.computerUse.kimi.refresh" })}
                disabled={kimiLoading}
                onClick={() => void refreshKimiStatus()}
              >
                <RefreshCw
                  className={kimiLoading ? "size-4 animate-spin" : "size-4"}
                  aria-hidden="true"
                />
              </Button>
            </div>
          }
          detail={
            kimiStatus?.supported && !kimiStatus.installed ? (
              <div className="flex flex-col items-start gap-1">
                <Button type="button" size="sm" onClick={() => void onInstall()}>
                  {intl.formatMessage({ id: "settings.computerUse.kimi.install" })}
                </Button>
                <span className="text-ui-sm text-foreground-subtlest">
                  {intl.formatMessage({ id: "settings.computerUse.kimi.installHint" })}
                </span>
              </div>
            ) : serviceUnavailable ? (
              <span className="text-ui-sm text-foreground-subtlest">
                {intl.formatMessage({ id: "settings.computerUse.kimi.serviceUnavailable" })}
              </span>
            ) : isKimiWindows && kimiInstalled ? (
              <span className="text-ui-sm text-foreground-subtlest">
                {intl.formatMessage({ id: "settings.computerUse.kimi.windowsNote" })}
              </span>
            ) : undefined
          }
        />
        {kimiInstalled && isKimiMacOs ? (
          <>
            <SettingsRow
              controlLayout="wide"
              label={intl.formatMessage({ id: "cuaPermission.perm.accessibility" })}
              description={intl.formatMessage({
                id: "cuaPermission.perm.accessibility.purpose",
              })}
              control={renderBadge(permissionView(accessibilityState))}
              detail={renderGrantDetail(accessibilityState)}
            />
            <SettingsRow
              controlLayout="wide"
              label={intl.formatMessage({ id: "cuaPermission.perm.screenRecording" })}
              description={intl.formatMessage({
                id: "cuaPermission.perm.screenRecording.purpose",
              })}
              control={renderBadge(permissionView(screenRecordingState))}
              detail={renderGrantDetail(screenRecordingState)}
            />
          </>
        ) : null}
      </SettingsGroupCard>
    </div>
  );
}
