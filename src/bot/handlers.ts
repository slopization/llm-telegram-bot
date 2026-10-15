import { randomBytes } from "node:crypto";
import type { Bot, Context, Filter } from "grammy";
import type { Message } from "grammy/types";
import { parseCommand } from "../commands/parse.ts";
import type { NodeRecord, PendingRecord } from "../db/repo.ts";
import { page, representatives, sortModels } from "../providers/models.ts";
import type { ModelInfo } from "../providers/types.ts";
import { plain } from "../render/formatted.ts";
import { LANGUAGE_LABELS } from "../render/run.ts";
import { split } from "../render/split.ts";
import { extractCode } from "../sandbox/code.ts";
import type { Language } from "../sandbox/run.ts";
import { strings } from "../strings.ts";
import type { Destination } from "../telegram/send.ts";
import { dayOf } from "../time.ts";
import { runAnswer } from "./answer-flow.ts";
import { budgetText } from "./budget.ts";
import { runCode } from "./code-flow.ts";
import { helpText, startText } from "./commands.ts";
import type { Deps } from "./deps.ts";
import {
  allModelsKeyboard,
  decodeSelection,
  MODEL_PAGE_SIZE,
  providerKeyboard,
  type Selection,
  topModelsKeyboard,
} from "./keyboards.ts";
import { modelsText } from "./models.ts";
import { preview, queueText, senderName } from "./queue.ts";

const CHAIN_KINDS = new Set(["prompt", "answer"]);

type CallbackContext = Filter<Context, "callback_query:data">;

function isAllowed(deps: Deps, ctx: Context): boolean {
  const chat = ctx.chat;
  if (chat === undefined) return false;
  if (chat.type === "private") {
    return ctx.from !== undefined && deps.config.telegram.allowedUserIds.includes(ctx.from.id);
  }
  if (chat.type === "group" || chat.type === "supergroup") {
    return deps.config.telegram.allowedChatIds.includes(chat.id);
  }
  return false;
}

function threadOf(message: Message): number | undefined {
  return message.is_topic_message ? message.message_thread_id : undefined;
}

function destinationOf(message: Message, replyTo: number): Destination {
  return {
    chatId: message.chat.id,
    threadId: threadOf(message),
    replyTo,
    isPrivate: message.chat.type === "private",
  };
}

function realReply(message: Message): Message | undefined {
  const reply = message.reply_to_message;
  if (reply === undefined || reply.forum_topic_created !== undefined) return undefined;
  if (message.is_topic_message && reply.message_id === message.message_thread_id) return undefined;
  return reply;
}

function today(deps: Deps): string {
  return dayOf(Date.now(), deps.config.timezone);
}

function replyText(ctx: Context, text: string) {
  const message = ctx.msg;
  return ctx.reply(text, {
    ...(message !== undefined ? { reply_parameters: { message_id: message.message_id } } : {}),
  });
}

function insertPrompt(
  deps: Deps,
  message: Message,
  text: string,
  parent: NodeRecord | undefined,
): number {
  const userId = message.from?.id ?? 0;
  const id = deps.repo.insertNode({
    parentId: parent?.id ?? null,
    chatId: message.chat.id,
    userId,
    kind: "prompt",
    text,
    provider: parent?.provider ?? null,
    model: parent?.model ?? null,
    day: today(deps),
  });
  deps.repo.linkMessages(message.chat.id, [message.message_id], id);
  return id;
}

async function continueChain(
  ctx: Context,
  deps: Deps,
  message: Message,
  parent: NodeRecord,
  text: string,
) {
  if (parent.provider === null || parent.model === null) {
    await replyText(ctx, strings.errors.noModel);
    return;
  }
  const quote = message.quote?.text;
  const prompt = quote !== undefined ? strings.partialQuotePrompt(quote, text) : text;
  const promptNodeId = insertPrompt(deps, message, prompt, parent);
  deps.tasks.track(
    runAnswer(deps, ctx.api, {
      promptNodeId,
      destination: destinationOf(message, message.message_id),
      userId: message.from?.id ?? 0,
    }),
    {
      chatId: message.chat.id,
      sender: senderName(message.from),
      label: strings.queueAnswer(parent.model),
      preview: preview(text),
      startedAt: Date.now(),
    },
  );
}

async function startConversation(ctx: Context, deps: Deps, message: Message, prompt: string) {
  const nodeId = insertPrompt(deps, message, prompt, undefined);
  const userId = message.from?.id ?? 0;
  const id = randomBytes(6).toString("base64url");
  deps.repo.createPending({
    id,
    chatId: message.chat.id,
    userId,
    nodeId,
    messageId: message.message_id,
    threadId: threadOf(message) ?? null,
  });
  await ctx.reply(strings.chooseProvider, {
    reply_markup: providerKeyboard(id, providerNames(deps), recentModel(deps, userId)),
    reply_parameters: { message_id: message.message_id },
  });
}

