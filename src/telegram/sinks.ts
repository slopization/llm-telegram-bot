import { randomInt } from "node:crypto";
import type { Api } from "grammy";
import type { Logger } from "../log.ts";
import { plain } from "../render/formatted.ts";
import { escapeHtml } from "../render/markdown.ts";
import { splitRichHtml } from "../render/rich-split.ts";
import { strings } from "../strings.ts";
import { type Destination, replyOption, sendFormatted, sendRich, threadOption } from "./send.ts";
import { Typing } from "./typing.ts";

export interface AnswerSink {
  start(): Promise<void>;
  update(html: string): void;
  finish(html: string): Promise<number[]>;
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
  private latest = "";
  private sentChunks = 0;
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

  update(html: string): void {
    this.latest = html;
    if (this.timer !== undefined || this.closed) return;
    const wait = Math.max(0, this.intervalMs - (Date.now() - this.lastFlush));
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.work = this.work
        .then(() => this.flush())
        .catch((err: unknown) => this.logger.warn({ err }, "draft flush failed"));
    }, wait);
  }

  async finish(html: string): Promise<number[]> {
    await this.close();
    for (const chunk of splitRichHtml(html).slice(this.sentChunks)) await this.sendFinal(chunk);
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
    const chunks = splitRichHtml(this.latest);
    while (chunks.length - this.sentChunks > 1) {
      await this.sendFinal(chunks[this.sentChunks] ?? "");
      this.sentChunks++;
    }
    const draft = chunks[this.sentChunks];
    if (draft === undefined || !this.draftsEnabled) return;
    try {
      await this.api.sendRichMessageDraft(
        this.destination.chatId,
        this.draftBase + this.sentChunks,
        { html: draft },
        threadOption(this.destination),
      );
    } catch (err) {
      this.draftsEnabled = false;
      this.logger.warn({ err }, "draft update failed, falling back to the final message only");
    }
  }

  private async sendFinal(chunk: string): Promise<void> {
    const replyTo = this.messageIds.at(-1) ?? this.destination.replyTo;
    this.messageIds.push(await sendRich(this.api, this.destination, chunk, replyTo));
  }
}

export class GroupSink implements AnswerSink {
  private readonly api: Api;
  private readonly destination: Destination;
  private readonly label: string;
  private readonly logger: Logger;
  private readonly typing: Typing;
  private placeholder: number | undefined;

  constructor(api: Api, destination: Destination, label: string, logger: Logger) {
    this.api = api;
    this.destination = destination;
    this.label = label;
    this.logger = logger;
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

  async finish(html: string): Promise<number[]> {
    this.typing.stop();
    const rendered = splitRichHtml(html);
    const chunks = rendered.length > 0 ? rendered : [`<p>${escapeHtml(strings.errors.empty)}</p>`];
    const ids: number[] = [];
    for (const chunk of chunks) {
      ids.push(
        await sendRich(this.api, this.destination, chunk, ids.at(-1) ?? this.destination.replyTo),
      );
    }
    await this.removePlaceholder();
    return ids;
  }

  async fail(message: string): Promise<number[]> {
    this.typing.stop();
    const id = await sendFormatted(
      this.api,
      this.destination,
      plain(message),
      this.destination.replyTo,
    );
    await this.removePlaceholder();
    return [id];
  }

  private async removePlaceholder(): Promise<void> {
    if (this.placeholder === undefined) return;
    await this.api
      .deleteMessage(this.destination.chatId, this.placeholder)
      .catch((err: unknown) => this.logger.warn({ err }, "placeholder delete failed"));
  }
}
