import { CheckCircle2Icon, CopyIcon, ExternalLinkIcon, Loader2Icon } from "lucide-react";
import type { ProviderAuthProviderId } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { cn } from "@/components/lib/utils.js";
import { useProviderAuth } from "@/hooks/useProviderAuth.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export type ProviderAuthMethod = "account" | "api-key";

function AuthMethodOption({
  checked,
  disabled,
  label,
  onSelect,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-ui-base text-foreground",
        "hover:bg-hover disabled:cursor-not-allowed disabled:opacity-60",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded-full border",
          checked ? "border-foreground" : "border-border",
        )}
      >
        {checked ? <span className="size-2 rounded-full bg-foreground" /> : null}
      </span>
      {label}
    </button>
  );
}

/**
 * Provider 认证方式：账号登录（Provider 级 OAuth）或 API Key。
 * 凭据归属 provider-auth:<authProviderId>，与全局客户端账号无关。
 */
export function ProviderAuthMethodSection({
  authProviderId,
  method,
  switching,
  onMethodChange,
}: {
  authProviderId: ProviderAuthProviderId;
  method: ProviderAuthMethod;
  switching?: boolean;
  onMethodChange: (method: ProviderAuthMethod) => void;
}) {
  const { intl } = useZCodeIntl();
  const platform = usePlatform();
  const { status, loginState, startLogin, cancelLogin, logout } = useProviderAuth(
    method === "account" ? authProviderId : undefined,
  );
  const accountLabel = intl.formatMessage({
    id: `settings.modelProvider.auth.account.${authProviderId}`,
  });

  return (
    <div className="space-y-2">
      <label className="block text-ui-base text-foreground-subtle">
        {intl.formatMessage({ id: "settings.modelProvider.auth.method" })}
      </label>
      <div role="radiogroup" className="flex flex-col gap-0.5">
        <AuthMethodOption
          checked={method === "account"}
          disabled={switching}
          label={accountLabel}
          onSelect={() => method !== "account" && onMethodChange("account")}
        />
        <AuthMethodOption
          checked={method === "api-key"}
          disabled={switching}
          label={intl.formatMessage({ id: "settings.modelProvider.auth.apiKey" })}
          onSelect={() => method !== "api-key" && onMethodChange("api-key")}
        />
      </div>

      {method === "account" ? (
        <div className="rounded-lg border border-card-border bg-surface px-3 py-2.5 text-ui-base">
          {loginState.phase === "waiting" ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-foreground-subtle">
                <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
                {intl.formatMessage({ id: "settings.modelProvider.auth.waiting" })}
              </div>
              <div className="flex items-center gap-2">
                <code className="rounded-md bg-hover px-2 py-1 font-mono text-ui-lg tracking-widest text-foreground">
                  {loginState.login.userCode}
                </code>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={intl.formatMessage({ id: "settings.modelProvider.auth.copyCode" })}
                  onClick={() => void navigator.clipboard?.writeText(loginState.login.userCode)}
                >
                  <CopyIcon className="size-3.5" aria-hidden="true" />
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    platform.openExternal(
                      loginState.login.verificationUriComplete ?? loginState.login.verificationUri,
                    )
                  }
                >
                  <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
                  {intl.formatMessage({ id: "settings.modelProvider.auth.openBrowser" })}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={cancelLogin}>
                  {intl.formatMessage({ id: "common.cancel" })}
                </Button>
              </div>
              <p className="text-ui-sm text-foreground-subtlest">
                {intl.formatMessage(
                  { id: "settings.modelProvider.auth.deviceHint" },
                  { url: loginState.login.verificationUri },
                )}
              </p>
            </div>
          ) : status?.status === "connected" ? (
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2 text-foreground">
                <CheckCircle2Icon className="size-4 shrink-0 text-success" aria-hidden="true" />
                <span className="truncate">
                  {status.account?.email
                    ? intl.formatMessage(
                        { id: "settings.modelProvider.auth.connectedAs" },
                        { account: status.account.email },
                      )
                    : intl.formatMessage({ id: "settings.modelProvider.auth.connected" })}
                </span>
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={() => void logout()}>
                {intl.formatMessage({ id: "settings.modelProvider.auth.logout" })}
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <span className="text-foreground-subtle">
                {status?.status === "expired"
                  ? intl.formatMessage({ id: "settings.modelProvider.auth.expired" })
                  : loginState.phase === "failed"
                    ? intl.formatMessage(
                        { id: "settings.modelProvider.auth.failed" },
                        { error: loginState.errorMessage },
                      )
                    : intl.formatMessage({ id: "settings.modelProvider.auth.disconnected" })}
              </span>
              <Button
                type="button"
                variant="default"
                size="sm"
                disabled={loginState.phase === "starting" || status === null}
                onClick={() => void startLogin()}
              >
                {loginState.phase === "starting" ? (
                  <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
                ) : null}
                {intl.formatMessage({ id: "settings.modelProvider.auth.login" })}
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
