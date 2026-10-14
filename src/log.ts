import { pino } from "pino";

export const log = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "*.apiKey",
      "*.headers.authorization",
      "*.headers.Authorization",
      '*.headers["x-api-key"]',
      '*.headers["x-goog-api-key"]',
      "err.headers.authorization",
      'err.headers["x-api-key"]',
    ],
    censor: "[redacted]",
  },
});

export type Logger = typeof log;
