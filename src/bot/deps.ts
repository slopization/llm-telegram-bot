import type { Config } from "../config.ts";
import type { Repo } from "../db/repo.ts";
import type { Logger } from "../log.ts";
import type { Provider } from "../providers/types.ts";
import type { Sandbox } from "../sandbox/run.ts";
import type { MediaSender } from "../telegram/media.ts";

export interface TaskInfo {
  chatId: number;
  sender: string;
  label: string;
  preview: string;
  startedAt: number;
}

export class Tasks {
  private readonly running = new Map<Promise<void>, TaskInfo>();
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  track(task: Promise<void>, info: TaskInfo): void {
    const tracked = task
      .catch((err: unknown) => this.logger.error({ err }, "background task failed"))
      .finally(() => this.running.delete(tracked));
    this.running.set(tracked, info);
  }

  inChat(chatId: number): TaskInfo[] {
    return [...this.running.values()]
      .filter((info) => info.chatId === chatId)
      .sort((a, b) => a.startedAt - b.startedAt);
  }

  async drain(): Promise<void> {
    await Promise.allSettled([...this.running.keys()]);
  }
}

export interface Deps {
  config: Config;
  repo: Repo;
  providers: Provider[];
  sandbox: Sandbox;
  media: MediaSender;
  logger: Logger;
  shutdown: AbortSignal;
  tasks: Tasks;
}
