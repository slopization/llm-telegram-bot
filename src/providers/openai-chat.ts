import type OpenAI from "openai";
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions/completions";
import type { ChatAdapter, ChatEvent, ChatMessage, ChatRequest, ToolCall } from "./types.ts";

const MAX_TOKENS = 32000;

function toMessages(request: ChatRequest): ChatCompletionMessageParam[] {
  const result: ChatCompletionMessageParam[] = [];
  if (request.system !== undefined) result.push({ role: "system", content: request.system });
  for (const message of request.messages) result.push(toMessage(message));
  return result;
}

function toMessage(message: ChatMessage): ChatCompletionMessageParam {
  switch (message.role) {
    case "tool":
      return { role: "tool", tool_call_id: message.callId, content: message.text };
    case "assistant":
      return (
        (message.native as ChatCompletionAssistantMessageParam | undefined) ?? {
          role: "assistant",
          content: message.text,
        }
      );
    default:
      return { role: "user", content: message.text };
  }
}

function parseArguments(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

interface PendingCall {
  id: string;
  name: string;
  arguments: string;
}

export class OpenAIChatAdapter implements ChatAdapter {
  readonly kind = "openai-chat";
  readonly supportsWebSearch = false;
  private readonly client: OpenAI;
  private readonly onHeaders: ((headers: Headers) => void) | undefined;

  constructor(client: OpenAI, onHeaders?: (headers: Headers) => void) {
    this.client = client;
    this.onHeaders = onHeaders;
  }

  async *stream(request: ChatRequest, signal: AbortSignal): AsyncIterable<ChatEvent> {
    const tools: ChatCompletionTool[] = request.functions.map((tool) => ({
      type: "function",
      function: { name: tool.name, description: tool.description, parameters: tool.parameters },
    }));
    const { data: stream, response } = await this.client.chat.completions
      .create(
        {
          model: request.model,
          messages: toMessages(request),
          stream: true,
          stream_options: { include_usage: true },
          ...(tools.length > 0 ? { tools } : {}),
          ...(request.maxOutputTokens !== undefined
            ? { max_tokens: Math.min(MAX_TOKENS, request.maxOutputTokens) }
            : {}),
        },
        { signal },
      )
      .withResponse();
    this.onHeaders?.(response.headers);

    let text = "";
    const pending: PendingCall[] = [];
    let inputTokens = 0;
    let cacheReadTokens = 0;
    let outputTokens = 0;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (delta?.content) {
        text += delta.content;
        yield { type: "text", text: delta.content };
      }
      for (const call of delta?.tool_calls ?? []) {
        const entry = pending[call.index] ?? { id: "", name: "", arguments: "" };
        pending[call.index] = entry;
        if (call.id) entry.id = call.id;
        if (call.function?.name) entry.name += call.function.name;
        if (call.function?.arguments) entry.arguments += call.function.arguments;
      }
      if (chunk.usage) {
        cacheReadTokens = chunk.usage.prompt_tokens_details?.cached_tokens ?? 0;
        inputTokens = chunk.usage.prompt_tokens - cacheReadTokens;
        outputTokens = chunk.usage.completion_tokens;
      }
    }

    const calls = pending.filter((call) => call !== undefined);
    const toolCalls: ToolCall[] = calls.map((call) => ({
      id: call.id,
      name: call.name,
      arguments: parseArguments(call.arguments),
    }));
    const native: ChatCompletionAssistantMessageParam = {
      role: "assistant",
      content: text === "" ? null : text,
      ...(calls.length > 0
        ? {
            tool_calls: calls.map((call) => ({
              id: call.id,
              type: "function" as const,
              function: { name: call.name, arguments: call.arguments },
            })),
          }
        : {}),
    };
    yield {
      type: "done",
      inputTokens,
      cacheReadTokens,
      cacheWriteTokens: 0,
      outputTokens,
      webSearches: 0,
      toolCalls,
      native,
    };
  }
}
