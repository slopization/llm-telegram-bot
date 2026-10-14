import { describe, expect, it } from "vitest";
import { echoLastJavaScriptValue } from "../../src/sandbox/echo.ts";

describe("echoLastJavaScriptValue", () => {
  it("prints the value of a trailing expression", () => {
    expect(echoLastJavaScriptValue("1+1")).toContain("let __llmBotResult = (1+1);");
  });

  it("keeps earlier statements and trailing comments", () => {
    const code = 'import _ from "lodash";\nconst x = 2;\nx * 3 // six';
    const echoed = echoLastJavaScriptValue(code);

    expect(echoed.startsWith('import _ from "lodash";\nconst x = 2;\n')).toBe(true);
    expect(echoed).toContain("let __llmBotResult = (x * 3);");
    expect(echoed.endsWith(" // six")).toBe(true);
  });

  it("leaves code ending in a declaration or block unchanged", () => {
    expect(echoLastJavaScriptValue("const x = 1;")).toBe("const x = 1;");
    expect(echoLastJavaScriptValue("if (true) { 1 }")).toBe("if (true) { 1 }");
  });

  it("leaves code with a syntax error unchanged", () => {
    expect(echoLastJavaScriptValue("1 +")).toBe("1 +");
  });

  it("accepts top-level await", () => {
    expect(echoLastJavaScriptValue("await Promise.resolve(3)")).toContain(
      "let __llmBotResult = (await Promise.resolve(3));",
    );
  });
});
