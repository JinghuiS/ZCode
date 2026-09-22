import { Loader2Icon } from "lucide-react";
import type { ProviderAuthSubscriptionUsage, ProviderAuthUsageWindow } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function XaiSubscriptionUsageCard({
  usage,
  loading,
  onRetry,
}: {
  usage: ProviderAuthSubscriptionUsage | null;
  loading: boolean;
  onRetry: () => void;
}) {
  const { intl, locale } = useZCodeIntl();
  const windows = usage?.status === "ready" ? usage.windows : [];
  const unavailable = usage?.status === "unavailable";

  return (
    <div className="space-y-2">
      {windows.length > 0 ? (
        <div className="flex gap-2 max-sm:flex-col">
          {windows.map((window) => (
            <UsageWindowCard key={window.kind} locale={locale} window={window} />
          ))}
        </div>
      ) : null}
      {loading && windows.length === 0 ? (
        <div className="flex items-center gap-2 text-ui-sm text-foreground-subtle">
          <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
          {intl.formatMessage({ id: "settings.modelProvider.auth.usage.loading" })}
        </div>
      ) : null}
      {unavailable ? (
        <div className="flex items-center justify-between gap-2 text-ui-sm text-foreground-subtle">
          <span>{intl.formatMessage({ id: "settings.modelProvider.auth.usage.unavailable" })}</span>
          <Button type="button" variant="ghost" size="sm" disabled={loading} onClick={onRetry}>
            {loading ? <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" /> : null}
            {intl.formatMessage({ id: "settings.modelProvider.auth.usage.retry" })}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function UsageWindowCard({ window, locale }: { window: ProviderAuthUsageWindow; locale: string }) {
  const { intl } = useZCodeIntl();
  const remainingRatio = Math.max(0, Math.min(1, window.remainingPercent / 100));
  const resetLabel = formatUsageResetTime(locale, window.resetAt);
  const amountLabel =
    window.used != null && window.limit != null && window.limit > 0
      ? intl.formatMessage(
          { id: "settings.modelProvider.auth.usage.credits" },
          {
            remaining: formatCount(locale, Math.max(0, window.limit - window.used)),
            limit: formatCount(locale, window.limit),
          },
        )
      : null;

  return (
    <div className="min-w-0 flex-1 rounded-lg bg-surface p-3">
      <div className="truncate text-ui-base font-medium text-foreground">
        {intl.formatMessage({
          id:
            window.kind === "week"
              ? "settings.modelProvider.auth.usage.week"
              : "settings.modelProvider.auth.usage.month",
        })}
      </div>
      <div className="mt-2 flex min-w-0 items-baseline justify-between gap-3">
        <span className="shrink-0 text-ui-lg font-semibold leading-none text-foreground">
          {formatRemainingPercent(locale, remainingRatio)}
        </span>
        {resetLabel ? (
          <span className="min-w-0 truncate text-right text-ui-xs text-foreground-subtle">
            {intl.formatMessage(
              { id: "settings.modelProvider.auth.usage.resetAt" },
              { date: resetLabel },
            )}
          </span>
        ) : null}
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full bg-success"
          style={{ width: `${remainingRatio * 100}%` }}
        />
      </div>
      {amountLabel ? (
        <div className="mt-2 truncate text-ui-xs text-foreground-subtle">{amountLabel}</div>
      ) : null}
    </div>
  );
}

function formatRemainingPercent(locale: string, ratio: number): string {
  return new Intl.NumberFormat(locale || undefined, {
    maximumFractionDigits: ratio >= 0.1 ? 0 : 1,
    style: "percent",
  }).format(ratio);
}

function formatCount(locale: string, value: number): string {
  return new Intl.NumberFormat(locale || undefined, { maximumFractionDigits: 0 }).format(value);
}

function formatUsageResetTime(locale: string, value: number | undefined): string | undefined {
  if (!value) return undefined;
  const resetAt = new Date(value);
  if (Number.isNaN(resetAt.getTime())) return undefined;
  const now = new Date();
  const isToday =
    resetAt.getFullYear() === now.getFullYear() &&
    resetAt.getMonth() === now.getMonth() &&
    resetAt.getDate() === now.getDate();
  if (isToday) {
    return new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(resetAt);
  }
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(resetAt);
}
