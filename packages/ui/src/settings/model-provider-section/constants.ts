import type { ProviderSettingsFormProvider } from "@/lib/providerSettingsFormTypes.js";
import { getProviderFormLabel } from "@/lib/providerSettingsFormTypes.js";

export function resolveModelProviderDisplayName(
  provider: Pick<ProviderSettingsFormProvider, "providerId" | "config" | "providerName">,
): string {
  return getProviderFormLabel(provider);
}

export type ModelProviderNavItem =
  | {
      /** 仓库预置清单中的供应商；未配置时 provider 为 null，由设置卡片按需创建。 */
      key: string;
      type: "catalog";
      entryId: string;
      templateId: string;
      label: string;
      logo?: ProviderSettingsFormProvider["config"]["logo"];
      provider: ProviderSettingsFormProvider | null;
      statusActive: boolean;
    }
  | {
      key: string;
      type: "custom";
      label: string;
      provider: ProviderSettingsFormProvider;
      statusActive: boolean;
    };

export type ModelProviderNavGroupId = "preset" | "custom";

export interface ModelProviderNavGroup {
  id: ModelProviderNavGroupId;
  items: ModelProviderNavItem[];
}
