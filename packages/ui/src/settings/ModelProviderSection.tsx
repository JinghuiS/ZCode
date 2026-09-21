import { useCallback, useEffect, useMemo, useState } from "react";
import { resolveProviderTemplateName, type ProviderConfigObject } from "@zcode/provider";
import type { ModelConnectivityResult } from "@zcode/shared";
import {
  getProviderFormApiKeyManagementUrl,
  type ProviderSettingsFormProvider,
} from "@/lib/providerSettingsFormTypes.js";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { useModelProviders } from "@/hooks/useModelProviders.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import {
  addPendingSettingsSectionListener,
  consumePendingSettingsModelProviderTarget,
  type SettingsModelProviderTarget,
} from "@/lib/settingsNavigation.js";
import { sortModelProvidersForDisplay } from "@/lib/modelProviderOrdering.js";
import { logger } from "@/logger.js";
import { CustomProviderCreateMenu } from "./model-provider-section/CustomProviderCreateMenu.js";
import { InlineEditableProviderCard } from "./model-provider-section/InlineEditableProviderCard.js";
import { ModelProviderLoadingCard } from "./model-provider-section/ModelProviderLoadingCard.js";
import { PresetProviderSetupCard } from "./model-provider-section/PresetProviderSetupCard.js";
import { PRESET_PROVIDER_CATALOG } from "./model-provider-section/presetProviderCatalog.js";
import { ModelProviderSectionLayout } from "./model-provider-section/SectionLayout.js";
import { confirmAndDeleteModelProvider } from "./model-provider-section/modelProviderActions.js";
import { useModelProviderNavigation } from "./model-provider-section/useModelProviderNavigation.js";
import {
  createCatalogProviderNodeKey,
  createCustomProviderNodeKey,
} from "./model-provider-section/utils.js";

export {
  fuzzyMatch,
  handleEndpointSuggestionPopoverOpenAutoFocus,
  resolveEndpointSuggestionOpenRequest,
} from "./model-provider-section/utils.js";

/** 外部入口（如聊天里的「设置模型」）按 providerId 定位；导航会把被预置认领的 id 校正到预置节点。 */
function resolveTargetNodeKey(target: SettingsModelProviderTarget | undefined): string | null {
  const providerId = target?.providerId?.trim();
  return providerId ? createCustomProviderNodeKey(providerId) : null;
}

/**
 * 模型设置：预置供应商（仓库清单）+ 自定义供应商。
 *
 * 智谱账号套餐（Start / Coding / Team Plan、闲时、购买与权益）已下线；
 * Z.ai / BigModel 账号登录与 xAI 一样走 Provider 级认证（ProviderAuthService）。
 */
