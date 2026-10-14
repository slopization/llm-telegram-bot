import type { Api } from "grammy";
import type { Logger } from "../log.ts";
import { type Destination, threadOption } from "./send.ts";

const TYPING_INTERVAL_MS = 4500;

export class Typing {
  private readonly api: Api;
  private readonly destination: Destination;
  private readonly logger: Logger;
  private timer: NodeJS.Timeout | undefined;

  constructor(api: Api, destination: Destination, logger: Logger) {
    this.api = api;
    this.destination = destination;
    this.logger = logger;
  }

  start(): void {
    if (this.timer !== undefined) return;
    this.send();
    this.timer = setInterval(() => this.send(), TYPING_INTERVAL_MS);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private send(): void {
    this.api
      .sendChatAction(this.destination.chatId, "typing", threadOption(this.destination))
      .catch((err: unknown) => this.logger.debug({ err }, "typing action failed"));
  }
}
