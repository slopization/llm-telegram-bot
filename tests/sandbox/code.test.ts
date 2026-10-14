import { describe, expect, it } from "vitest";
import { extractCode } from "../../src/sandbox/code.ts";

describe("extractCode", () => {
  it("returns plain text trimmed", () => {
    expect(extractCode("  print(1)\n")).toBe("print(1)");
  });

  it("takes the first fenced block", () => {
    expect(extractCode("run this:\n```python\nprint(1)\n```\nthanks")).toBe("print(1)");
  });

  it("accepts an unclosed fence", () => {
    expect(extractCode("```js\nconsole.log(1)")).toBe("console.log(1)");
  });
});
