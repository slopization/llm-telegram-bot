import type { Api } from "grammy";
import type { BotCommand, BotCommandScope } from "grammy/types";
import { ALIASES, COMMANDS, type CommandName } from "../commands/parse.ts";
import { strings } from "../strings.ts";

const MENU_SCOPES: BotCommandScope[] = [
  { type: "all_private_chats" },
  { type: "all_group_chats" },
  { type: "all_chat_administrators" },
];

function aliasesOf(name: CommandName): string[] {
  return Object.entries(ALIASES)
    .filter(([, target]) => target === name)
    .map(([alias]) => alias);
}

function commandList(): string {
  return COMMANDS.filter((name) => name !== "start")
    .map((name) => `/${name} - ${strings.commandDescriptions[name]}`)
    .join("\n");
}

export function startText(): string {
  return strings.start(commandList());
}

export function helpText(argument: string): string {
  if (argument === "") return strings.helpList(commandList());
  const requested = argument.replace(/^\//, "").toLowerCase();
  const name = ALIASES[requested] ?? COMMANDS.find((command) => command === requested);
  if (name === undefined) return strings.helpUnknown(requested);
  return strings.helpDetail(
    name,
    aliasesOf(name),
    strings.commandDescriptions[name],
    strings.commandUsages[name],
  );
}

export function menuCommands(): BotCommand[] {
  const commands: BotCommand[] = COMMANDS.filter((name) => name !== "start").map((name) => ({
    command: name,
    description: strings.commandDescriptions[name],
  }));
  for (const [alias, target] of Object.entries(ALIASES)) {
    commands.push({
      command: alias,
      description: strings.aliasDescription(target, strings.commandDescriptions[target]),
    });
  }
  return commands;
}

export async function registerMenu(api: Api): Promise<void> {
  const commands = menuCommands();
  for (const scope of MENU_SCOPES) await api.setMyCommands(commands, { scope });
}
