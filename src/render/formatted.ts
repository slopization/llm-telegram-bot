import type { MessageEntity } from "grammy/types";

export interface Formatted {
  text: string;
  entities: MessageEntity[];
}

export const EMPTY: Formatted = { text: "", entities: [] };

export function plain(text: string): Formatted {
  return { text, entities: [] };
}

export function slice(source: Formatted, start: number, end = source.text.length): Formatted {
  const entities: MessageEntity[] = [];
  for (const entity of source.entities) {
    const from = Math.max(entity.offset, start);
    const to = Math.min(entity.offset + entity.length, end);
    if (to > from) entities.push({ ...entity, offset: from - start, length: to - from });
  }
  return { text: source.text.slice(start, end), entities };
}

export function concat(...parts: Formatted[]): Formatted {
  let text = "";
  const entities: MessageEntity[] = [];
  for (const part of parts) {
    for (const entity of part.entities) {
      entities.push({ ...entity, offset: entity.offset + text.length });
    }
    text += part.text;
  }
  return { text, entities };
}

export function trimEnd(source: Formatted): Formatted {
  return slice(source, 0, source.text.trimEnd().length);
}
