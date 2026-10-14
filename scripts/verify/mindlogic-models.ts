import { providerOf, show, USER_AGENT } from "./shared.ts";

const mindlogic = providerOf("mindlogic");
const mindlogicHeaders = { Authorization: `Bearer ${mindlogic.apiKey}`, "User-Agent": USER_AGENT };

const listResponse = await fetch(`${mindlogic.apiUrl}/models/?type=llm`, {
  headers: mindlogicHeaders,
});
const list = (await listResponse.json()) as Record<string, unknown>;
show("mindlogic /models/ status", listResponse.status);
show("mindlogic /models/ top-level fields", Object.keys(list));

const models = Array.isArray(list.data) ? (list.data as Record<string, unknown>[]) : [];
const vendors = Object.groupBy(models, (model) => String(model.owned_by));
show(
  "mindlogic owned_by values",
  Object.fromEntries(Object.entries(vendors).map(([vendor, items]) => [vendor, items?.length])),
);
show("mindlogic first model in list", models[0] ?? list);

const firstId = models[0]?.id;
if (typeof firstId === "string") {
  const detailResponse = await fetch(`${mindlogic.apiUrl}/models/${firstId}/`, {
    headers: mindlogicHeaders,
  });
  show(`mindlogic /models/${firstId}/`, await detailResponse.json());
}

const creditsResponse = await fetch(`${mindlogic.apiUrl}/credits/`, { headers: mindlogicHeaders });
show(`mindlogic /credits/ (${creditsResponse.status})`, await creditsResponse.json());
