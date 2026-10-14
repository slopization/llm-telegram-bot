import type { Logger } from "../log.ts";

const PRICING_URL = "https://developers.openai.com/api/docs/pricing.md";
const STANDARD_SECTION = "### Standard pricing data";
const OUTPUT_COLUMNS = ["Short context output", "Output"];
const REFRESH_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

const FALLBACK_OUTPUT_PRICES_PER_MTOK = new Map<string, number>([
  ["gpt-6-astra", 50],
  ["gpt-6.1-sol", 10],
  ["gpt-6-sol", 10],
  ["gpt-6-luna", 0.5],
  ["gpt-5.6-sol", 20],
  ["gpt-5.6-terra", 12],
  ["gpt-5.6-luna", 1.2],
  ["gpt-5.5", 30],
]);

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());
}

function dollars(cell: string): number | undefined {
  const match = /^\$([\d.]+)$/.exec(cell);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

function tableAfter(lines: readonly string[], start: number): string[] {
  const table: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const isRow = line.trim().startsWith("|");
    if (isRow) table.push(line);
    else if (table.length > 0) break;
  }
  return table;
}

export function parseOpenAIPricing(markdown: string): Map<string, number> {
  const prices = new Map<string, number>();
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line.trim() === STANDARD_SECTION);
  if (start === -1) return prices;
  const [header, , ...rows] = tableAfter(lines, start);
  if (header === undefined) return prices;
  const column = cells(header).findIndex((name) => OUTPUT_COLUMNS.includes(name));
  if (column === -1) return prices;
  for (const row of rows) {
    const values = cells(row);
    const model = values[0]?.replace(/\s*\(.*\)\s*$/, "");
    const price = dollars(values[column] ?? "");
    if (model !== undefined && model !== "" && price !== undefined) prices.set(model, price);
  }
  return prices;
}

export class OpenAIPrices {
  private prices = FALLBACK_OUTPUT_PRICES_PER_MTOK;
  private fetchedAt = 0;
  private readonly logger: Logger | undefined;

  constructor(logger?: Logger) {
    this.logger = logger;
  }

  async refreshIfStale(): Promise<void> {
    if (Date.now() - this.fetchedAt < REFRESH_MS) return;
    this.fetchedAt = Date.now();
    try {
      const response = await fetch(PRICING_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!response.ok) throw new Error(`pricing page returned ${response.status}`);
      const parsed = parseOpenAIPricing(await response.text());
      if (parsed.size === 0) throw new Error("no prices found in the standard pricing table");
      this.prices = parsed;
    } catch (err) {
      this.logger?.warn({ err }, "OpenAI pricing refresh failed, using built-in prices");
    }
  }

  output(model: string): number | undefined {
    return this.prices.get(model) ?? FALLBACK_OUTPUT_PRICES_PER_MTOK.get(model);
  }
}
