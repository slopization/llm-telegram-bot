import { describe, expect, it } from "vitest";
import { parseOpenAIPricing } from "../../src/providers/openai-prices.ts";

const pricing = [
  "# Pricing",
  "",
  "### Standard pricing data",
  "",
  "| Model | Short context input | Short context cached input | Short context cache writes | Short context output | Long context output |",
  "| --- | --- | --- | --- | --- | --- |",
  "| gpt-6-astra | $10.00 | $1.00 | $12.50 | $50.00 | $75.00 |",
  "| gpt-6-luna | $0.10 | $0.01 | $0.125 | $0.50 | $0.75 |",
  "| gpt-5.5 (<272K context length) | $5.00 | $0.50 | - | $30.00 | $45.00 |",
  "| gpt-5.4-mini | $0.75 | $0.075 | - | - | - |",
  "",
  "### Batch pricing data",
  "",
  "| Model | Short context input | Short context cached input | Short context cache writes | Short context output |",
  "| --- | --- | --- | --- | --- |",
  "| gpt-6-astra | $5.00 | $0.50 | $6.25 | $25.00 |",
].join("\n");

describe("parseOpenAIPricing", () => {
  it("reads short context output prices from the standard table only", () => {
    expect(Object.fromEntries(parseOpenAIPricing(pricing))).toEqual({
      "gpt-6-astra": 50,
      "gpt-6-luna": 0.5,
      "gpt-5.5": 30,
    });
  });

  it("returns nothing when the standard section is missing", () => {
    expect(parseOpenAIPricing("# Pricing\n\nnothing here").size).toBe(0);
  });

  it("returns nothing when the output column is missing", () => {
    const changed =
      "### Standard pricing data\n\n| Model | Input |\n| --- | --- |\n| gpt-6-luna | $0.10 |";

    expect(parseOpenAIPricing(changed).size).toBe(0);
  });
});
