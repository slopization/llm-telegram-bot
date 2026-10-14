import { parse } from "acorn";

const RESULT = "__llmBotResult";

export function echoLastJavaScriptValue(code: string): string {
  let program: ReturnType<typeof parse>;
  try {
    program = parse(code, {
      ecmaVersion: "latest",
      sourceType: "module",
      allowAwaitOutsideFunction: true,
    });
  } catch {
    return code;
  }
  const last = program.body.at(-1);
  if (last?.type !== "ExpressionStatement" || "directive" in last) return code;
  const expression = code.slice(last.expression.start, last.expression.end);
  return [
    code.slice(0, last.start),
    `let ${RESULT} = (${expression});\n`,
    `if (${RESULT} instanceof Promise) ${RESULT} = await ${RESULT};\n`,
    `if (${RESULT} !== undefined) console.log((await import("node:util")).inspect(${RESULT}, { depth: 4 }));`,
    code.slice(last.end),
  ].join("");
}

export const PYTHON_ECHO_RUNNER = `
import ast, sys, traceback

def run(source):
    tree = ast.parse(source, "<code>", "exec")
    last = tree.body.pop() if tree.body and isinstance(tree.body[-1], ast.Expr) else None
    scope = {"__name__": "__main__"}
    exec(compile(tree, "<code>", "exec"), scope)
    if last is not None:
        value = eval(compile(ast.Expression(last.value), "<code>", "eval"), scope)
        if value is not None:
            print(repr(value))

try:
    run(sys.stdin.read())
except SystemExit:
    raise
except BaseException as error:
    frames = [frame for frame in traceback.extract_tb(error.__traceback__) if frame.filename != "<string>"]
    if frames and not isinstance(error, SyntaxError):
        print("Traceback (most recent call last):", file=sys.stderr)
        print("".join(traceback.format_list(frames)), end="", file=sys.stderr)
    print("".join(traceback.format_exception_only(error)), end="", file=sys.stderr)
    sys.exit(1)
`;
