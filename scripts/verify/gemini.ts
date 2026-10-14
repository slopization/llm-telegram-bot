import { GoogleGenAI } from "@google/genai";
import { arg, providerOf, show, USER_AGENT } from "./shared.ts";

const mindlogic = providerOf("mindlogic");
const model = arg(0, "gemini-3.5-flash-lite");

const ai = new GoogleGenAI({
  apiKey: mindlogic.apiKey,
  httpOptions: { baseUrl: `${mindlogic.apiUrl}/gemini`, headers: { "User-Agent": USER_AGENT } },
});

const searchRun = await ai.models.generateContent({
  model,
  contents: "Search the web for the current weather in Seoul, Tokyo and Paris.",
  config: { tools: [{ googleSearch: {} }] },
});
const grounding = searchRun.candidates?.[0]?.groundingMetadata;
show(`search queries (${model})`, grounding?.webSearchQueries);
show("grounding chunk count", grounding?.groundingChunks?.length);
show("usage", searchRun.usageMetadata);
