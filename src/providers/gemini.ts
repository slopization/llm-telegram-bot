import type { Content, Part as GeminiPart, GoogleGenAI, Tool } from "@google/genai";
import { formatSources, type Source } from "./sources.ts";
import type { ChatAdapter, ChatEvent, ChatMessage, ChatRequest, Part, ToolCall } from "./types.ts";

const SYNTHETIC_ID_PREFIX = "gemini-call-";
const MAX_OUTPUT_TOKENS = 32000;

function toContents(messages: readonly ChatMessage[]): Content[] {
  const result: Content[] = [];
  for (const message of messages) {
    if (message.role === "tool") {
      const part: GeminiPart = {
        functionResponse: {
          name: message.name,
          response: { output: message.text },
          ...(message.callId.startsWith(SYNTHETIC_ID_PREFIX) ? {} : { id: message.callId }),
        },
      };
      const last = result.at(-1);
      if (last?.role === "user" && last.parts?.some((p) => p.functionResponse !== undefined)) {
        last.parts.push(part);
      } else {
        result.push({ role: "user", parts: [part] });
      }
    } else if (message.role === "assistant") {
      const native = message.native as GeminiPart[] | undefined;
      result.push({ role: "model", parts: native ?? [{ text: message.text }] });
    } else {
      result.push({ role: "user", parts: [{ text: message.text }] });
    }
  }
  return result;
}

function toTools(request: ChatRequest): Tool[] {
  const tools: Tool[] = [];
  if (request.webSearch !== undefined) tools.push({ googleSearch: {} });
  if (request.functions.length > 0) {
    tools.push({
      functionDeclarations: request.functions.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parametersJsonSchema: tool.parameters,
      })),
    });
  }
  return tools;
}

function inlinePart(
  mimeType: string,
  base64: string,
  index: number,
): Exclude<Part, { type: "text" }> {
  const data = Buffer.from(base64, "base64");
  if (mimeType.startsWith("image/")) return { type: "image", mime: mimeType, data };
  const extension = mimeType.split("/")[1]?.split(/[;+]/)[0] ?? "bin";
  return { type: "file", name: `file-${index + 1}.${extension}`, mime: mimeType, data };
}

export class GeminiAdapter implements ChatAdapter {
  readonly kind = "gemini";
  readonly supportsWebSearch = true;
  private readonly ai: GoogleGenAI;

  constructor(ai: GoogleGenAI) {
    this.ai = ai;
  }

  async *stream(request: ChatRequest, signal: AbortSignal): AsyncIterable<ChatEvent> {
    const tools = toTools(request);
    const stream = await this.ai.models.generateContentStream({
      model: request.model,
      contents: toContents(request.messages),
      config: {
        abortSignal: signal,
        ...(request.system !== undefined ? { systemInstruction: request.system } : {}),
        ...(tools.length > 0 ? { tools } : {}),
        ...(request.webSearch !== undefined && request.functions.length > 0
          ? { toolConfig: { includeServerSideToolInvocations: true } }
          : {}),
        ...(request.maxOutputTokens !== undefined
          ? { maxOutputTokens: Math.min(MAX_OUTPUT_TOKENS, request.maxOutputTokens) }
          : {}),
      },
    });

    const native: GeminiPart[] = [];
    const toolCalls: ToolCall[] = [];
    const sources: Source[] = [];
    const queries = new Set<string>();
    let inputTokens = 0;
    let cacheReadTokens = 0;
    let outputTokens = 0;
    let inlineCount = 0;

    for await (const chunk of stream) {
      const candidate = chunk.candidates?.[0];
      for (const part of candidate?.content?.parts ?? []) {
        if (part.inlineData?.data !== undefined) {
          yield {
            type: "part",
            part: inlinePart(part.inlineData.mimeType ?? "", part.inlineData.data, inlineCount++),
          };
          continue;
        }
        native.push(part);
        if (part.text !== undefined && part.thought !== true)
          yield { type: "text", text: part.text };
        if (part.functionCall !== undefined) {
          toolCalls.push({
            id: part.functionCall.id ?? `${SYNTHETIC_ID_PREFIX}${toolCalls.length}`,
            name: part.functionCall.name ?? "",
            arguments: part.functionCall.args ?? {},
          });
        }
      }
      for (const query of candidate?.groundingMetadata?.webSearchQueries ?? []) queries.add(query);
      for (const grounding of candidate?.groundingMetadata?.groundingChunks ?? []) {
        if (grounding.web?.uri !== undefined) {
          sources.push({ url: grounding.web.uri, title: grounding.web.title });
        }
      }
      if (chunk.usageMetadata !== undefined) {
        cacheReadTokens = chunk.usageMetadata.cachedContentTokenCount ?? 0;
        inputTokens = (chunk.usageMetadata.promptTokenCount ?? 0) - cacheReadTokens;
        outputTokens =
          (chunk.usageMetadata.candidatesTokenCount ?? 0) +
          (chunk.usageMetadata.thoughtsTokenCount ?? 0);
      }
    }

    const footer = formatSources(sources);
    if (footer !== "") yield { type: "text", text: footer };
    yield {
      type: "done",
      inputTokens,
      cacheReadTokens,
      cacheWriteTokens: 0,
      outputTokens,
      webSearches: queries.size,
      toolCalls,
      native,
    };
  }
}
