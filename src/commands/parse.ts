export const COMMANDS = ["start", "help", "ask", "py", "js", "bash", "usage", "budget"] as const;
export type CommandName = (typeof COMMANDS)[number];

export const ALIASES: Record<string, CommandName> = { a: "ask" };

export interface ParsedCommand {
  name: CommandName;
  args: string;
}

const COMMAND_PATTERN = /^\/([a-z0-9_]+)(?:@([a-z0-9_]+))?(?:[ \t\n]+|$)/i;

export function parseCommand(text: string, botUsername: string): ParsedCommand | undefined {
  const match = COMMAND_PATTERN.exec(text);
  if (match === null) return undefined;
  const [prefix, rawName = "", mention] = match;
  if (mention !== undefined && mention.toLowerCase() !== botUsername.toLowerCase()) {
    return undefined;
  }
  const lowered = rawName.toLowerCase();
  const name = ALIASES[lowered] ?? (COMMANDS as readonly string[]).find((c) => c === lowered);
  if (name === undefined) return undefined;
  return { name: name as CommandName, args: text.slice(prefix.length).trim() };
}