function providerNames(deps: Deps): string[] {
  return deps.providers.map((provider) => provider.name);
}

function recentModel(deps: Deps, userId: number): string | undefined {
  const preference = deps.repo.preference(userId);
  if (preference === undefined) return undefined;
  return providerNames(deps).includes(preference.provider) ? preference.model : undefined;
}

async function handleAsk(ctx: Context, deps: Deps, message: Message, args: string) {
  const reply = realReply(message);
  if (reply === undefined) {
    if (args === "") await replyText(ctx, strings.askUsage);
    else await startConversation(ctx, deps, message, args);
    return;
  }
  const node = deps.repo.nodeByMessage(message.chat.id, reply.message_id);
  if (node !== undefined && CHAIN_KINDS.has(node.kind)) {
    if (args === "") await replyText(ctx, strings.replyNeedsText);
    else await continueChain(ctx, deps, message, node, args);
    return;
  }
  const quote = node?.text ?? reply.text ?? reply.caption ?? "";
  if (quote === "" && args === "") {
    await replyText(ctx, strings.askUsage);
    return;
  }
  const prompt = args === "" ? quote : quote === "" ? args : strings.quotedPrompt(quote, args);
  await startConversation(ctx, deps, message, prompt);
}

async function handleCode(
  ctx: Context,
  deps: Deps,
  message: Message,
  language: Language,
  args: string,
) {
  const reply = realReply(message);
  const code = extractCode(args !== "" ? args : (reply?.text ?? reply?.caption ?? ""));
  if (code === "") {
    await replyText(ctx, strings.noCode);
    return;
  }
  const limits = deps.config.sandbox;
  if (!limits.enabled) {
    await replyText(ctx, strings.sandboxDisabled);
    return;
  }
  const userId = message.from?.id ?? 0;
  if (deps.repo.dailyUsage(userId, today(deps)).sandboxRuns >= limits.dailyLimitPerUser) {
    await replyText(ctx, strings.sandboxQuotaExceeded(limits.dailyLimitPerUser));
    return;
  }
  deps.tasks.track(
    runCode(deps, ctx.api, {
      destination: destinationOf(message, message.message_id),
      userId,
      language,
      code,
    }),
    {
      chatId: message.chat.id,
      sender: senderName(message.from),
      label: strings.queueCode(LANGUAGE_LABELS[language]),
      preview: preview(code),
      startedAt: Date.now(),
    },
  );
}

async function handleUsage(ctx: Context, deps: Deps, message: Message) {
  const usage = deps.repo.dailyUsage(message.from?.id ?? 0, today(deps));
  await replyText(
    ctx,
    strings.usage(
      usage.webSearches,
      deps.config.tools.webSearch.dailyLimitPerUser,
      usage.sandboxRuns,
      deps.config.sandbox.dailyLimitPerUser,
    ),
  );
}

async function onMessage(ctx: Context, deps: Deps) {
  const message = ctx.message;
  if (message === undefined) return;
  const text = message.text ?? message.caption ?? "";
  const command = parseCommand(text, ctx.me.username);
  if (command === undefined) {
    const reply = realReply(message);
    if (reply === undefined || message.text === undefined) return;
    const node = deps.repo.nodeByMessage(message.chat.id, reply.message_id);
    if (node !== undefined && CHAIN_KINDS.has(node.kind)) {
      await continueChain(ctx, deps, message, node, message.text);
    }
    return;
  }
  switch (command.name) {
    case "start":
      await replyText(ctx, startText());
      return;
    case "help":
      await replyText(ctx, helpText(command.args));
      return;
    case "ask":
      await handleAsk(ctx, deps, message, command.args);
      return;
    case "py":
      await handleCode(ctx, deps, message, "python", command.args);
      return;
    case "js":
      await handleCode(ctx, deps, message, "javascript", command.args);
      return;
    case "bash":
      await handleCode(ctx, deps, message, "bash", command.args);
      return;
    case "usage":
      await handleUsage(ctx, deps, message);
      return;
    case "budget":
      await replyText(ctx, await budgetText(deps));
      return;
    case "models":
      for (const chunk of split(plain(await modelsText(deps.providers, deps.logger)))) {
        await replyText(ctx, chunk.text);
      }
      return;
    case "queue":
      await replyText(ctx, queueText(deps.tasks.inChat(message.chat.id), Date.now()));
      return;
  }
}

