import { useEffect, useMemo } from "react";
import { resolveProviderTemplateName, type ProviderSettingsTemplateView } from "@zcode/provider";
import type { ProviderSettingsFormProvider } from "@/lib/providerSettingsFormTypes.js";
import { getProviderFormLabel } from "@/lib/providerSettingsFormTypes.js";
import {
  sortModelProvidersForDisplay,
  type ProviderOrderView,
} from "@/lib/modelProviderOrdering.js";
import type {
  ModelProviderNavGroup,
  ModelProviderNavItem,
} from "@/settings/model-provider-section/constants.js";
import { PRESET_PROVIDER_CATALOG } from "@/settings/model-provider-section/presetProviderCatalog.js";
import {
  createCatalogProviderNodeKey,
  createCustomProviderNodeKey,
} from "@/settings/model-provider-section/utils.js";

interface UseModelProviderNavigationOptions {
  modelProviders: ProviderSettingsFormProvider[];
  /** 打包配置中的模板；预置清单据此取名称与图标。 */
  providerTemplates: readonly ProviderSettingsTemplateView[];
  locale: string;
  displayOrder?: ProviderOrderView;
  selectedNodeKey: string | null;
  setSelectedNodeKey: (key: string | null) => void;
}

/**
 * 模型设置左侧导航：预置供应商（仓库清单，常驻）+ 自定义供应商（用户新建）。
 * 智谱账号套餐已降级为普通预置供应商，不再有 family / 套餐连接方式节点。
 */
export function useModelProviderNavigation({
  modelProviders,
  providerTemplates,
  locale,
  displayOrder,
  selectedNodeKey,
  setSelectedNodeKey,
}: UseModelProviderNavigationOptions) {
  const personalProviders = useMemo(
    () =>
      // 复用模型菜单的展示排序，确保设置页和聊天框供应商顺序一致。
      sortModelProvidersForDisplay(
        modelProviders.filter((provider) => provider.config.group === "standard-personal"),
        displayOrder,
      ),
    [displayOrder, modelProviders],
  );

  // 每个预置模板认领展示顺序中第一个同模板 provider，其余同模板 provider 归入自定义。
  const { catalogItems, customProviders } = useMemo(() => {
    const claimed = new Set<string>();
    const templateLocale = locale === "zh-CN" ? "zh-CN" : "en-US";
    const items = PRESET_PROVIDER_CATALOG.flatMap((entry) => {
      const template = providerTemplates.find((item) => item.templateId === entry.templateId);
      if (!template) return [];
      const provider =
        personalProviders.find((candidate) => candidate.templateId === entry.templateId) ?? null;
      if (provider) claimed.add(provider.providerId);
      return [
        {
          key: createCatalogProviderNodeKey(entry.id),
          type: "catalog" as const,
          entryId: entry.id,
          templateId: entry.templateId,
          label:
            entry.name ?? resolveProviderTemplateName(entry.templateId, template, templateLocale),
          logo: template.config.logo,
          provider,
          statusActive: provider?.executable === true,
        },
      ];
    });
    return {
      catalogItems: items,
      customProviders: personalProviders.filter((provider) => !claimed.has(provider.providerId)),
    };
  }, [locale, personalProviders, providerTemplates]);

  const navigationGroups = useMemo<ModelProviderNavGroup[]>(
    () => [
      { id: "preset", items: catalogItems },
      {
        id: "custom",
        items: customProviders.map((provider) => ({
          key: createCustomProviderNodeKey(provider.providerId),
          type: "custom" as const,
          label: getProviderFormLabel(provider),
          provider,
          statusActive: provider.executable === true,
        })),
      },
    ],
    [catalogItems, customProviders],
  );

  const navigationItems = useMemo<ModelProviderNavItem[]>(
    () => navigationGroups.flatMap((group) => group.items),
    [navigationGroups],
  );
  const selectedNavItem = selectedNodeKey
    ? (navigationItems.find((item) => item.key === selectedNodeKey) ?? null)
    : null;

  useEffect(() => {
    if (selectedNavItem) return;
    // 从预置模板创建的 provider 由预置节点承载，不存在 custom:<id> 节点；新建完成或外部入口
    // 按 providerId 定位时落到认领它的预置节点，否则才回落到第一个供应商。
    const claimedCatalogKey = catalogItems.find(
      (item) =>
        item.provider && createCustomProviderNodeKey(item.provider.providerId) === selectedNodeKey,
    )?.key;
    const nextNodeKey = claimedCatalogKey ?? navigationItems[0]?.key ?? null;
    if (nextNodeKey !== selectedNodeKey) setSelectedNodeKey(nextNodeKey);
  }, [catalogItems, navigationItems, selectedNavItem, selectedNodeKey, setSelectedNodeKey]);

  return { navigationGroups, navigationItems, selectedNavItem };
}
