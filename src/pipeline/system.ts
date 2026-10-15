function weekday(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: "UTC",
  });
}

export function systemPrompt(today: string, timeZone: string, tools: readonly string[]): string {
  return [
    "You are an assistant in a Telegram chat.",
    `Today is ${today} (${weekday(today)}, ${timeZone}).`,
    "Reply in the language the user writes in.",
    "Markdown is rendered, but LaTeX is not: write math as plain text instead of \\( \\), \\[ \\] or $$.",
    ...(tools.length > 0
      ? [`You may use these tools whenever they help, without asking first: ${tools.join(", ")}.`]
      : []),
  ].join("\n");
}