async function loadModels(deps: Deps, providerIndex: number): Promise<ModelInfo[] | undefined> {
  const provider = deps.providers[providerIndex];
  if (provider === undefined) return undefined;
  try {
    return sortModels(await provider.listModels());
  } catch (err) {
    deps.logger.error({ err, provider: provider.name }, "model list failed");
    return undefined;
  }
}

async function choose(
  ctx: CallbackContext,
  deps: Deps,
  pending: PendingRecord,
  providerName: string,
  model: string,
) {
  if (!deps.repo.deletePending(pending.id)) return;
  await ctx
    .deleteMessage()
    .catch((err: unknown) => deps.logger.debug({ err }, "selection delete failed"));
  deps.repo.setNodeModel(pending.nodeId, providerName, model);
  deps.repo.setPreference(pending.userId, providerName, model);
  deps.tasks.track(
    runAnswer(deps, ctx.api, {
      promptNodeId: pending.nodeId,
      destination: {
        chatId: pending.chatId,
        threadId: pending.threadId ?? undefined,
        replyTo: pending.messageId,
        isPrivate: ctx.chat?.type === "private",
      },
      userId: pending.userId,
    }),
    {
      chatId: pending.chatId,
      sender: senderName(ctx.from),
      label: strings.queueAnswer(model),
      preview: preview(deps.repo.node(pending.nodeId)?.text ?? ""),
      startedAt: Date.now(),
    },
  );
}

async function showModels(
  ctx: CallbackContext,
  deps: Deps,
  selection: Extract<Selection, { action: "provider" | "all" }>,
): Promise<boolean> {
  const models = await loadModels(deps, selection.provider);
  const providerName = deps.providers[selection.provider]?.name;
  if (models === undefined || models.length === 0 || providerName === undefined) return false;
  const button = (model: ModelInfo) => ({ label: model.id, index: models.indexOf(model) });
  if (selection.action === "provider") {
    await ctx.editMessageText(strings.chooseModel(providerName, 0, 1), {
      reply_markup: topModelsKeyboard(
        selection.id,
        selection.provider,
        representatives(models, deps.config.chat.featuredModels).map(button),
      ),
    });
    return true;
  }
  const current = page(models, selection.page, MODEL_PAGE_SIZE);
  await ctx.editMessageText(strings.chooseModel(providerName, current.current, current.pages), {
    reply_markup: allModelsKeyboard(
      selection.id,
      selection.provider,
      current.items.map(button),
      current.current,
      current.pages,
    ),
  });
  return true;
}

async function onCallback(ctx: CallbackContext, deps: Deps) {
  const selection = decodeSelection(ctx.callbackQuery.data);
  const pending = selection === undefined ? undefined : deps.repo.pending(selection.id);
  if (selection === undefined || pending === undefined) {
    await ctx.answerCallbackQuery({ text: strings.selectionExpired });
    await ctx.editMessageReplyMarkup().catch(() => undefined);
    return;
  }
  if (ctx.from.id !== pending.userId) {
    await ctx.answerCallbackQuery({ text: strings.onlyRequester });
    return;
  }

  switch (selection.action) {
    case "cancel":
      if (deps.repo.deletePending(pending.id)) await ctx.editMessageText(strings.cancelled);
      break;
    case "back":
      await ctx.editMessageText(strings.chooseProvider, {
        reply_markup: providerKeyboard(
          selection.id,
          providerNames(deps),
          recentModel(deps, pending.userId),
        ),
      });
      break;
    case "recent": {
      const preference = deps.repo.preference(pending.userId);
      if (preference !== undefined && providerNames(deps).includes(preference.provider)) {
        await choose(ctx, deps, pending, preference.provider, preference.model);
      }
      break;
    }
    case "provider":
    case "all":
      if (!(await showModels(ctx, deps, selection))) {
        await ctx.answerCallbackQuery({ text: strings.noModels });
        return;
      }
      break;
    case "model": {
      const models = await loadModels(deps, selection.provider);
      const model = models?.[selection.model];
      const providerName = deps.providers[selection.provider]?.name;
      if (model === undefined || providerName === undefined) {
        await ctx.answerCallbackQuery({ text: strings.noModels });
        return;
      }
      await choose(ctx, deps, pending, providerName, model.id);
      break;
    }
  }
  await ctx.answerCallbackQuery().catch(() => undefined);
}

export function registerHandlers(bot: Bot, deps: Deps): void {
  bot.use(async (ctx, next) => {
    if (isAllowed(deps, ctx)) await next();
  });
  bot.on("message", (ctx) => onMessage(ctx, deps));
  bot.on("callback_query:data", (ctx) => onCallback(ctx, deps));
}
