import { type LookupAddress, type LookupOptions, lookup } from "node:dns";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { pipeline, type Readable } from "node:stream";
import zlib from "node:zlib";
import TurndownService from "turndown";
import type { Config } from "../config.ts";

type Limits = Config["tools"]["webFetch"];

const MAX_REDIRECTS = 5;
const MAX_CONVERTED_HTML_CHARS = 1_000_000;
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; llm-telegram-bot)",
  Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
  "Accept-Encoding": "gzip, deflate, br",
};

const NON_PUBLIC = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const) {
  NON_PUBLIC.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["2001::", 32],
  ["2001:db8::", 32],
  ["2002::", 16],
] as const) {
  NON_PUBLIC.addSubnet(network, prefix, "ipv6");
}
const GLOBAL_UNICAST = new BlockList();
GLOBAL_UNICAST.addSubnet("2000::", 3, "ipv6");

export class WebFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebFetchError";
  }
}

export function isPublicAddress(address: string): boolean {
  switch (isIP(address)) {
    case 4:
      return !NON_PUBLIC.check(address, "ipv4");
    case 6:
      return GLOBAL_UNICAST.check(address, "ipv6") && !NON_PUBLIC.check(address, "ipv6");
    default:
      return false;
  }
}

function publicLookup(
  hostname: string,
  options: LookupOptions,
  callback: (error: Error | null, address: string | LookupAddress[], family?: number) => void,
): void {
  lookup(hostname, { all: true, family: options.family ?? 0 }, (error, addresses) => {
    if (error !== null) {
      callback(error, "");
      return;
    }
    const first = addresses[0];
    if (first === undefined || addresses.some(({ address }) => !isPublicAddress(address))) {
      callback(new WebFetchError(`${hostname} resolves to a non-public address`), "");
      return;
    }
    if (options.all === true) callback(null, addresses);
    else callback(null, first.address, first.family);
  });
}

function checkedUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new WebFetchError(`invalid url: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new WebFetchError(`unsupported scheme ${url.protocol}`);
  }
  if (url.username !== "" || url.password !== "") {
    throw new WebFetchError("urls with credentials are not allowed");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) !== 0 && !isPublicAddress(host)) {
    throw new WebFetchError(`${host} is not a public address`);
  }
  return url;
}

function get(url: URL, signal: AbortSignal): Promise<IncomingMessage> {
  const client = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    client
      .get(url, { headers: HEADERS, lookup: publicLookup as LookupFunction, signal }, resolve)
      .on("error", reject);
  });
}

function decompressed(response: IncomingMessage): Readable {
  const encoding = (response.headers["content-encoding"] ?? "identity").toLowerCase();
  const decoder =
    encoding === "gzip" || encoding === "x-gzip"
      ? zlib.createGunzip()
      : encoding === "deflate"
        ? zlib.createInflate()
        : encoding === "br"
          ? zlib.createBrotliDecompress()
          : undefined;
  if (decoder === undefined) {
    if (encoding !== "identity")
      throw new WebFetchError(`unsupported content encoding ${encoding}`);
    return response;
  }
  return pipeline(response, decoder, () => undefined);
}

async function readBody(
  response: IncomingMessage,
  maxBytes: number,
): Promise<{ data: Buffer; truncated: boolean }> {
  const chunks: Buffer[] = [];
  let size = 0;
  let truncated = false;
  try {
    for await (const chunk of decompressed(response) as AsyncIterable<Buffer>) {
      const room = maxBytes - size;
      if (chunk.length >= room) {
        chunks.push(chunk.subarray(0, room));
        truncated = chunk.length > room;
        break;
      }
      chunks.push(chunk);
      size += chunk.length;
    }
  } finally {
    response.destroy();
  }
  return { data: Buffer.concat(chunks), truncated };
}

export function decodeBody(data: Buffer, contentType: string): string {
  const charset =
    /charset=["']?([\w-]+)/i.exec(contentType)?.[1] ??
    /<meta[^>]+charset=["']?([\w-]+)/i.exec(data.subarray(0, 4096).toString("latin1"))?.[1] ??
    "utf-8";
  try {
    return new TextDecoder(charset).decode(data);
  } catch {
    return new TextDecoder().decode(data);
  }
}

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
turndown.remove([
  "script",
  "style",
  "noscript",
  "template",
  "iframe",
  "object",
  "embed",
  "svg",
  "canvas",
  "head",
  "title",
  "nav",
  "footer",
  "aside",
  "button",
  "select",
]);
turndown.addRule("hidden", {
  filter: (node) =>
    node.hasAttribute("hidden") ||
    node.getAttribute("aria-hidden") === "true" ||
    /display\s*:\s*none|visibility\s*:\s*hidden/i.test(node.getAttribute("style") ?? ""),
  replacement: () => "",
});
turndown.addRule("image", { filter: "img", replacement: () => "" });

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
    if (name.startsWith("#x") || name.startsWith("#X")) {
      return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    }
    if (name.startsWith("#")) return String.fromCodePoint(Number.parseInt(name.slice(1), 10));
    return NAMED_ENTITIES[name.toLowerCase()] ?? entity;
  });
}

export function htmlToMarkdown(html: string): { title: string | undefined; markdown: string } {
  const rawTitle = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "";
  const title = decodeEntities(rawTitle).replace(/\s+/g, " ").trim();
  return {
    title: title === "" ? undefined : title,
    markdown: turndown.turndown(html.slice(0, MAX_CONVERTED_HTML_CHARS)),
  };
}

export interface FetchedPage {
  url: string;
  status: number;
  title: string | undefined;
  text: string;
  truncated: boolean;
}

function isTextType(mime: string): boolean {
  return (
    mime === "" ||
    mime.startsWith("text/") ||
    /^application\/(json|xml|javascript)$/.test(mime) ||
    /\+(json|xml)$/.test(mime)
  );
}

function toPage(
  url: URL,
  response: IncomingMessage,
  body: Buffer,
  truncated: boolean,
): FetchedPage {
  const contentType = response.headers["content-type"] ?? "";
  const mime = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  const status = response.statusCode ?? 0;
  if (mime === "text/html" || mime === "application/xhtml+xml") {
    const { title, markdown } = htmlToMarkdown(decodeBody(body, contentType));
    return { url: url.href, status, title, text: markdown, truncated };
  }
  if (!isTextType(mime)) throw new WebFetchError(`unsupported content type ${mime}`);
  return {
    url: url.href,
    status,
    title: undefined,
    text: decodeBody(body, contentType),
    truncated,
  };
}

export async function fetchPage(
  rawUrl: string,
  limits: Limits,
  signal: AbortSignal,
): Promise<FetchedPage> {
  const timeout = AbortSignal.timeout(limits.timeoutSeconds * 1000);
  const combined = AbortSignal.any([signal, timeout]);
  let url = checkedUrl(rawUrl);
  try {
    for (let redirects = 0; ; redirects++) {
      const response = await get(url, combined);
      const location = response.headers.location;
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400 && location !== undefined) {
        response.destroy();
        if (redirects >= MAX_REDIRECTS) throw new WebFetchError("too many redirects");
        url = checkedUrl(new URL(location, url).href);
        continue;
      }
      const { data, truncated } = await readBody(response, limits.maxDownloadMb * 1024 * 1024);
      return toPage(url, response, data, truncated);
    }
  } catch (error) {
    if (timeout.aborted && !signal.aborted) {
      throw new WebFetchError(`timed out after ${limits.timeoutSeconds} seconds`);
    }
    throw error;
  }
}
