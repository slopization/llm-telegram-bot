import { mkdirSync } from "node:fs";
import { setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";
import { autoRetry } from "@grammyjs/auto-retry";
import { Bot } from "grammy";
import { registerMenu } from "./bot/commands.ts";
import { Tasks } from "./bot/deps.ts";
import { registerHandlers } from "./bot/handlers.ts";
import { loadConfig } from "./config.ts";
import { openDatabase } from "./db/database.ts";
import { Repo } from "./db/repo.ts";
import { log } from "./log.ts";
import { createProvider } from "./providers/registry.ts";
import { Sandbox } from "./sandbox/run.ts";
import { MediaSender } from "./telegram/media.ts";

const DATA_DIRECTORY = "data";
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;
const SHUTDOWN_TIMEOUT_MS = 10_000;
const CONNECT_ATTEMPT_TIMEOUT_MS = 2000;

// Node gives each resolved address 250 ms before trying the next one. On hosts where the
// IPv4 handshake to api.telegram.org takes about that long and IPv6 is unreachable,
// every connection fails with ETIMEDOUT.
setDefaultAutoSelectFamilyAttemptTimeout(CONNECT_ATTEMPT_TIMEOUT_MS);

const config = loadConfig();
mkdirSync(DATA_DIRECTORY, { recursive: true });
const repo = new Repo(openDatabase(`${DATA_DIRECTORY}/bot.db`));
repo.deletePendingOlderThan(Date.now() - PENDING_TTL_MS);

const sandbox = new Sandbox(config.sandbox, log);
if (config.sandbox.enabled) {
  await sandbox.cleanup().catch((err: unknown) => log.warn({ err }, "sandbox cleanup failed"));
  sandbox
    .ensureImage()
    .catch((err: unknown) => log.error({ err }, "sandbox image check or build failed"));
}

const bot = new Bot(config.telegram.botToken);
bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 30 }));

const shutdown = new AbortController();
const tasks = new Tasks(log);
registerHandlers(bot, {
  config,
  repo,
  providers: config.providers.map((provider) => createProvider(provider, log)),
  sandbox,
  media: new MediaSender(bot.api, log),
  logger: log,
  shutdown: shutdown.signal,
  tasks,
});
bot.catch((error) =>
  log.error({ err: error.error, updateId: error.ctx.update.update_id }, "update failed"),
);

registerMenu(bot.api).catch((err: unknown) =>
  log.warn({ err }, "command menu registration failed"),
);

async function stop(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  shutdown.abort();
  const graceful = Promise.all([bot.stop(), tasks.drain()]);
  const deadline = new Promise((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS).unref());
  await Promise.race([graceful, deadline]);
  process.exit(0);
}
process.once("SIGTERM", () => void stop("SIGTERM"));
process.once("SIGINT", () => void stop("SIGINT"));

await bot.start({ onStart: (me) => log.info({ username: me.username }, "bot started") });
