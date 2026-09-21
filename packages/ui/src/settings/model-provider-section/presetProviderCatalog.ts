import type { ProviderAuthProviderId } from "@zcode/shared";

/**
 * 仓库内维护的预置供应商清单（展示顺序与认证方式）。
 *
 * 连接地址、接口格式、默认模型等配置仍来自打包的 `config/provider/zcode-builtin.json`
 * 模板，本清单只声明「哪些模板作为预置供应商常驻展示」。
 * Z.ai / BigModel 使用 Coding Plan 模板：账号登录会自动获取账号 API Key；
 * 按量计费的标准 API 模板接口地址与模型不同，放在「更多模板」中。
 */
export interface PresetProviderCatalogEntry {
  id: string;
  templateId: string;
  /** 覆盖模板名称（模板名带接口格式后缀时使用）。 */
  name?: string;
  /** 支持 Provider 级账号登录时声明；缺省只支持 API Key。 */
  authProviderId?: ProviderAuthProviderId;
}

export const PRESET_PROVIDER_CATALOG: readonly PresetProviderCatalogEntry[] = [
  { id: "zai", templateId: "zai-api", name: "Z.ai", authProviderId: "zai" },
  { id: "bigmodel", templateId: "bigmodel-api", name: "BigModel", authProviderId: "bigmodel" },
  { id: "kimi", templateId: "moonshot-kimi" },
  { id: "minimax", templateId: "minimax" },
  { id: "deepseek", templateId: "deepseek" },
  { id: "qwen-cn", templateId: "qwen-alibaba-model-studio-cn" },
  { id: "qwen-intl", templateId: "qwen-alibaba-model-studio-intl" },
  { id: "xiaomi-mimo", templateId: "xiaomi-mimo" },
  { id: "openai", templateId: "openai" },
  { id: "anthropic", templateId: "anthropic" },
  { id: "xai", templateId: "xai", authProviderId: "xai" },
  { id: "openrouter", templateId: "openrouter" },
  // OpenCode 同一服务按接口格式拆成多个模板；预置项取模型最全的格式，其余格式在自定义菜单中提供。
  { id: "opencode-zen", templateId: "opencode-zen-messages", name: "OpenCode Zen" },
  { id: "opencode-go", templateId: "opencode-go-chat", name: "OpenCode Go" },
];

export function findPresetCatalogEntryByTemplateId(
  templateId: string | null | undefined,
): PresetProviderCatalogEntry | undefined {
  return templateId
    ? PRESET_PROVIDER_CATALOG.find((entry) => entry.templateId === templateId)
    : undefined;
}
