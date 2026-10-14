import type OpenAI from "openai";
import type {
  Response,
  ResponseCreateParamsStreaming,
  ResponseInputItem,
  Tool,
} from "openai/resources/responses/responses";
import { formatSources, type Source } from "./sources.ts";
import type { ChatAdapter, ChatEvent, ChatMessage, ChatRequest, ToolCall } from "./types.ts";

const MAX_OUTPUT_TOKENS = 16000;

function toInput(messages: readonly ChatMessage[]): ResponseInputItem[] {
  return messages.flatMap((message): ResponseInputItem[] => {
    switch (message.role) {
      case "tool":
        return [{ type: "function_call_output", call_id: message.callId, output: message.text }];
      case "assistant":
        return [
          ...(message.text !== "" ? [{ role: "assistant" as const, content: message.text }] : []),
          ...(message.toolCalls ?? []).map((call) => ({
            type: "function_call" as const,
            call_id: call.id,
            name: call.name,
            arguments:
              typeof call.arguments === "string" ? call.arguments : JSON.stringify(call.arguments),
          })),
        ];
      default:
        return [{ role: "user", content: message.text }];
    }
  });
}

function parseArguments(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function urlCitations(response: Response): Source[] {
  return response.output.flatMap((item) =>
    item.type === "message"
      ? item.content.flatMap((content) =>
          content.type === "output_text"
            ? content.annotations.flatMap((annotation) =>
                annotation.type === "url_citation"
                  ? [{ url: annotation.url, title: annotation.title }]
                  : [],
              )
            : [],
        )
      : [],
  );
}

export class OpenAIResponsesAdapter implements ChatAdapter {
  readonly kind = "openai-responses";
  readonly supportsWebSearch = true;
  private readonly client: OpenAI;

  constructor(client: OpenAI) {
    this.client = client;
  }

  async *stream(request: ChatRequest, signal: AbortSignal): AsyncIterable<ChatEvent> {
    const tools: Tool[] = request.functions.map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      strict: false,
    }));
    if (request.webSearch !== undefined) tools.push({ type: "web_search" });
    const params: ResponseCreateParamsStreaming & { max_tool_calls?: number } = {
      model: request.model,
      input: toInput(request.messages),
      max_output_tokens: Math.min(MAX_OUTPUT_TOKENS, request.maxOutputTokens ?? MAX_OUTPUT_TOKENS),
      stream: true,
      ...(request.system !== undefined ? { instructions: request.system } : {}),
      ...(tools.length > 0 ? { tools } : {}),
      ...(request.webSearch !== undefined ? { max_tool_calls: request.webSearch.maxUses } : {}),
    };
    const stream = await this.client.responses.create(params, { signal });

    let final: Response | undefined;
    for await (const event of stream) {
      if (event.type === "response.output_text.delta") yield { type: "text", text: event.delta };
      else if (event.type === "response.completed" || event.type === "response.incomplete") {
        final = event.response;
      } else if (event.type === "response.failed") {
        throw new Error(event.response.error?.message ?? "response failed");
      }
    }
    if (final === undefined) throw new Error("stream ended without a final response");

    const footer = formatSources(urlCitations(final));
    if (footer !== "") yield { type: "text", text: footer };

    const toolCalls: ToolCall[] = final.output.flatMap((item) =>
      item.type === "function_call"
        ? [{ id: item.call_id, name: item.name, arguments: parseArguments(item.arguments) }]
        : [],
    );
    const cacheReadTokens = final.usage?.input_tokens_details.cached_tokens ?? 0;
    yield {
      type: "done",
      inputTokens: (final.usage?.input_tokens ?? 0) - cacheReadTokens,
      cacheReadTokens,
      cacheWriteTokens: 0,
      outputTokens: final.usage?.output_tokens ?? 0,
      webSearches: final.output.filter(
        (item) => item.type === "web_search_call" && item.status === "completed",
      ).length,
      toolCalls,
      native: null,
    };
  }
}
