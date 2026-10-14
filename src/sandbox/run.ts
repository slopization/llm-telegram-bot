import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { Config } from "../config.ts";
import type { Logger } from "../log.ts";
import { echoLastJavaScriptValue, PYTHON_ECHO_RUNNER } from "./echo.ts";
import { readTar } from "./tar.ts";

const execFileAsync = promisify(execFile);

export const LANGUAGES = ["python", "javascript", "bash"] as const;
export type Language = (typeof LANGUAGES)[number];

const IMAGE = "llm-bot-sandbox";
const IMAGE_CONTEXT = fileURLToPath(new URL("../../sandbox", import.meta.url));

const COMMANDS: Record<Language, { workdir: string; command: string[] }> = {
  python: { workdir: "/tmp", command: ["python", "-"] },
  javascript: { workdir: "/sandbox", command: ["node", "--input-type=module", "-"] },
  bash: { workdir: "/tmp", command: ["bash", "-s"] },
};

interface Prepared {
  command: string[];
  input: string;
}

function prepare(language: Language, code: string, echoLastValue: boolean): Prepared {
  const { command } = COMMANDS[language];
  if (!echoLastValue) return { command, input: code };
  if (language === "python") return { command: ["python", "-c", PYTHON_ECHO_RUNNER], input: code };
  if (language === "javascript") return { command, input: echoLastJavaScriptValue(code) };
  return { command, input: code };
}

const CONTAINER_LABEL = "llm-telegram-bot.sandbox=1";
const BUILD_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_STREAM_BYTES = 256 * 1024;
const OOM_EXIT_CODE = 137;

export interface OutputFile {
  name: string;
  data: Buffer;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number | undefined;
  timedOut: boolean;
  outOfMemory: boolean;
  durationMs: number;
  files: OutputFile[];
  totalFiles: number;
}

type Limits = Config["sandbox"];

class Collector {
  private readonly chunks: Buffer[] = [];
  private size = 0;

  push(chunk: Buffer): void {
    if (this.size >= MAX_STREAM_BYTES) return;
    const room = MAX_STREAM_BYTES - this.size;
    const kept = chunk.length > room ? chunk.subarray(0, room) : chunk;
    this.chunks.push(kept);
    this.size += kept.length;
  }

  text(): string {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

async function docker(args: string[], maxBuffer = 1024 * 1024): Promise<Buffer> {
  const { stdout } = await execFileAsync("docker", args, { encoding: "buffer", maxBuffer });
  return stdout;
}

function isMissingImage(error: unknown): boolean {
  const stderr = (error as { stderr?: Buffer | string }).stderr?.toString() ?? "";
  return /no such image|unable to find image/i.test(stderr);
}

export class Sandbox {
  private readonly limits: Limits;
  private readonly logger: Logger;
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  private building: Promise<void> | undefined;

  constructor(limits: Limits, logger: Logger) {
    this.limits = limits;
    this.logger = logger;
  }

  async ensureImage(): Promise<void> {
    const exists = await docker(["image", "inspect", IMAGE]).then(
      () => true,
      () => false,
    );
    if (!exists) await this.build();
  }

  private build(): Promise<void> {
    if (this.building !== undefined) return this.building;
    this.logger.warn({ image: IMAGE }, "sandbox image missing, building");
    this.building = execFileAsync("docker", ["build", "-t", IMAGE, IMAGE_CONTEXT], {
      maxBuffer: 64 * 1024 * 1024,
      timeout: BUILD_TIMEOUT_MS,
    })
      .then(() => this.logger.info({ image: IMAGE }, "sandbox image built"))
      .finally(() => {
        this.building = undefined;
      });
    return this.building;
  }

  async cleanup(): Promise<void> {
    const ids = (await docker(["ps", "-aq", "--filter", `label=${CONTAINER_LABEL}`]))
      .toString()
      .split("\n")
      .filter((id) => id !== "");
    if (ids.length > 0) await docker(["rm", "-f", ...ids]);
  }

  async run(language: Language, code: string, echoLastValue = false): Promise<RunResult> {
    await this.acquire();
    try {
      return await this.execute(language, prepare(language, code, echoLastValue));
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.limits.concurrency) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next !== undefined) next();
    else this.active--;
  }

  private createArgs(name: string): string[] {
    const tmpfs = `size=${this.limits.diskMb}m,uid=1000,gid=1000`;
    return [
      "run",
      "-d",
      "--name",
      name,
      "--label",
      CONTAINER_LABEL,
      "--network",
      "none",
      "--read-only",
      "--tmpfs",
      `/tmp:${tmpfs}`,
      "--tmpfs",
      `/output:${tmpfs}`,
      "--memory",
      `${this.limits.memoryMb}m`,
      "--memory-swap",
      `${this.limits.memoryMb}m`,
      "--cpus",
      String(this.limits.cpus),
      "--pids-limit",
      String(this.limits.pids),
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--user",
      "1000:1000",
      "--pull",
      "never",
      IMAGE,
      "sleep",
      "infinity",
    ];
  }

  private async execute(language: Language, prepared: Prepared): Promise<RunResult> {
    const name = `llm-bot-run-${randomUUID()}`;
    await this.create(name);
    try {
      const started = Date.now();
      const exec = await this.exec(name, COMMANDS[language].workdir, prepared);
      const durationMs = Date.now() - started;
      const files = exec.timedOut ? [] : await this.collectFiles(name);
      return {
        ...exec,
        outOfMemory: !exec.timedOut && exec.exitCode === OOM_EXIT_CODE,
        durationMs,
        files: files.slice(0, this.limits.maxFiles),
        totalFiles: files.length,
      };
    } finally {
      await docker(["rm", "-f", name]).catch((err: unknown) =>
        this.logger.warn({ err, name }, "sandbox container removal failed"),
      );
    }
  }

  private async create(name: string): Promise<void> {
    try {
      await docker(this.createArgs(name));
    } catch (error) {
      if (!isMissingImage(error)) throw error;
      await this.build();
      await docker(this.createArgs(name));
    }
  }

  private exec(
    name: string,
    workdir: string,
    { command, input }: Prepared,
  ): Promise<Pick<RunResult, "stdout" | "stderr" | "exitCode" | "timedOut">> {
    return new Promise((resolve, reject) => {
      const child = spawn("docker", ["exec", "-i", "-w", workdir, name, ...command]);
      const stdout = new Collector();
      const stderr = new Collector();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, this.limits.timeoutSeconds * 1000);
      child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      child.stdin.on("error", () => undefined);
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (exitCode) => {
        clearTimeout(timer);
        resolve({
          stdout: stdout.text(),
          stderr: stderr.text(),
          exitCode: timedOut ? undefined : (exitCode ?? undefined),
          timedOut,
        });
      });
      child.stdin.end(input);
    });
  }

  private async collectFiles(name: string): Promise<OutputFile[]> {
    try {
      const archive = await docker(
        ["exec", name, "tar", "-cf", "-", "-C", "/output", "."],
        (this.limits.diskMb + 1) * 1024 * 1024,
      );
      return readTar(archive).map((file) => ({
        name: file.path.split("/").at(-1) ?? file.path,
        data: file.data,
      }));
    } catch (err) {
      this.logger.warn({ err, name }, "sandbox output collection failed");
      return [];
    }
  }
}
