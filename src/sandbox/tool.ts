import type { Config } from "../config.ts";
import type { FunctionTool, ToolCall } from "../providers/types.ts";
import { truncate } from "../render/run.ts";
import { LANGUAGES, type Language, type RunResult } from "./run.ts";

export const RUN_CODE = "run_code";

const PYTHON_PACKAGES =
  "numpy, scipy, sympy, statsmodels, pandas, openpyxl, tabulate, matplotlib, seaborn, scikit-learn, networkx, pillow, beautifulsoup4, lxml, pyyaml, python-dateutil";
const NODE_PACKAGES = "mathjs, decimal.js, papaparse, exceljs, cheerio, yaml, date-fns, lodash";

export function runCodeTool(limits: Config["sandbox"]): FunctionTool {
  return {
    name: RUN_CODE,
    description: [
      "Run Python, JavaScript or Bash code in an isolated Linux (Debian) sandbox and get stdout, stderr and the exit code.",
      `Limits: no network access, ${limits.timeoutSeconds} seconds, ${limits.memoryMb} MB memory, ${limits.diskMb} MB disk.`,
      "Files written to /output are sent to the user (images as photos). Each call starts a fresh sandbox; nothing persists between calls.",
      `Python 3.14 packages: ${PYTHON_PACKAGES}. Matplotlib uses a Korean font (NanumGothic) by default; with seaborn call sns.set_theme(font="NanumGothic").`,
      `JavaScript runs as an ES module in Node.js 24 (top-level await allowed) with packages: ${NODE_PACKAGES}.`,
      "Bash runs as a script with standard Debian command-line tools; python and node are on PATH.",
    ].join("\n"),
    parameters: {
      type: "object",
      properties: {
        language: { type: "string", enum: [...LANGUAGES] },
        code: { type: "string", description: "Complete source code to run." },
      },
      required: ["language", "code"],
    },
  };
}

export function parseRunCall(call: ToolCall): { language: Language; code: string } | undefined {
  if (call.name !== RUN_CODE || typeof call.arguments !== "object" || call.arguments === null) {
    return undefined;
  }
  const { language, code } = call.arguments as Record<string, unknown>;
  const known = LANGUAGES.find((candidate) => candidate === language);
  if (known === undefined || typeof code !== "string") return undefined;
  return { language: known, code };
}

export function toolResultText(result: RunResult, outputChars: number): string {
  const lines = [
    result.timedOut ? "status: timed out" : `exit_code: ${result.exitCode}`,
    ...(result.outOfMemory ? ["status: killed (out of memory)"] : []),
    `duration_seconds: ${(result.durationMs / 1000).toFixed(2)}`,
    `stdout:\n${truncate(result.stdout, outputChars)}`,
    `stderr:\n${truncate(result.stderr, outputChars)}`,
  ];
  if (result.files.length > 0) {
    lines.push(
      `files sent to the user: ${result.files.map((file) => `${file.name} (${file.data.length} bytes)`).join(", ")}`,
    );
  }
  return lines.join("\n");
}
