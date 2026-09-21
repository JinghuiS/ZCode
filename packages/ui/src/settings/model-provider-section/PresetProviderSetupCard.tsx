import { useState } from "react";
import { Loader2Icon } from "lucide-react";
import type { ProviderConfigObject, ProviderSettingsTemplateView } from "@zcode/provider";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { ApiKeyInput } from "./ApiKeyInput.js";
import { PresetProviderApiKeyBanner } from "./PresetProviderApiKeyBanner.js";
import {
  ProviderAuthMethodRadioGroup,
  type ProviderAuthMethod,
} from "./ProviderAuthMethodSection.js";
import { ProviderLogo } from "./ProviderLogo.js";
import type { PresetProviderCatalogEntry } from "./presetProviderCatalog.js";

/**
 * 预置供应商尚未配置时的设置卡。
 *
 * 预置项常驻展示但不预先写入个人配置；用户填写 API Key 或选择账号方式时才按模板创建 provider，
 * 创建后左侧仍是同一个预置节点，右侧切换为完整的 provider 卡片。
 */
export function PresetProviderSetupCard({
  entry,
  template,
  label,
  creating,
  onCreate,
  onOpenApiKeyUrl,
}: {
  entry: PresetProviderCatalogEntry;
  template: ProviderSettingsTemplateView;
  label: string;
  creating: boolean;
  onCreate: (access: NonNullable<ProviderConfigObject["access"]>) => Promise<void>;
  onOpenApiKeyUrl: (url: string) => void;
}) {
  const { intl } = useZCodeIntl();
  const [method, setMethod] = useState<ProviderAuthMethod>(
    entry.authProviderId ? "account" : "api-key",
  );
  const [apiKey, setApiKey] = useState("");
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const templateAccess = template.config.access;
  const apiKeyManagementUrl =
    templateAccess && "apiKeyManagementUrl" in templateAccess
      ? (templateAccess.apiKeyManagementUrl ?? undefined)
      : undefined;
  // 智谱 Coding Plan Key 等模板自带专用 Key 类型，保存时沿用模板声明，不降级成普通 API Key。
  const apiKeyAccessType =
    templateAccess?.type === "zhipu-coding-plan-api-key" ? templateAccess.type : "api-key";

  const saveApiKey = () => {
    const value = apiKey.trim();
    if (!value || creating) return;
    void onCreate({ type: apiKeyAccessType, apiKey: value });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ProviderLogo logo={template.config.logo} className="size-5" />
        <h3 className="text-ui-lg font-semibold text-foreground">{label}</h3>
        <span className="text-ui-sm text-foreground-subtlest">
          {intl.formatMessage({ id: "settings.modelProvider.preset.notConfigured" })}
        </span>
      </div>

      {entry.authProviderId ? (
        <ProviderAuthMethodRadioGroup
          authProviderId={entry.authProviderId}
          method={method}
          disabled={creating}
          onMethodChange={setMethod}
        />
      ) : null}

      {method === "account" && entry.authProviderId ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-card-border bg-surface px-3 py-2.5 text-ui-base">
          <span className="text-foreground-subtle">
            {intl.formatMessage({ id: "settings.modelProvider.auth.disconnected" })}
          </span>
          <Button
            type="button"
            size="sm"
            disabled={creating}
            onClick={() =>
              void onCreate({ type: "provider-oauth", authProviderId: entry.authProviderId })
            }
          >
            {creating ? <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" /> : null}
            {intl.formatMessage({ id: "settings.modelProvider.preset.useAccount" })}
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label className="block text-ui-base text-foreground-subtle">
              {intl.formatMessage({ id: "settings.modelProvider.apiKey" })}
            </label>
            {apiKeyManagementUrl ? (
              <PresetProviderApiKeyBanner
                onOpenApiKey={() => onOpenApiKeyUrl(apiKeyManagementUrl)}
              />
            ) : null}
          </div>
          <ApiKeyInput
            value={apiKey}
            visible={apiKeyVisible}
            onChange={setApiKey}
            onBlur={() => undefined}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) saveApiKey();
            }}
            onToggleVisibility={() => setApiKeyVisible((value) => !value)}
          />
          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              disabled={!apiKey.trim() || creating}
              onClick={saveApiKey}
            >
              {creating ? (
                <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
              ) : null}
              {intl.formatMessage({ id: "settings.modelProvider.preset.save" })}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
