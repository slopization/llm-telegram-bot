import { InlineKeyboard } from "grammy";
import { strings } from "../strings.ts";

export const MODEL_PAGE_SIZE = 8;

export type Selection =
  | { action: "back"; id: string }
  | { action: "cancel"; id: string }
  | { action: "recent"; id: string }
  | { action: "provider"; id: string; provider: number }
  | { action: "all"; id: string; provider: number; page: number }
  | { action: "model"; id: string; provider: number; model: number };

export function encodeSelection(selection: Selection): string {
  switch (selection.action) {
    case "back":
      return `b:${selection.id}`;
    case "cancel":
      return `x:${selection.id}`;
    case "recent":
      return `r:${selection.id}`;
    case "provider":
      return `p:${selection.id}:${selection.provider}`;
    case "all":
      return `a:${selection.id}:${selection.provider}:${selection.page}`;
    case "model":
      return `m:${selection.id}:${selection.provider}:${selection.model}`;
  }
}

export function decodeSelection(data: string): Selection | undefined {
  const [action, id, ...rest] = data.split(":");
  if (id === undefined || id === "") return undefined;
  const numbers = rest.map(Number);
  if (numbers.some((value) => !Number.isInteger(value) || value < 0)) return undefined;
  const [first, second] = numbers;
  if (action === "b" && numbers.length === 0) return { action: "back", id };
  if (action === "x" && numbers.length === 0) return { action: "cancel", id };
  if (action === "r" && numbers.length === 0) return { action: "recent", id };
  if (action === "p" && numbers.length === 1 && first !== undefined) {
    return { action: "provider", id, provider: first };
  }
  if (action === "a" && first !== undefined && second !== undefined && numbers.length === 2) {
    return { action: "all", id, provider: first, page: second };
  }
  if (action === "m" && first !== undefined && second !== undefined && numbers.length === 2) {
    return { action: "model", id, provider: first, model: second };
  }
  return undefined;
}

export function providerKeyboard(
  id: string,
  providers: readonly string[],
  recent?: string,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (recent !== undefined) {
    keyboard.text(strings.recentButton(recent), encodeSelection({ action: "recent", id })).row();
  }
  providers.forEach((name, provider) => {
    keyboard.text(name, encodeSelection({ action: "provider", id, provider })).row();
  });
  return keyboard.text(strings.cancelButton, encodeSelection({ action: "cancel", id }));
}

export interface ModelButton {
  label: string;
  index: number;
}

export function topModelsKeyboard(
  id: string,
  provider: number,
  models: readonly ModelButton[],
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const model of models) {
    keyboard
      .text(model.label, encodeSelection({ action: "model", id, provider, model: model.index }))
      .row();
  }
  return keyboard
    .text(strings.allModelsButton, encodeSelection({ action: "all", id, provider, page: 0 }))
    .text(strings.backButton, encodeSelection({ action: "back", id }))
    .text(strings.cancelButton, encodeSelection({ action: "cancel", id }));
}

export function allModelsKeyboard(
  id: string,
  provider: number,
  models: readonly ModelButton[],
  page: number,
  pages: number,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const model of models) {
    keyboard
      .text(model.label, encodeSelection({ action: "model", id, provider, model: model.index }))
      .row();
  }
  if (page > 0) {
    keyboard.text(
      strings.previousPageButton,
      encodeSelection({ action: "all", id, provider, page: page - 1 }),
    );
  }
  if (page < pages - 1) {
    keyboard.text(
      strings.nextPageButton,
      encodeSelection({ action: "all", id, provider, page: page + 1 }),
    );
  }
  return keyboard
    .row()
    .text(strings.backButton, encodeSelection({ action: "provider", id, provider }))
    .text(strings.cancelButton, encodeSelection({ action: "cancel", id }));
}
