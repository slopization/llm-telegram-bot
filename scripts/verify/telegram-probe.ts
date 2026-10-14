import { autoRetry } from "@grammyjs/auto-retry";
import { Bot, InlineKeyboard } from "grammy";
import { loadConfig } from "../../src/config.ts";

const bot = new Bot(loadConfig().telegram.botToken);
bot.api.config.use(autoRetry());

bot.use(async (ctx, next) => {
  const message = ctx.message;
  console.log(
    JSON.stringify({
      update: Object.keys(ctx.update).filter((key) => key !== "update_id"),
      chat: ctx.chat && { id: ctx.chat.id, type: ctx.chat.type },
      from: ctx.from?.id,
      message_id: message?.message_id,
      text: message?.text,
      reply_to: message?.reply_to_message && {
        message_id: message.reply_to_message.message_id,
        from_bot: message.reply_to_message.from?.is_bot,
      },
      thread: message?.message_thread_id,
      is_topic_message: message?.is_topic_message,
      stopped: ctx.update.stopped_message_generation,
    }),
  );
  await next();
});

const running = new Map<number, AbortController>();

bot.on("stopped_message_generation", (ctx) => {
  running.get(ctx.update.stopped_message_generation.draft_id)?.abort();
});

bot.command("probe", async (ctx) => {
  if (ctx.chat.type !== "private") {
    await ctx.reply("probe 답장 대상", { reply_parameters: { message_id: ctx.msg.message_id } });
    return;
  }

  const draftId = ctx.update.update_id;
  const controller = new AbortController();
  running.set(draftId, controller);
  let text = "";
  for (let index = 1; index <= 30 && !controller.signal.aborted; index++) {
    text += `${index}번째 줄입니다.\n`;
    await ctx.api.sendMessageDraft(ctx.chat.id, draftId, text, { can_stop: true });
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  running.delete(draftId);

  const sent = await ctx.reply(text, {
    entities: [{ type: "bold", offset: 0, length: 1 }],
    reply_parameters: { message_id: ctx.msg.message_id },
    reply_markup: new InlineKeyboard().text("probe button", "probe"),
  });
  console.log(
    `draft finished (stopped=${controller.signal.aborted}), message_id=${sent.message_id}`,
  );
});

bot.callbackQuery("probe", (ctx) => ctx.answerCallbackQuery("ok"));

await bot.start({
  onStart: (me) => console.log(`probe running as @${me.username}`),
});
