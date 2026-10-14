import { randomInt } from "node:crypto";
import type { Api } from "grammy";
import type { Logger } from "../log.ts";
import { EMPTY, type Formatted, plain, slice } from "../render/formatted.ts";
import { split, splitRanges } from "../render/split.ts";
import { strings } from "../strings.ts";
import {
  type Destination,
  editFormatted,
  replyOption,
  sendChunks,
  sendFormatted,
  threadOption,
} from "./send.ts";
import { Typing } from "./typing.ts";

export interface AnswerSink {
  start(): Promise<void>;
  update(answer: Formatted): void;
  finish(answer: Formatted): Promise<number[]>;
  fail(message: string): Promise<number[]>;
}

export class DraftSink implements AnswerSink {
  private readonly api: Api;
  private readonly destination: Destination;
  private readonly intervalMs: number;
  private readonly logger: Logger;
  private readonly typing: Typing;
  private readonly draftBase = randomInt(1, 2 ** 30);
  private readonly messageIds: number[] = [];
  private latest: Formatted = EMPTY;
  private sentUpTo = 0;
  private draftIndex = 0;
  private draftsEnabled = true;
  private lastFlush = 0;
  private timer: NodeJS.Timeout | undefined;
  private work: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(api: Api, destination: Destination, intervalMs: number, logger: Logger) {
    this.api = api;
    this.destination = destination;
    this.intervalMs = intervalMs;
    this.logger = logger;
    this.typing = new Typing(api, destination, logger);
  }

  async start(): Promise<void> {
    this.typing.start();
  }

  update(answer: Formatted): void {
    this.latest = answer;
    if (this.timer !== undefined || this.closed) return;
    const wait = Math.max(0, this.intervalMs - (Date.now() - this.lastFlush));
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.work = this.work
        .then(() => this.flush())
        .catch((err: unknown) => this.logger.warn({ err }, "draft flush failed"));
    }, wait);
  }

  async finish(answer: Formatted): Promise<number[]> {
    await this.close();
    for (const [start, end] of splitRanges(answer.text, this.sentUpTo)) {
      await this.sendFinal(slice(answer, start, end));
    }
    return this.messageIds;
  }

  async fail(message: string): Promise<number[]> {
    await this.close();
    return [
      await sendFormatted(this.api, this.destination, plain(message), this.destination.replyTo),
    ];
  }

  private async close(): Promise<void> {
    this.closed = true;
    this.typing.stop();
    clearTimeout(this.timer);
    this.timer = undefined;
    await this.work;
  }

  private async flush(): Promise<void> {
    if (this.closed) return;
    this.lastFlush = Date.now();
    const ranges = splitRanges(this.latest.text, this.sentUpTo);
    while (ranges.length > 1) {
      const [start, end] = ranges.shift() ?? [0, 0];
      await this.sendFinal(slice(this.latest, start, end));
      this.sentUpTo = ranges[0]?.[0] ?? end;
      this.draftIndex++;
    }
    const last = ranges[0];
    if (last === undefined || !this.draftsEnabled) return;
    const chunk = slice(this.latest, last[0], last[1]);
    try {
      await this.api.sendMessageDraft(
        this.destination.chatId,
        this.draftBase + this.draftIndex,
        chunk.text,
        {
          entities: chunk.entities,
          ...threadOption(this.destination),
        },
      );
    } catch (err) {
      this.draftsEnabled = false;
      this.logger.warn({ err }, "draft update failed, falling back to the final message only");
    }
  }

  private async sendFinal(chunk: Formatted): Promise<void> {
    const replyTo = this.messageIds.at(-1) ?? this.destination.replyTo;
    this.messageIds.push(await sendFormatted(this.api, this.destination, chunk, replyTo));
  }
}

export class GroupSink implements AnswerSink {
  private readonly api: Api;
  private readonly destination: Destination;
  private readonly label: string;
  private readonly typing: Typing;
  private placeholder: number | undefined;

  constructor(api: Api, destination: Destination, label: string, logger: Logger) {
    this.api = api;
    this.destination = destination;
    this.label = label;
    this.typing = new Typing(api, destination, logger);
  }

  async start(): Promise<void> {
    const message = await this.api.sendMessage(
      this.destination.chatId,
      strings.generating(this.label),
      {
        ...threadOption(this.destination),
        ...replyOption(this.destination.replyTo),
      },
    );
    this.placeholder = message.message_id;
    this.typing.start();
  }

  update(): void {}

  async finish(answer: Formatted): Promise<number[]> {
    this.typing.stop();
    const [first = plain(strings.errors.empty), ...rest] = split(answer);
    if (this.placeholder === undefined) {
      return sendChunks(this.api, this.destination, [first, ...rest], this.destination.replyTo);
    }
    await editFormatted(this.api, this.destination.chatId, this.placeholder, first);
    return [
      this.placeholder,
      ...(await sendChunks(this.api, this.destination, rest, this.placeholder)),
    ];
  }

  async fail(message: string): Promise<number[]> {
    this.typing.stop();
    if (this.placeholder === undefined) {
      return [
        await sendFormatted(this.api, this.destination, plain(message), this.destination.replyTo),
      ];
    }
    await editFormatted(this.api, this.destination.chatId, this.placeholder, plain(message));
    return [this.placeholder];
  }
}
