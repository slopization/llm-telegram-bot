import type Anthropic from "@anthropic-ai/sdk";
import type {
  ContentBlock,
  ContentBlockParam,
  MessageParam,
  ToolUnion,
} from "@anthropic-ai/sdk/resources/messages/messages";
import { formatSources, type Source } from "./sources.ts";
import type { ChatAdapter, ChatEvent, ChatMessage, ChatRequest, ToolCall } from "./types.ts";

const MAX_TOKENS = 32000;
const MAX_PAUSE_CONTINUATIONS = 5;

function toMessages(messages: readonly ChatMessage[]): MessageParam[] {
  const result: MessageParam[] = [];
  for (const message of messages) {
    if (message.role === "tool") {
      const block: ContentBlockParam = {
        type: "tool_result",
        tool_use_id: message.callId,
        content: message.text,
      };
      const last = result.at(-1);
      if (last?.role === "user" && Array.isArray(last.content)) last.content.push(block);
      else result.push({ role: "user", content: [block] });
    } else if (message.role === "assistant") {
      result.push({
        role: "assistant",
        content: (message.native as ContentBlockParam[] | undefined) ?? message.text,
      });
    } else {
      result.push({ role: "user", content: message.text });
    }
  }
  return result;
}

function toTools(request: ChatRequest): ToolUnion[] {
  const tools: ToolUnion[] = request.functions.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters as { type: "object" },
  }));
  if (request.webSearch !== undefined) {
    tools.push({
      type: "web_search_20250305",
      name: "web_search",
      max_uses: request.webSearch.maxUses,
    });
  }
  return tools;
}

function citations(content: readonly ContentBlock[]): Source[] {
  return content.flatMap((block) =>
    block.type === "text"
      ? (block.citations ?? []).flatMap((citation) =>
          citation.type === "web_search_result_location"
            ? [{ url: citation.url, title: citation.title }]
            : [],
        )
      : [],
  );
}

export class AnthropicAdapter implements ChatAdapter {
  readonly kind = "anthropic";
  readonly supportsWebSearch = true;
  private readonly client: Anthropic;

  constructor(client: Anthropic) {
    this.client = client;
  }

  async *stream(request: ChatRequest, signal: AbortSignal): AsyncIterable<ChatEvent> {
    const messages = toMessages(request.messages);
    const tools = toTools(request);
    const content: ContentBlock[] = [];
    const usage = {
      inputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      webSearches: 0,
    };

    for (let continuation = 0; ; continuation++) {
      const turn: MessageParam[] =
        content.length > 0 ? [...messages, { role: "assistant", content }] : messages;
      const stream = this.client.messages.stream(
        {
          model: request.model,
          max_tokens: Math.min(MAX_TOKENS, request.maxOutputTokens ?? MAX_TOKENS),
          messages: turn,
          cache_control: { type: "ephemeral" },
          ...(request.system !== undefined ? { system: request.system } : {}),
          ...(tools.length > 0 ? { tools } : {}),
        },
        { signal },
      );
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield { type: "text", text: event.delta.text };
        }
      }
      const final = await stream.finalMessage();
      content.push(...final.content);
      usage.inputTokens += final.usage.input_tokens;
      usage.cacheWriteTokens += final.usage.cache_creation_input_tokens ?? 0;
      usage.cacheReadTokens += final.usage.cache_read_input_tokens ?? 0;
      usage.outputTokens += final.usage.output_tokens;
      usage.webSearches += final.usage.server_tool_use?.web_search_requests ?? 0;
      if (final.stop_reason !== "pause_turn" || continuation >= MAX_PAUSE_CONTINUATIONS) break;
    }

    const footer = formatSources(citations(content));
    if (footer !== "") yield { type: "text", text: footer };

    const toolCalls: ToolCall[] = content.flatMap((block) =>
      block.type === "tool_use" ? [{ id: block.id, name: block.name, arguments: block.input }] : [],
    );
    yield { type: "done", ...usage, toolCalls, native: content };
  }
}
