import type { Config } from "../config.ts";
import type {
  ChatAdapter,
  ChatMessage,
  ChatResult,
  Part,
  TokenUsage,
  ToolCall,
} from "../providers/types.ts";
import { type AnswerSegment, appendText } from "../render/answer.ts";
import { runOutputText } from "../render/run.ts";
import type { Sandbox } from "../sandbox/run.ts";
import { parseRunCall, RUN_CODE, runCodeTool, toolResultText } from "../sandbox/tool.ts";
import { parseFetchCall, WEB_FETCH, webFetchTool } from "../web/tool.ts";
import { systemPrompt } from "./system.ts";

export type Media = Exclude<Part, { type: "text" }>;

export interface SandboxAccess {
  runner: Sandbox;
  limits: Config["sandbox"];
  runsAllowed: number;
}

export interface WebFetchAccess {
  fetch: (url: string, signal: AbortSignal) => Promise<string>;
  fetchesAllowed: number;
}

export interface AnswerRequest {
  adapter: ChatAdapter;
  model: string;
  maxOutputTokens?: number | undefined;
  messages: ChatMessage[];
  today: string;
  timeZone: string;
  webSearch: { maxUses: number } | undefined;
  sandbox: SandboxAccess | undefined;
  webFetch: WebFetchAccess | undefined;
  signal: AbortSignal;
  onUpdate: (segments: readonly AnswerSegment[]) => void;
  costOf?: ((usage: TokenUsage) => number | undefined) | undefined;
}

export interface AnswerResult extends TokenUsage {
  segments: AnswerSegment[];
  media: Media[];
  transcript: ChatMessage[];
  sandboxRuns: number;
  webFetches: number;
  costUsd: number | undefined;
}

const LIMIT_REACHED =
  "The code execution limit for this request has been reached. Answer without running more code.";
const INVALID_CALL =
  "Invalid tool call. Use run_code with language (python, javascript or bash) and code.";
const FETCH_LIMIT_REACHED =
  "The web page fetch limit for this request has been reached. Answer without fetching more pages.";
const INVALID_FETCH = "Invalid tool call. Use web_fetch with an absolute http or https url.";

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

export function fileMedia(name: string, data: Buffer): Media {
  const image = IMAGE_TYPES[name.split(".").at(-1)?.toLowerCase() ?? ""];
  return image !== undefined
    ? { type: "image", mime: image, data }
    : { type: "file", name, mime: "application/octet-stream", data };
}

export async function generateAnswer(request: AnswerRequest): Promise<AnswerResult> {
  const result: AnswerResult = {
    segments: [],
    media: [],
    transcript: [],
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    webSearches: 0,
    sandboxRuns: 0,
    webFetches: 0,
    costUsd: undefined,
  };
  const sandbox =
    request.sandbox !== undefined && request.sandbox.runsAllowed > 0 ? request.sandbox : undefined;
  const webFetch =
    request.webFetch !== undefined && request.webFetch.fetchesAllowed > 0
      ? request.webFetch
      : undefined;
  const functions = [
    ...(sandbox !== undefined ? [runCodeTool(sandbox.limits)] : []),
    ...(webFetch !== undefined ? [webFetchTool()] : []),
  ];
  const maxRounds = (sandbox?.runsAllowed ?? 0) + (webFetch?.fetchesAllowed ?? 0) + 2;
  const system = systemPrompt(request.today, request.timeZone, [
    ...(request.webSearch !== undefined ? ["web search"] : []),
    ...functions.map((tool) => tool.name),
  ]);

  for (let round = 0; round < maxRounds; round++) {
    const { text, done } = await streamRound(request, result, system, functions);
    result.inputTokens += done.inputTokens;
    result.cacheReadTokens += done.cacheReadTokens;
    result.cacheWriteTokens += done.cacheWriteTokens;
    result.outputTokens += done.outputTokens;
    result.webSearches += done.webSearches;
    const cost = request.costOf?.(done);
    if (cost !== undefined) result.costUsd = (result.costUsd ?? 0) + cost;
    result.transcript.push({
      role: "assistant",
      text,
      native: done.native,
      toolCalls: done.toolCalls,
    });
    if (done.toolCalls.length === 0 || functions.length === 0) break;
    for (const call of done.toolCalls) {
      const output =
        call.name === WEB_FETCH && webFetch !== undefined
          ? await fetchCall(call, webFetch, result, request.signal)
          : call.name === RUN_CODE && sandbox !== undefined
            ? await runToolCall(call, sandbox, result, request.onUpdate)
            : `Unknown tool: ${call.name}`;
      result.transcript.push({ role: "tool", callId: call.id, name: call.name, text: output });
    }
  }
  return result;
}

async function streamRound(
  request: AnswerRequest,
  result: AnswerResult,
  system: string,
  functions: ReturnType<typeof runCodeTool>[],
): Promise<{ text: string; done: ChatResult }> {
  let text = "";
  let done: ChatResult | undefined;
  const stream = request.adapter.stream(
    {
      model: request.model,
      system,
      messages: [...request.messages, ...result.transcript],
      functions,
      ...(request.webSearch !== undefined ? { webSearch: request.webSearch } : {}),
      ...(request.maxOutputTokens !== undefined
        ? { maxOutputTokens: request.maxOutputTokens }
        : {}),
    },
    request.signal,
  );
  for await (const event of stream) {
    if (event.type === "text") {
      text += event.text;
      appendText(result.segments, event.text);
      request.onUpdate(result.segments);
    } else if (event.type === "part") {
      result.media.push(event.part);
    } else {
      done = event;
    }
  }
  if (done === undefined) throw new Error("adapter stream ended without a result");
  return { text, done };
}

async function runToolCall(
  call: ToolCall,
  sandbox: SandboxAccess,
  result: AnswerResult,
  onUpdate: AnswerRequest["onUpdate"],
): Promise<string> {
  const parsed = parseRunCall(call);
  if (parsed === undefined) return INVALID_CALL;
  if (result.sandboxRuns >= sandbox.runsAllowed) return LIMIT_REACHED;
  result.sandboxRuns++;
  const run = await sandbox.runner.run(parsed.language, parsed.code);
  for (const file of run.files) result.media.push(fileMedia(file.name, file.data));
  result.segments.push({
    kind: "run",
    language: parsed.language,
    code: parsed.code,
    output: runOutputText(run, sandbox.limits.timeoutSeconds),
  });
  onUpdate(result.segments);
  return toolResultText(run, sandbox.limits.outputChars);
}

async function fetchCall(
  call: ToolCall,
  webFetch: WebFetchAccess,
  result: AnswerResult,
  signal: AbortSignal,
): Promise<string> {
  const url = parseFetchCall(call);
  if (url === undefined) return INVALID_FETCH;
  if (result.webFetches >= webFetch.fetchesAllowed) return FETCH_LIMIT_REACHED;
  result.webFetches++;
  return webFetch.fetch(url, signal);
}