export function ModelProviderSection({
  workspacePath = "",
  connectivityWorkspacePath,
  connectivityWorkspaceRequired = false,
  pendingModelProviderTarget,
  onConsumePendingModelProviderTarget,
}: {
  workspacePath?: string;
  connectivityWorkspacePath?: string;
  connectivityWorkspaceRequired?: boolean;
  pendingModelProviderTarget?: SettingsModelProviderTarget;
  onConsumePendingModelProviderTarget?: () => void;
} = {}) {
  const { intl, locale } = useZCodeIntl();
  const confirmDialog = useConfirmDialog();
  const platform = usePlatform();
  const {
    modelProviders,
    providerTemplates,
    displayOrder,
    loading,
    loadError,
    reload,
    refreshing,
    refresh,
    saveProvider,
    createPersonalProvider,
    addPersonalModel,
    savePersonalModelDraft,
    setPersonalModelEnabled,
    deletePersonalModel,
    deleteProvider,
    reorderProviderModels,
    saveDisplayOrder,
    reorderableProviderIds,
    testModelConnectivity,
    providerSettingsView,
  } = useModelProviders({
    workspacePath,
    connectivityWorkspacePath,
    connectivityWorkspaceRequired,
    connectivityUnavailableMessage: intl.formatMessage({
      id: "settings.modelProvider.testModel.localWorkspaceUnavailable",
    }),
  });
  const [selectedNodeKey, setSelectedNodeKey] = useState<string | null>(() =>
    resolveTargetNodeKey(consumePendingSettingsModelProviderTarget()),
  );
  const [pendingCreatedProviderId, setPendingCreatedProviderId] = useState<string | null>(null);
  const [creatingProvider, setCreatingProvider] = useState(false);

  const { navigationGroups, selectedNavItem } = useModelProviderNavigation({
    modelProviders,
    providerTemplates,
    locale,
    displayOrder,
    selectedNodeKey,
    setSelectedNodeKey,
  });

  useEffect(() => {
    if (
      !pendingCreatedProviderId ||
      !modelProviders.some((provider) => provider.providerId === pendingCreatedProviderId)
    ) {
      return;
    }
    // saveProvider 会先发布共享快照，再异步落盘；React 在高负载下可能先提交
    // selectedNodeKey、后提交 provider 列表。只在列表事实可见后完成选中。
    setSelectedNodeKey(createCustomProviderNodeKey(pendingCreatedProviderId));
    setPendingCreatedProviderId(null);
  }, [modelProviders, pendingCreatedProviderId]);

  useEffect(() => {
    if (!pendingModelProviderTarget) return;
    const nodeKey = resolveTargetNodeKey(pendingModelProviderTarget);
    if (nodeKey) setSelectedNodeKey(nodeKey);
    onConsumePendingModelProviderTarget?.();
  }, [onConsumePendingModelProviderTarget, pendingModelProviderTarget]);

  useEffect(
    () =>
      addPendingSettingsSectionListener((section, detail) => {
        if (section !== "modelProvider") return;
        const nodeKey = resolveTargetNodeKey(
          detail?.modelProviderId ? { providerId: detail.modelProviderId } : undefined,
        );
        if (nodeKey) setSelectedNodeKey(nodeKey);
      }),
    [],
  );

  const handleSave = useCallback(
    async (config: ProviderSettingsFormProvider) => {
      try {
        await saveProvider(config);
      } catch (error) {
        logger.error("[ModelProviderSection] 保存模型供应商失败", error);
        throw error;
      }
    },
    [saveProvider],
  );

  const handleDelete = useCallback(
    async (provider: ProviderSettingsFormProvider) => {
      await confirmAndDeleteModelProvider({ provider, confirmDialog, intl, deleteProvider });
    },
    [confirmDialog, deleteProvider, intl],
  );

  const handleOpenApiKeyUrl = useCallback(
    (url: string) => {
      const normalizedUrl = url.trim();
      if (normalizedUrl) platform.openExternal(normalizedUrl);
    },
    [platform],
  );

  const handleCreateProvider = useCallback(
    async (input: {
      templateId?: string;
      providerName?: string;
      initialConfig?: ProviderConfigObject;
      /** 预置节点常驻存在，直接保持选中；自定义节点需等列表刷新后再选中。 */
      catalogNodeKey?: string;
    }) => {
      const { catalogNodeKey, ...createInput } = input;
      setCreatingProvider(true);
      try {
        const created = await createPersonalProvider({ ...createInput, locale });
        if (catalogNodeKey) {
          // 新 provider 出现前预置节点仍存在（显示设置卡），不会触发导航兜底跳转。
          setSelectedNodeKey(catalogNodeKey);
          return;
        }
        setPendingCreatedProviderId(created.providerId);
        setSelectedNodeKey(createCustomProviderNodeKey(created.providerId));
      } catch (error) {
        setPendingCreatedProviderId(null);
        throw error;
      } finally {
        setCreatingProvider(false);
      }
    },
    [createPersonalProvider, locale],
  );

  const handleReorderProviderIds = useCallback(
    async (orderedGroupProviderIds: string[]) => {
      const groupProviderIdSet = new Set(orderedGroupProviderIds);
      const currentProviderIds = sortModelProvidersForDisplay(modelProviders, displayOrder).map(
        (provider) => provider.providerId,
      );
      const insertionIndex = currentProviderIds.findIndex((providerId) =>
        groupProviderIdSet.has(providerId),
      );
      if (insertionIndex < 0) return;
      const nextProviderIds = currentProviderIds.filter(
        (providerId) => !groupProviderIdSet.has(providerId),
      );
      nextProviderIds.splice(insertionIndex, 0, ...orderedGroupProviderIds);
      await saveDisplayOrder({ providerIds: nextProviderIds });
    },
    [displayOrder, modelProviders, saveDisplayOrder],
  );

  const handleTestModel = useCallback(
    (providerId: string, modelId: string): Promise<ModelConnectivityResult> =>
      testModelConnectivity(providerId, modelId),
    [testModelConnectivity],
  );

  const templateLocale = locale === "zh-CN" ? "zh-CN" : "en-US";
  // 已进入预置清单的模板常驻左侧，新建菜单只列其余模板（其他接口格式、智谱按量 API 等）。
  const moreProviderTemplates = useMemo(() => {
    const catalogTemplateIds = new Set(PRESET_PROVIDER_CATALOG.map((entry) => entry.templateId));
    return providerTemplates.filter((template) => !catalogTemplateIds.has(template.templateId));
  }, [providerTemplates]);
  const selectedCatalogSetup = useMemo(() => {
    if (selectedNavItem?.type !== "catalog" || selectedNavItem.provider) return null;
    const entry = PRESET_PROVIDER_CATALOG.find((item) => item.id === selectedNavItem.entryId);
    const template = providerTemplates.find(
      (item) => item.templateId === selectedNavItem.templateId,
    );
    return entry && template ? { entry, template, label: selectedNavItem.label } : null;
  }, [providerTemplates, selectedNavItem]);

  // 首屏慢网时始终先渲染布局壳子，再按分组展示 loading，避免整页空白。
  const listLoading = loading || refreshing;

  if (loadError) {
    return (
      <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-ui-base">
        <p className="text-destructive">{loadError.message}</p>
        <Button type="button" variant="outline" onClick={reload}>
          {intl.formatMessage({ id: "common.retry" })}
        </Button>
      </div>
    );
  }

  const selectedProvider = selectedNavItem?.provider ?? null;
  const selectedApiKeyUrl = selectedProvider?.templateId
    ? getProviderFormApiKeyManagementUrl(selectedProvider)
    : undefined;

  return (
    <ModelProviderSectionLayout
      description={intl.formatMessage({ id: "settings.modelProviderDescription" })}
      refreshLabel={intl.formatMessage({ id: "settings.modelProvider.refresh" })}
      loadingLabel={intl.formatMessage({ id: "common.loading" })}
      presetLoading={listLoading}
      customLoading={listLoading}
      onRefresh={() => void refresh()}
      createAction={
        <CustomProviderCreateMenu
          moreTemplates={moreProviderTemplates}
          resolveTemplateLabel={(template) =>
            resolveProviderTemplateName(template.templateId, template, templateLocale)
          }
          disabled={creatingProvider}
          onCreateCompatible={(apiType) =>
            void handleCreateProvider({
              providerName: intl.formatMessage({
                id:
                  apiType === "anthropic-messages"
                    ? "settings.modelProvider.compatible.anthropic"
                    : apiType === "openai-responses"
                      ? "settings.modelProvider.compatible.openaiResponses"
                      : "settings.modelProvider.compatible.openai",
              }),
              initialConfig: { api: { type: apiType } },
            }).catch((error: unknown) =>
              logger.warn("[ModelProviderSection] 新建自定义供应商失败", { error }),
            )
          }
          onCreateFromTemplate={(templateId) =>
            void handleCreateProvider({ templateId }).catch((error: unknown) =>
              logger.warn("[ModelProviderSection] 从模板新建供应商失败", { templateId, error }),
            )
          }
        />
      }
      navigationGroups={navigationGroups}
      selectedNodeKey={selectedNodeKey}
      onSelectNavItem={(item) => setSelectedNodeKey(item.key)}
      onReorderProviderIds={handleReorderProviderIds}
      reorderableProviderIds={reorderableProviderIds}
    >
      {selectedCatalogSetup ? (
        <PresetProviderSetupCard
          key={selectedCatalogSetup.entry.id}
          entry={selectedCatalogSetup.entry}
          template={selectedCatalogSetup.template}
          label={selectedCatalogSetup.label}
          creating={creatingProvider}
          onCreate={(access) =>
            handleCreateProvider({
              templateId: selectedCatalogSetup.entry.templateId,
              initialConfig: { access },
              catalogNodeKey: createCatalogProviderNodeKey(selectedCatalogSetup.entry.id),
            }).catch((error: unknown) =>
              logger.warn("[ModelProviderSection] 配置预置供应商失败", {
                templateId: selectedCatalogSetup.entry.templateId,
                error,
              }),
            )
          }
          onOpenApiKeyUrl={handleOpenApiKeyUrl}
        />
      ) : selectedProvider ? (
        // 仅展示预设模板声明的 Key 控制台入口，不根据地址猜测自定义 Provider 的控制台。
        <InlineEditableProviderCard
          provider={selectedProvider}
          onSave={handleSave}
          onAddPersonalModel={addPersonalModel}
          onSavePersonalModelDraft={savePersonalModelDraft}
          onSetPersonalModelEnabled={setPersonalModelEnabled}
          onDeletePersonalModel={deletePersonalModel}
          settingsRevision={providerSettingsView?.revision}
          onDelete={() => handleDelete(selectedProvider)}
          onReorderModelIds={(modelIds) =>
            reorderProviderModels(selectedProvider.providerId, modelIds)
          }
          onTestModel={handleTestModel}
          presetApiKeyUrl={selectedApiKeyUrl}
          readOnlyEndpoints={false}
          nameEditable
          onOpenPresetApiKey={
            selectedApiKeyUrl ? () => handleOpenApiKeyUrl(selectedApiKeyUrl) : undefined
          }
        />
      ) : listLoading ? (
        <ModelProviderLoadingCard loadingLabel={intl.formatMessage({ id: "common.loading" })} />
      ) : null}
    </ModelProviderSectionLayout>
  );
}
