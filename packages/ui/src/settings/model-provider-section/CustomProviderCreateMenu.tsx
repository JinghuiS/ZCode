import { PlusIcon } from "lucide-react";
import type { ProviderApiType, ProviderSettingsTemplateView } from "@zcode/provider";
import { TID_MODEL_PROVIDER_ADD_PROVIDER_BUTTON } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { ProviderLogo } from "./ProviderLogo.js";

/**
 * 新建自定义供应商：OpenAI / Anthropic 兼容接口为主入口；
 * 未进入预置清单的模板（其他接口格式、智谱 API Key 等）放在「更多模板」，保证每个模板仍可创建。
 */
export function CustomProviderCreateMenu({
  moreTemplates,
  resolveTemplateLabel,
  disabled,
  onCreateCompatible,
  onCreateFromTemplate,
}: {
  moreTemplates: readonly ProviderSettingsTemplateView[];
  resolveTemplateLabel: (template: ProviderSettingsTemplateView) => string;
  disabled?: boolean;
  onCreateCompatible: (apiType: ProviderApiType) => void;
  onCreateFromTemplate: (templateId: string) => void;
}) {
  const { intl } = useZCodeIntl();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="default"
          size="default"
          className="rounded-lg"
          disabled={disabled}
          data-testid={TID_MODEL_PROVIDER_ADD_PROVIDER_BUTTON}
        >
          <PlusIcon data-icon="inline-start" aria-hidden="true" />
          {intl.formatMessage({ id: "settings.modelProvider.addCustomProvider" })}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-max min-w-56">
        <DropdownMenuItem onSelect={() => onCreateCompatible("openai-chat-completions")}>
          {intl.formatMessage({ id: "settings.modelProvider.compatible.openai" })}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onCreateCompatible("openai-responses")}>
          {intl.formatMessage({ id: "settings.modelProvider.compatible.openaiResponses" })}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onCreateCompatible("anthropic-messages")}>
          {intl.formatMessage({ id: "settings.modelProvider.compatible.anthropic" })}
        </DropdownMenuItem>
        {moreTemplates.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-ui-sm text-foreground-subtlest">
              {intl.formatMessage({ id: "settings.modelProvider.moreTemplates" })}
            </DropdownMenuLabel>
            {moreTemplates.map((template) => (
              <DropdownMenuItem
                key={template.templateId}
                onSelect={() => onCreateFromTemplate(template.templateId)}
              >
                <ProviderLogo logo={template.config.logo} className="size-4" />
                {resolveTemplateLabel(template)}
              </DropdownMenuItem>
            ))}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
