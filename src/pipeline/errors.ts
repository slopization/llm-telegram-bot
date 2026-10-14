export type ErrorKind =
  | "credit"
  | "rateLimit"
  | "overloaded"
  | "timeout"
  | "api"
  | "empty"
  | "internal";

export class EmptyAnswerError extends Error {
  constructor() {
    super("empty answer");
    this.name = "EmptyAnswerError";
  }
}

const CREDIT_MESSAGES = [
  /credit balance is too low/i,
  /specified (?:workspace )?API usage limits/i,
  /credit balance exhausted/i,
];

function statusOf(error: object): number | undefined {
  const status = (error as { status?: unknown; code?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

function errorCodeOf(error: object): string | undefined {
  const body = (error as { error?: { error?: { details?: { error_code?: unknown } } } }).error;
  const code = body?.error?.details?.error_code;
  return typeof code === "string" ? code : undefined;
}

export function classifyError(error: unknown, timedOut: boolean): ErrorKind {
  if (error instanceof EmptyAnswerError) return "empty";
  if (timedOut) return "timeout";
  if (typeof error !== "object" || error === null) return "internal";
  const status = statusOf(error);
  const message = error instanceof Error ? error.message : "";
  if (status === 402 || CREDIT_MESSAGES.some((pattern) => pattern.test(message))) return "credit";
  if (status === 429) {
    return errorCodeOf(error) === "enforced_spend_limit_reached" ? "credit" : "rateLimit";
  }
  if (status === 503 || status === 529 || /overloaded/i.test(message)) return "overloaded";
  if (status !== undefined) return "api";
  if (error instanceof Error && error.name === "APIConnectionError") return "api";
  return "internal";
}
