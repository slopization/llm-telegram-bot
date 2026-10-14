import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readTar } from "../../src/sandbox/tar.ts";

let directory: string;

function archive(files: Record<string, string>): Buffer {
  directory = mkdtempSync(join(tmpdir(), "tar-test-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(directory, path, ".."), { recursive: true });
    writeFileSync(join(directory, path), content);
  }
  return execFileSync("tar", ["-cf", "-", "-C", directory, "."]);
}

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe("readTar", () => {
  it("reads regular files and skips directories", () => {
    const files = readTar(archive({ "a.txt": "hello", "sub/b.csv": "1,2" }));

    expect(files.map((file) => [file.path, file.data.toString()]).sort()).toEqual([
      ["a.txt", "hello"],
      ["sub/b.csv", "1,2"],
    ]);
  });

  it("reads long file names", () => {
    const name = `${"x".repeat(150)}.txt`;

    expect(readTar(archive({ [name]: "long" })).map((file) => file.path)).toEqual([name]);
  });

  it("returns nothing for an empty archive", () => {
    expect(readTar(archive({}))).toEqual([]);
  });
});
