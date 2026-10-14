import { describe, expect, it } from "vitest";
import { parseCodexQuota, parseCodexUsage } from "../../src/providers/codex-quota.ts";

const now = 1_800_000_000_000;

describe("parseCodexQuota", () => {
  it("reads primary and secondary windows", () => {
    const headers = new Headers({
      "x-codex-primary-used-percent": "23.5",
      "x-codex-primary-window-minutes": "300",
      "x-codex-primary-reset-after-seconds": "600",
      "x-codex-secondary-used-percent": "8",
      "x-codex-secondary-window-minutes": "10080",
      "x-codex-secondary-reset-at": "1800003600",
    });

    expect(parseCodexQuota(headers, now)).toEqual({
      windows: [
        { usedPercent: 23.5, windowMinutes: 300, resetsAt: now + 600_000 },
        { usedPercent: 8, windowMinutes: 10080, resetsAt: 1_800_003_600_000 },
      ],
      observedAt: now,
    });
  });

  it("skips windows without a usage percent or length", () => {
    const headers = new Headers({
      "x-codex-primary-used-percent": "10",
      "x-codex-secondary-window-minutes": "10080",
    });

    expect(parseCodexQuota(headers, now)).toBeUndefined();
  });

  it("returns undefined for responses without Codex headers", () => {
    expect(
      parseCodexQuota(new Headers({ "content-type": "text/event-stream" }), now),
    ).toBeUndefined();
  });
});

describe("parseCodexUsage", () => {
  it("reads both windows from the usage response", () => {
    const body = {
      plan_type: "team",
      rate_limit: {
        primary_window: {
          used_percent: 2,
          limit_window_seconds: 18000,
          reset_after_seconds: 9759,
          reset_at: 1791991634,
        },
        secondary_window: {
          used_percent: 0,
          limit_window_seconds: 604800,
          reset_after_seconds: 555366,
          reset_at: 1792537242,
        },
      },
    };

    expect(parseCodexUsage(body, now)).toEqual({
      windows: [
        { usedPercent: 2, windowMinutes: 300, resetsAt: 1_791_991_634_000 },
        { usedPercent: 0, windowMinutes: 10080, resetsAt: 1_792_537_242_000 },
      ],
      observedAt: now,
    });
  });

  it("skips a missing secondary window", () => {
    const body = {
      rate_limit: {
        primary_window: { used_percent: 50, limit_window_seconds: 18000, reset_after_seconds: 60 },
        secondary_window: null,
      },
    };

    expect(parseCodexUsage(body, now)?.windows).toEqual([
      { usedPercent: 50, windowMinutes: 300, resetsAt: now + 60_000 },
    ]);
  });

  it("returns undefined without rate limit data", () => {
    expect(parseCodexUsage({ plan_type: "team" }, now)).toBeUndefined();
    expect(parseCodexUsage(null, now)).toBeUndefined();
  });
});
