import type { ProviderAuthProviderId } from "@zcode/shared";
import type { ProviderSettingsFormProvider } from "@/lib/providerSettingsFormTypes.js";

/**
 * 支持 Provider 级账号登录的 provider。
 *
 * 当前按模板识别（从 xai 模板创建的 provider）；B 期预置清单落地后改由清单声明认证方式。
 */
const PROVIDER_AUTH_BY_TEMPLATE_ID: Readonly<Record<string, ProviderAuthProviderId>> = {
  xai: "xai",
};

export function resolveProviderOAuthSupport(
  provider: Pick<ProviderSettingsFormProvider, "templateId" | "config">,
): ProviderAuthProviderId | undefined {
  if (provider.config.access?.type === "provider-oauth") {
    return provider.config.access.authProviderId ?? undefined;
  }
  return provider.templateId ? PROVIDER_AUTH_BY_TEMPLATE_ID[provider.templateId] : undefined;
}
