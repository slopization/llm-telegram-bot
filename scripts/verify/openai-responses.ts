import OpenAI from "openai";
import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import { arg, providerOf, show } from "./shared.ts";

const mindlogic = providerOf("mindlogic");
const model = arg(0, "gpt-5.6-luna");
const client = new OpenAI({ apiKey: mindlogic.apiKey, baseURL: mindlogic.apiUrl });

const cappedSearch = await client.responses.create({
  model,
  input: "Search the web separately for the current weather in Seoul, Tokyo and Paris.",
  tools: [{ type: "web_search" }],
  max_tool_calls: 1,
} as ResponseCreateParamsNonStreaming & { max_tool_calls: number });
show(
  `web_search_call count with max_tool_calls = 1 (${model})`,
  cappedSearch.output.filter((item) => item.type === "web_search_call").length,
);
