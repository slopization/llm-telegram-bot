import { describe, expect, it } from "vitest";
import { classifyError, EmptyAnswerError } from "../../src/pipeline/errors.ts";

function apiError(status: number, message = "", body?: unknown) {
  return Object.assign(new Error(message), { status, error: body });
}

describe("classifyError", () => {
  it("detects Claude credit exhaustion from the 400 message", () => {
    const error = apiError(400, "Your credit balance is too low to access the Anthropic API.");

    expect(classifyError(error, false)).toBe("credit");
  });

  it("treats 402 and the tier spend cap as credit errors", () => {
    expect(classifyError(apiError(402), false)).toBe("credit");
    const capped = apiError(429, "", {
      error: { details: { error_code: "enforced_spend_limit_reached" } },
    });
    expect(classifyError(capped, false)).toBe("credit");
  });

  it("separates rate limits, overload and other API errors", () => {
    expect(classifyError(apiError(429), false)).toBe("rateLimit");
    expect(classifyError(apiError(529), false)).toBe("overloaded");
    expect(classifyError(apiError(500), false)).toBe("api");
  });

  it("prefers timeout when the request timed out", () => {
    expect(classifyError(apiError(500), true)).toBe("timeout");
  });

  it("recognizes empty answers and unknown failures", () => {
    expect(classifyError(new EmptyAnswerError(), false)).toBe("empty");
    expect(classifyError(new Error("boom"), false)).toBe("internal");
  });
});
