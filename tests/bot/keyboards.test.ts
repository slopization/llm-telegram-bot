import { describe, expect, it } from "vitest";
import { decodeSelection, encodeSelection, type Selection } from "../../src/bot/keyboards.ts";

describe("selection callback data", () => {
  const selections: Selection[] = [
    { action: "back", id: "abc" },
    { action: "cancel", id: "abc" },
    { action: "recent", id: "abc" },
    { action: "provider", id: "abc", provider: 1 },
    { action: "all", id: "abc", provider: 1, page: 3 },
    { action: "model", id: "abc", provider: 0, model: 42 },
  ];

  it.each(selections)("round-trips $action", (selection) => {
    expect(decodeSelection(encodeSelection(selection))).toEqual(selection);
  });

  it("stays within the 64-byte callback limit", () => {
    const data = encodeSelection({ action: "model", id: "AbCdEfGh", provider: 9, model: 999 });

    expect(Buffer.byteLength(data)).toBeLessThanOrEqual(64);
  });

  it("rejects malformed data", () => {
    expect(decodeSelection("z:abc")).toBeUndefined();
    expect(decodeSelection("x:abc:1")).toBeUndefined();
    expect(decodeSelection("m:abc:1")).toBeUndefined();
    expect(decodeSelection("p:abc:-1")).toBeUndefined();
    expect(decodeSelection("p::1")).toBeUndefined();
  });
});
