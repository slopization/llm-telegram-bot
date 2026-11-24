import type { Config } from "../config.ts";
import type { Repo } from "../db/repo.ts";
import type { Logger } from "../log.ts";
import type { Provider } from "../providers/types.ts";
import type { Sandbox } from "../sandbox/run.ts";
import type { MediaSender } from "../telegram/media.ts";

export interface TaskInfo {
  chatId: number;
  userId: number;
  sender: string;
  label: string;
  preview: string;
  startedAt: number;
}

interface RunningTask {
  info: TaskInfo;
  controller: AbortController;
}

export class Tasks {
  private readonly running = new Map<Promise<void>, RunningTask>();
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  track(run: (signal: AbortSignal) => Promise<void>, info: TaskInfo): void {
    const controller = new AbortController();
    const tracked = run(controller.signal)
      .catch((err: unknown) => this.logger.error({ err }, "background task failed"))
      .finally(() => this.running.delete(tracked));
    this.running.set(tracked, { info, controller });
  }

  inChat(chatId: number): TaskInfo[] {
    return [...this.running.values()]
      .filter((task) => task.info.chatId === chatId && !task.controller.signal.aborted)
      .map((task) => task.info)
      .sort((a, b) => a.startedAt - b.startedAt);
  }

  cancel(info: TaskInfo): boolean {
    const task = [...this.running.values()].find((candidate) => candidate.info === info);
    if (task === undefined || task.controller.signal.aborted) return false;
    task.controller.abort();
    return true;
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
