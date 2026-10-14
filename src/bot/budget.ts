import type { QuotaSnapshot } from "../providers/types.ts";
import { strings } from "../strings.ts";
import { dayOf } from "../time.ts";
import type { Deps } from "./deps.ts";

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function formatDay(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function periodStart(today: string, resetDay: number): string {
  const [year = 0, month = 1, day = 1] = today.split("-").map(Number);
  const resetIn = (y: number, m: number) => Math.min(resetDay, daysInMonth(y, m));
  if (day >= resetIn(year, month)) return formatDay(year, month, resetIn(year, month));
  const [previousYear, previousMonth] = month === 1 ? [year - 1, 12] : [year, month - 1];
  return formatDay(previousYear, previousMonth, resetIn(previousYear, previousMonth));
}

function amount(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

const MINUTES_PER_DAY = 24 * 60;

export function windowLabel(minutes: number): string {
  if (minutes === 7 * MINUTES_PER_DAY) return strings.quotaWeekly;
  if (minutes % MINUTES_PER_DAY === 0) return strings.quotaDays(minutes / MINUTES_PER_DAY);
  if (minutes % 60 === 0) return strings.quotaHours(minutes / 60);
  return strings.quotaMinutes(minutes);
}

function clock(timestamp: number, timeZone: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone,
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(timestamp);
}

export function quotaLine(name: string, snapshot: QuotaSnapshot, timeZone: string): string {
  const windows = snapshot.windows.map((window) =>
    strings.quotaWindow(
      windowLabel(window.windowMinutes),
      Math.round(window.usedPercent),
      window.resetsAt === undefined ? undefined : clock(window.resetsAt, timeZone),
    ),
  );
  return strings.budgetQuota(name, windows, clock(snapshot.observedAt, timeZone));
}

async function providerLine(deps: Deps, index: number, today: string): Promise<string> {
  const provider = deps.providers[index];
  const config = deps.config.providers[index];
  if (provider === undefined || config === undefined) return "";
  if (provider.balance !== undefined) {
    try {
      const balance = await provider.balance();
      return strings.budgetCredits(
        provider.name,
        amount(balance.remaining),
        amount(balance.quota),
        balance.renewsAt?.slice(0, 10),
      );
    } catch (err) {
      deps.logger.warn({ err, provider: provider.name }, "balance request failed");
      return strings.budgetFailed(provider.name);
    }
  }
  if (provider.quota !== undefined) {
    const snapshot = await provider.quota();
    return snapshot === undefined
      ? strings.budgetQuotaPending(provider.name)
      : quotaLine(provider.name, snapshot, deps.config.timezone);
  }
  if (provider.costOf !== undefined && config.monthlyBudgetUsd !== undefined) {
    const since = periodStart(today, config.budgetResetDay);
    const spent = deps.repo.spentSince(provider.name, since);
    return strings.budgetEstimate(
      provider.name,
      amount(Math.max(0, config.monthlyBudgetUsd - spent)),
      amount(config.monthlyBudgetUsd),
      amount(spent),
      since,
    );
  }
  return strings.budgetUnknown(provider.name);
}

export async function budgetText(deps: Deps): Promise<string> {
  const today = dayOf(Date.now(), deps.config.timezone);
  const lines = await Promise.all(
    deps.providers.map((_, index) => providerLine(deps, index, today)),
  );
  return [strings.budgetTitle, ...lines].join("\n");
}
