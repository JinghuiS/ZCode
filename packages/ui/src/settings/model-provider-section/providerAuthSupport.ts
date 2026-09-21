import type { ProviderAuthProviderId } from "@zcode/shared";
import type { ProviderSettingsFormProvider } from "@/lib/providerSettingsFormTypes.js";
import { findPresetCatalogEntryByTemplateId } from "./presetProviderCatalog.js";

/** 支持 Provider 级账号登录的 provider：由预置清单声明，或配置已切到账号方式。 */
export function resolveProviderOAuthSupport(
  provider: Pick<ProviderSettingsFormProvider, "templateId" | "config">,
): ProviderAuthProviderId | undefined {
  if (provider.config.access?.type === "provider-oauth") {
    return provider.config.access.authProviderId ?? undefined;
  }
  return findPresetCatalogEntryByTemplateId(provider.templateId)?.authProviderId;
}
