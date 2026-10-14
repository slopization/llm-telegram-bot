export type AdapterKind = "anthropic" | "gemini" | "openai-responses" | "openai-chat";

export type Part =
  | { type: "text"; text: string }
  | { type: "image"; mime: string; data: Buffer }
  | { type: "file"; name: string; mime: string; data: Buffer };

export interface FunctionTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export type ChatMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; native?: unknown; toolCalls?: ToolCall[] }
  | { role: "tool"; callId: string; name: string; text: string };

export interface ChatRequest {
  model: string;
  system?: string;
  messages: ChatMessage[];
  webSearch?: { maxUses: number };
  functions: FunctionTool[];
  maxOutputTokens?: number;
}

export interface TokenUsage {
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  webSearches: number;
}

export interface ChatResult extends TokenUsage {
  toolCalls: ToolCall[];
  native: unknown;
}

export type ChatEvent =
  | { type: "text"; text: string }
  | { type: "part"; part: Exclude<Part, { type: "text" }> }
  | ({ type: "done" } & ChatResult);

export interface ModelInfo {
  id: string;
  vendor: string;
  outputPricePerMTok: number | undefined;
  webSearch: boolean;
  maxOutputTokens: number | undefined;
  legacy: boolean;
}

export interface ChatAdapter {
  readonly kind: AdapterKind;
  readonly supportsWebSearch: boolean;
  stream(request: ChatRequest, signal: AbortSignal): AsyncIterable<ChatEvent>;
}

export interface CreditBalance {
  remaining: number;
  quota: number;
  renewsAt: string | undefined;
}

export interface QuotaWindow {
  usedPercent: number;
  windowMinutes: number;
  resetsAt: number | undefined;
}

export interface QuotaSnapshot {
  windows: QuotaWindow[];
  observedAt: number;
}

export interface Provider {
  readonly name: string;
  listModels(): Promise<ModelInfo[]>;
  adapterFor(model: string): ChatAdapter;
  costOf?(model: string, usage: TokenUsage): number | undefined;
  balance?(): Promise<CreditBalance>;
  quota?(): Promise<QuotaSnapshot | undefined>;
}
