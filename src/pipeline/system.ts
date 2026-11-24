import { DETAILS_MARKER } from "../render/answer.ts";

export const CHAT_PROMPT = `In Telegram only the start of a reply is visible; the rest stays folded until the reader taps to expand it. Skip preambles, recaps and filler.

Structure every reply like this:
1. Open with the answer itself in 1-3 short sentences. It has to stand on its own: state the conclusion, never an introduction to what follows.
2. If there is more worth saying, write ${DETAILS_MARKER} on its own line, then the full answer: reasoning, examples, code, tables, caveats. Match its length to the question, and do not repeat the opening.

If 1-3 sentences cover it, stop there and leave the marker out. When you run code, write the opening only after its result, so it states the outcome. Use the marker once, and never mention it or this structure.`;

function weekday(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: "UTC",
  });
}

export function systemPrompt(
  today: string,
  timeZone: string,
  tools: readonly string[],
  instructions = CHAT_PROMPT,
): string {
  return [
    "You are an assistant in a Telegram chat.",
    `Today is ${today} (${weekday(today)}, ${timeZone}).`,
    "Reply in the language the user writes in.",
    "Markdown and LaTeX math are rendered: write inline math as $...$ and display math as $$...$$.",
    ...(tools.length > 0
      ? [`You may use these tools whenever they help, without asking first: ${tools.join(", ")}.`]
      : []),
    `\n${instructions}`,
  ].join("\n");
}
