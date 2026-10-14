import { describe, expect, it } from "vitest";
import { parseCommand } from "../../src/commands/parse.ts";

describe("parseCommand", () => {
  it("parses a command with arguments", () => {
    expect(parseCommand("/ask hello world", "bot")).toEqual({ name: "ask", args: "hello world" });
  });

  it("keeps newlines inside arguments", () => {
    expect(parseCommand("/py\nprint(1)\nprint(2)", "bot")).toEqual({
      name: "py",
      args: "print(1)\nprint(2)",
    });
  });

  it("resolves aliases case-insensitively", () => {
    expect(parseCommand("/A hi", "bot")).toEqual({ name: "ask", args: "hi" });
  });

  it("accepts a mention of this bot", () => {
    expect(parseCommand("/ask@My_Bot hi", "my_bot")).toEqual({ name: "ask", args: "hi" });
  });

  it("ignores commands for other bots", () => {
    expect(parseCommand("/ask@other_bot hi", "my_bot")).toBeUndefined();
  });

  it("ignores unknown commands and plain text", () => {
    expect(parseCommand("/unknown", "bot")).toBeUndefined();
    expect(parseCommand("hello /ask", "bot")).toBeUndefined();
  });

  it("does not match a longer command name", () => {
    expect(parseCommand("/asking", "bot")).toBeUndefined();
  });
});
