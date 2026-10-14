import { arg, providerOf, show, USER_AGENT } from "./shared.ts";

const mindlogic = providerOf("mindlogic");
const model = arg(0, "deepseek-v4.1-flash");

const response = await fetch(`${mindlogic.apiUrl}/chat/completions/`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${mindlogic.apiKey}`,
    "User-Agent": USER_AGENT,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model,
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: 200,
    messages: [{ role: "user", content: "Count from 1 to 5." }],
  }),
});

const lines = (await response.text()).split("\n").filter((line) => line.trim() !== "");
show(`status (${model})`, response.status);
show("content-type", response.headers.get("content-type"));
show("ends with [DONE]", lines.at(-1) === "data: [DONE]");
show("last 3 lines", lines.slice(-3).join("\n"));
