import type { QuotaSnapshot, QuotaWindow } from "./types.ts";

const WINDOWS = ["primary", "secondary"] as const;
const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const REQUEST_TIMEOUT_MS = 10_000;

function number(headers: Headers, name: string): number | undefined {
  const raw = headers.get(name);
  if (raw === null || raw.trim() === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function resetTime(resetAt: number | undefined, resetAfter: number | undefined, now: number) {
  if (resetAt !== undefined) return resetAt * 1000;
  if (resetAfter !== undefined) return now + resetAfter * 1000;
  return undefined;
}

function headerWindow(headers: Headers, name: string, now: number): QuotaWindow | undefined {
  const prefix = `x-codex-${name}-`;
  const usedPercent = number(headers, `${prefix}used-percent`);
  const windowMinutes = number(headers, `${prefix}window-minutes`);
  if (usedPercent === undefined || windowMinutes === undefined) return undefined;
  const resetsAt = resetTime(
    number(headers, `${prefix}reset-at`),
    number(headers, `${prefix}reset-after-seconds`),
    now,
  );
  return { usedPercent, windowMinutes, resetsAt };
}

export function parseCodexQuota(headers: Headers, now: number): QuotaSnapshot | undefined {
  const windows = WINDOWS.flatMap((name) => headerWindow(headers, name, now) ?? []);
  return windows.length === 0 ? undefined : { windows, observedAt: now };
}

interface UsageWindow {
  used_percent?: number;
  limit_window_seconds?: number;
  reset_after_seconds?: number;
  reset_at?: number;
}

interface UsageResponse {
  rate_limit?: { primary_window?: UsageWindow | null; secondary_window?: UsageWindow | null };
}

function usageWindow(window: UsageWindow | null | undefined, now: number): QuotaWindow | undefined {
  if (window?.used_percent === undefined || window.limit_window_seconds === undefined) {
    return undefined;
  }
  return {
    usedPercent: window.used_percent,
    windowMinutes: window.limit_window_seconds / 60,
    resetsAt: resetTime(window.reset_at, window.reset_after_seconds, now),
  };
}

export function parseCodexUsage(body: unknown, now: number): QuotaSnapshot | undefined {
  const limits = (body as UsageResponse | null)?.rate_limit;
  const windows = [limits?.primary_window, limits?.secondary_window].flatMap(
    (window) => usageWindow(window, now) ?? [],
  );
  return windows.length === 0 ? undefined : { windows, observedAt: now };
}

interface Credential {
  auth_index?: string;
  provider?: string;
  disabled?: boolean;
}

async function management(origin: string, key: string, path: string, init?: RequestInit) {
  const response = await fetch(`${origin}/v8/management${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`management ${path} returned ${response.status}`);
  return response.json() as Promise<unknown>;
}

export async function fetchCodexUsage(
  origin: string,
  key: string,
  now: number,
): Promise<QuotaSnapshot | undefined> {
  const { files = [] } = (await management(origin, key, "/credentials")) as {
    files?: Credential[];
  };
  const credential = files.find((file) => file.provider === "codex" && file.disabled !== true);
  if (credential?.auth_index === undefined) return undefined;
  const call = (await management(origin, key, "/requests/api-call", {
    method: "POST",
    body: JSON.stringify({
      auth_index: credential.auth_index,
      method: "GET",
      url: USAGE_URL,
      header: { Authorization: "Bearer $TOKEN$" },
    }),
  })) as { status_code?: number; body?: string };
  if (call.status_code !== 200 || call.body === undefined) {
    throw new Error(`codex usage returned ${call.status_code}`);
  }
  return parseCodexUsage(JSON.parse(call.body), now);
}
