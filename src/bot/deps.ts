import type { Config } from "../config.ts";
import type { Repo } from "../db/repo.ts";
import type { Logger } from "../log.ts";
import type { Provider } from "../providers/types.ts";
import type { Sandbox } from "../sandbox/run.ts";
import type { MediaSender } from "../telegram/media.ts";

export class Tasks {
  private readonly running = new Set<Promise<void>>();
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  track(task: Promise<void>): void {
    const tracked = task
      .catch((err: unknown) => this.logger.error({ err }, "background task failed"))
      .finally(() => this.running.delete(tracked));
    this.running.add(tracked);
  }

  async drain(): Promise<void> {
    await Promise.allSettled([...this.running]);
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
