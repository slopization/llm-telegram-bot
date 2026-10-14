import { describe, expect, it } from "vitest";
import { periodStart, quotaLine, windowLabel } from "../../src/bot/budget.ts";

describe("periodStart", () => {
  it("starts this month once the reset day has passed", () => {
    expect(periodStart("2026-10-14", 7)).toBe("2026-10-07");
    expect(periodStart("2026-10-07", 7)).toBe("2026-10-07");
  });

  it("falls back to last month before the reset day", () => {
    expect(periodStart("2026-10-06", 7)).toBe("2026-09-07");
    expect(periodStart("2026-01-03", 7)).toBe("2025-12-07");
  });

  it("clamps the reset day to short months", () => {
    expect(periodStart("2026-02-28", 31)).toBe("2026-02-28");
    expect(periodStart("2026-03-15", 31)).toBe("2026-02-28");
  });
});

describe("windowLabel", () => {
  it.each([
    [300, "5시간"],
    [10080, "주간"],
    [1440, "1일"],
    [90, "90분"],
  ])("labels %i minutes as %s", (minutes, label) => {
    expect(windowLabel(minutes)).toBe(label);
  });
});

describe("quotaLine", () => {
  it("shows each window with usage and reset time in the configured timezone", () => {
    const line = quotaLine(
      "codex",
      {
        windows: [
          { usedPercent: 23.4, windowMinutes: 300, resetsAt: Date.UTC(2026, 9, 14, 12, 30) },
          { usedPercent: 8, windowMinutes: 10080, resetsAt: undefined },
        ],
        observedAt: Date.UTC(2026, 9, 14, 10, 5),
      },
      "Asia/Seoul",
    );

    expect(line).toBe(
      "codex: 5시간 한도 23% 사용 (10. 14. 21:30 리셋), 주간 한도 8% 사용 (10. 14. 19:05 기준)",
    );
  });
});
