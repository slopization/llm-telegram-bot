import { strings } from "../strings.ts";

export interface Source {
  url: string;
  title?: string | null | undefined;
}

const MAX_SOURCES = 10;

export function uniqueSources(sources: readonly Source[]): Source[] {
  const unique = new Map<string, Source>();
  for (const source of sources) {
    if (!unique.has(source.url)) unique.set(source.url, source);
  }
  return [...unique.values()].slice(0, MAX_SOURCES);
}

export function formatSources(sources: readonly Source[]): string {
  const unique = uniqueSources(sources);
  if (unique.length === 0) return "";
  const lines = unique.map(
    (source) => `- [${(source.title || source.url).replace(/[[\]]/g, "")}](${source.url})`,
  );
  return `\n\n**${strings.sources}**\n${lines.join("\n")}`;
}
