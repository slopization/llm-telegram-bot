import { describe, expect, it } from "vitest";
import { Tasks } from "../../src/bot/deps.ts";
import { elapsed, preview, queueText, senderName } from "../../src/bot/queue.ts";
import type { Logger } from "../../src/log.ts";

const logger = { error: () => undefined } as unknown as Logger;
const info = (chatId: number, startedAt: number) => ({
  chatId,
  sender: "a",
  label: "답변 (m)",
  preview: "q",
  startedAt,
});

describe("Tasks", () => {
  it("lists running tasks of one chat oldest first and forgets finished ones", async () => {
    const tasks = new Tasks(logger);
    const { promise, resolve } = Promise.withResolvers<void>();
    tasks.track(promise, info(1, 20));
    tasks.track(new Promise<void>(() => undefined), info(1, 10));
    tasks.track(new Promise<void>(() => undefined), info(2, 5));

    expect(tasks.inChat(1).map((task) => task.startedAt)).toEqual([10, 20]);
    resolve();
    await new Promise((resolve) => setImmediate(resolve));
    expect(tasks.inChat(1).map((task) => task.startedAt)).toEqual([10]);
  });
});

describe("queueText", () => {
  it("shows sender, task, age and preview", () => {
    expect(queueText([info(1, 0)], 125_000)).toBe(
      "이 채팅에서 진행 중인 작업 1개\n1. a, 답변 (m), 2분 5초 전\n   q",
    );
  });

  it("says when nothing is running", () => {
    expect(queueText([], 0)).toBe("이 채팅에서 진행 중인 작업이 없어요.");
  });
});

describe("helpers", () => {
  it("prefers the username without @ and falls back to the first name", () => {
    expect(senderName({ id: 1, is_bot: false, first_name: "민재", username: "mj" })).toBe("mj");
    expect(senderName({ id: 1, is_bot: false, first_name: "민재" })).toBe("민재");
  });

  it("collapses whitespace and cuts long previews", () => {
    expect(preview("a\n\n b")).toBe("a b");
    expect(preview("x".repeat(50))).toBe(`${"x".repeat(40)}...`);
  });

  it("formats seconds and minutes", () => {
    expect(elapsed(9_900)).toBe("9초");
    expect(elapsed(61_000)).toBe("1분 1초");
  });
});
