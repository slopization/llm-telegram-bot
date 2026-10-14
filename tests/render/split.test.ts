import { describe, expect, it } from "vitest";
import { concat, plain, slice } from "../../src/render/formatted.ts";
import { split } from "../../src/render/split.ts";

describe("split", () => {
  it("returns one chunk under the limit", () => {
    expect(split(plain("hello"), 10)).toEqual([plain("hello")]);
  });

  it("cuts at the last newline before the limit", () => {
    expect(split(plain("aaaa\nbbbb\ncccc"), 10).map((chunk) => chunk.text)).toEqual([
      "aaaa\nbbbb",
      "cccc",
    ]);
  });

  it("hard cuts a line longer than the limit", () => {
    expect(split(plain("abcdefghij"), 4).map((chunk) => chunk.text)).toEqual([
      "abcd",
      "efgh",
      "ij",
    ]);
  });

  it("does not split a surrogate pair", () => {
    const chunks = split(plain("abc😀def"), 4);

    expect(chunks.map((chunk) => chunk.text)).toEqual(["abc", "😀de", "f"]);
  });

  it("splits entities across chunks", () => {
    const source = {
      text: "aaaa\nbbbb",
      entities: [{ type: "bold" as const, offset: 2, length: 5 }],
    };

    expect(split(source, 6)).toEqual([
      { text: "aaaa", entities: [{ type: "bold", offset: 2, length: 2 }] },
      { text: "bbbb", entities: [{ type: "bold", offset: 0, length: 2 }] },
    ]);
  });
});

describe("formatted helpers", () => {
  it("concat shifts entity offsets", () => {
    const bold = { text: "b", entities: [{ type: "bold" as const, offset: 0, length: 1 }] };

    expect(concat(plain("a"), bold)).toEqual({
      text: "ab",
      entities: [{ type: "bold", offset: 1, length: 1 }],
    });
  });

  it("slice drops entities outside the range", () => {
    const source = { text: "abcd", entities: [{ type: "bold" as const, offset: 0, length: 1 }] };

    expect(slice(source, 2)).toEqual({ text: "cd", entities: [] });
  });
});
