const FENCE = /```[^\n`]*\n([\s\S]*?)(?:```|$)/;

export function extractCode(text: string): string {
  const fenced = FENCE.exec(text);
  return (fenced?.[1] ?? text).trim();
}
