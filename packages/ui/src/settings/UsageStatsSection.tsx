import { AppUsagePanel } from "@/settings/usage-stats/AppUsagePanel.js";

/** 使用统计：只保留本地应用用量；Coding Plan 额度统计随智谱套餐下线。 */
export function UsageStatsSection() {
  return <AppUsagePanel />;
}
