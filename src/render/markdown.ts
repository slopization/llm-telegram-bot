import type { MessageEntity } from "grammy/types";
import { marked, type Token, type Tokens } from "marked";
import { type Formatted, trimEnd } from "./formatted.ts";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type EntitySpec = DistributiveOmit<MessageEntity, "offset" | "length">;

const LINK_PROTOCOLS = ["http:", "https:", "tg:"];
const STYLE_TYPES = new Set(["bold", "italic", "underline", "strikethrough", "spoiler"]);

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (match) => HTML_ENTITIES[match] ?? match);
}

function isLinkable(href: string): boolean {
  try {
    return LINK_PROTOCOLS.includes(new URL(href).protocol);
  } catch {
    return false;
  }
}

function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    const wide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe4f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1faff);
    width += wide ? 2 : 1;
  }
  return width;
}

class Renderer {
  private text = "";
  private readonly entities: MessageEntity[] = [];
  private readonly open: string[] = [];

  result(): Formatted {
    return trimEnd({ text: this.text, entities: this.entities });
  }

  blocks(tokens: Token[]): void {
    let first = true;
    for (const token of tokens) {
      if (token.type === "space" || token.type === "def") continue;
      if (!first) this.append("\n\n");
      first = false;
      this.block(token);
    }
  }

  private append(text: string): void {
    this.text += text;
  }

  private canOpen(type: string): boolean {
    if (STYLE_TYPES.has(type)) return true;
    if (type === "text_link") return this.open.every((open) => STYLE_TYPES.has(open));
    if (type === "blockquote") return !this.open.includes("blockquote");
    return this.open.length === 0;
  }

  private wrap(entity: EntitySpec, render: () => void): void {
    const offset = this.text.length;
    this.open.push(entity.type);
    render();
    this.open.pop();
    const length = this.text.length - offset;
    if (length > 0) this.entities.push({ ...entity, offset, length } as MessageEntity);
  }

  private block(token: Token): void {
    switch (token.type) {
      case "paragraph":
      case "text":
        this.inline((token as Tokens.Paragraph).tokens ?? [], (token as Tokens.Text).text);
        return;
      case "heading":
        this.wrap({ type: "bold" }, () => this.inline((token as Tokens.Heading).tokens));
        return;
      case "code":
        this.code(token as Tokens.Code);
        return;
      case "blockquote":
        this.blockquote(token as Tokens.Blockquote);
        return;
      case "list":
        this.list(token as Tokens.List, 0);
        return;
      case "table":
        this.table(token as Tokens.Table);
        return;
      case "hr":
        this.append("---");
        return;
      default:
        this.append(decodeEntities("text" in token ? String(token.text) : token.raw).trimEnd());
    }
  }

  private code(token: Tokens.Code): void {
    if (!this.canOpen("pre")) {
      this.append(token.text);
      return;
    }
    const language = token.lang?.split(/\s/)[0];
    const entity: EntitySpec = language ? { type: "pre", language } : { type: "pre" };
    this.wrap(entity, () => this.append(token.text));
  }

  private blockquote(token: Tokens.Blockquote): void {
    if (!this.canOpen("blockquote")) {
      this.blocks(token.tokens);
      return;
    }
    this.wrap({ type: "blockquote" }, () => this.blocks(token.tokens));
  }

  private list(token: Tokens.List, depth: number): void {
    const start = typeof token.start === "number" ? token.start : 1;
    token.items.forEach((item, index) => {
      if (index > 0 || depth > 0) this.append("\n");
      const marker = token.ordered ? `${start + index}. ` : "- ";
      const checkbox = item.task ? (item.checked ? "[x] " : "[ ] ") : "";
      this.append(`${"  ".repeat(depth)}${marker}${checkbox}`);
      this.listItem(item, depth);
    });
  }

  private listItem(item: Tokens.ListItem, depth: number): void {
    let first = true;
    for (const child of item.tokens) {
      if (child.type === "checkbox" || child.type === "space") continue;
      if (child.type === "list") {
        this.list(child as Tokens.List, depth + 1);
        continue;
      }
      if (!first) this.append(`\n${"  ".repeat(depth + 1)}`);
      first = false;
      this.block(child);
    }
  }

  private table(token: Tokens.Table): void {
    const cellText = (cell: Tokens.TableCell) => {
      const nested = new Renderer();
      nested.inline(cell.tokens, cell.text);
      return nested.result().text.replace(/\n/g, " ");
    };
    const rows = [token.header.map(cellText), ...token.rows.map((row) => row.map(cellText))];
    const widths = token.header.map((_, column) =>
      Math.max(...rows.map((row) => displayWidth(row[column] ?? ""))),
    );
    const pad = (text: string, column: number) => {
      const fill = " ".repeat((widths[column] ?? 0) - displayWidth(text));
      return token.align[column] === "right" ? fill + text : text + fill;
    };
    const line = (row: string[]) =>
      row
        .map((cell, column) => pad(cell, column))
        .join(" | ")
        .trimEnd();
    const separator = widths.map((width) => "-".repeat(width)).join("-+-");
    const [header = [], ...body] = rows;
    const text = [line(header), separator, ...body.map(line)].join("\n");
    if (!this.canOpen("pre")) {
      this.append(text);
      return;
    }
    this.wrap({ type: "pre" }, () => this.append(text));
  }

  private inline(tokens: Token[], fallback = ""): void {
    if (tokens.length === 0) {
      this.append(decodeEntities(fallback));
      return;
    }
    for (const token of tokens) this.inlineToken(token);
  }

  private inlineToken(token: Token): void {
    switch (token.type) {
      case "strong":
        this.wrap({ type: "bold" }, () => this.inline((token as Tokens.Strong).tokens));
        return;
      case "em":
        this.wrap({ type: "italic" }, () => this.inline((token as Tokens.Em).tokens));
        return;
      case "del":
        this.wrap({ type: "strikethrough" }, () => this.inline((token as Tokens.Del).tokens));
        return;
      case "codespan":
        this.codespan(token as Tokens.Codespan);
        return;
      case "br":
        this.append("\n");
        return;
      case "link":
        this.link(token as Tokens.Link);
        return;
      case "image": {
        const image = token as Tokens.Image;
        this.append(image.text || image.href);
        return;
      }
      case "escape":
        this.append((token as Tokens.Escape).text);
        return;
      case "text": {
        const text = token as Tokens.Text;
        if (text.tokens && text.tokens.length > 0) this.inline(text.tokens);
        else this.append(decodeEntities(text.text));
        return;
      }
      default:
        this.append(decodeEntities("text" in token ? String(token.text) : token.raw));
    }
  }

  private codespan(token: Tokens.Codespan): void {
    if (!this.canOpen("code")) {
      this.append(token.text);
      return;
    }
    this.wrap({ type: "code" }, () => this.append(token.text));
  }

  private link(token: Tokens.Link): void {
    if (!isLinkable(token.href)) {
      this.inline(token.tokens, token.text);
      return;
    }
    if (!this.canOpen("text_link")) {
      this.inline(token.tokens, token.text);
      if (token.text !== token.href) this.append(` (${token.href})`);
      return;
    }
    this.wrap({ type: "text_link", url: token.href }, () => this.inline(token.tokens, token.text));
  }
}

export function renderMarkdown(markdown: string): Formatted {
  const renderer = new Renderer();
  renderer.blocks(marked.lexer(markdown, { gfm: true }));
  return renderer.result();
}
