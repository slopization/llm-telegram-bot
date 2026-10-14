import { describe, expect, it } from "vitest";
import { isChatModel, page, representatives, sortModels } from "../../src/providers/models.ts";
import type { ModelInfo } from "../../src/providers/types.ts";

function model(id: string, vendor: string, outputPricePerMTok?: number, legacy = false): ModelInfo {
  return { id, vendor, outputPricePerMTok, webSearch: false, maxOutputTokens: undefined, legacy };
}

const catalog = [
  model("fable", "anthropic", 50),
  model("haiku", "anthropic", 0.5),
  model("opus", "anthropic", 20),
  model("sonnet", "anthropic", 10),
  model("mini", "openai", 1),
  model("big", "openai", 30),
  model("mid", "openai", 8),
];

const ids = (models: ModelInfo[]) => models.map((m) => m.id);

describe("representatives", () => {
  it("picks the lower median by output price per vendor for medium", () => {
    expect(ids(representatives(catalog, "medium"))).toEqual(["sonnet", "mid"]);
  });

  it("picks the cheapest model per vendor for cheap", () => {
    expect(ids(representatives(catalog, "cheap"))).toEqual(["haiku", "mini"]);
  });

  it("picks the most expensive model per vendor for expensive", () => {
    expect(ids(representatives(catalog, "expensive"))).toEqual(["fable", "big"]);
  });

  it("ignores unpriced models when some are priced", () => {
    const models = [model("a", "x"), model("b", "x", 1), model("c", "x", 2), model("d", "x", 3)];

    expect(ids(representatives(models, "medium"))).toEqual(["c"]);
    expect(ids(representatives(models, "expensive"))).toEqual(["d"]);
  });

  it("skips legacy models when the vendor has current ones", () => {
    const models = [model("old", "x", 1, true), model("new", "x", 5), model("newer", "x", 9)];

    expect(ids(representatives(models, "cheap"))).toEqual(["new"]);
    expect(ids(representatives([model("old", "y", 1, true)], "medium"))).toEqual(["old"]);
  });

  it("falls back to id order when no model is priced", () => {
    const models = [model("c", "x"), model("a", "x"), model("b", "x")];

    expect(ids(representatives(models, "medium"))).toEqual(["b"]);
  });
});

describe("isChatModel", () => {
  it.each([
    "gpt-image-2",
    "gpt-image-2.5-sunburst",
    "gpt-image-1.5",
    "dall-e-3",
    "gpt-audio-1.5",
    "gpt-4o-mini-tts",
    "gpt-4o-transcribe",
    "whisper-1",
    "gpt-realtime",
    "text-embedding-3-large",
    "omni-moderation-latest",
    "codex-auto-review",
    "gpt-sora-preview",
    "gpt-4o",
  ])("rejects %s", (id) => {
    expect(isChatModel(id)).toBe(false);
  });

  it.each([
    "gpt-6-luna",
    "gpt-5.6-terra",
    "gpt-5.5",
    "gpt-5.4-pro",
    "claude-haiku-5-5",
    "gemini-3.5-flash-lite",
    "google/gemma-4-31B-it",
    "deepseek-v4.1-flash",
    "sonar-reasoning-pro",
    "seed-2-0-lite-260428",
  ])("accepts %s", (id) => {
    expect(isChatModel(id)).toBe(true);
  });
});

describe("sortModels", () => {
  it("groups by vendor then sorts by price with unpriced last", () => {
    const models = [model("z", "b", 1), model("y", "a"), model("x", "a", 5)];

    expect(ids(sortModels(models))).toEqual(["x", "y", "z"]);
  });
});

describe("page", () => {
  it("clamps the page index", () => {
    expect(page([1, 2, 3, 4, 5], 9, 2)).toEqual({ items: [5], current: 2, pages: 3 });
  });

  it("returns one empty page for no items", () => {
    expect(page([], 0, 8)).toEqual({ items: [], current: 0, pages: 1 });
  });
});
