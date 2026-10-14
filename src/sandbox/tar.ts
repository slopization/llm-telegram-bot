const BLOCK = 512;

export interface TarFile {
  path: string;
  data: Buffer;
}

function field(header: Buffer, start: number, length: number): string {
  const raw = header.subarray(start, start + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end === -1 ? length : end).toString("utf8");
}

function normalize(path: string): string {
  return path.replace(/^(\.\/)+/, "").replace(/^\/+/, "");
}

export function readTar(archive: Buffer): TarFile[] {
  const files: TarFile[] = [];
  let offset = 0;
  let longName: string | undefined;
  while (offset + BLOCK <= archive.length) {
    const header = archive.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) break;
    const size = Number.parseInt(field(header, 124, 12).trim() || "0", 8);
    const type = String.fromCharCode(header[156] ?? 0);
    const dataStart = offset + BLOCK;
    const data = archive.subarray(dataStart, dataStart + size);
    offset = dataStart + Math.ceil(size / BLOCK) * BLOCK;

    if (type === "L") {
      longName = data.toString("utf8").replace(/\0+$/, "");
      continue;
    }
    const prefix = field(header, 345, 155);
    const name =
      longName ?? (prefix ? `${prefix}/${field(header, 0, 100)}` : field(header, 0, 100));
    longName = undefined;
    if (type === "0" || type === "\0") {
      const path = normalize(name);
      if (path !== "") files.push({ path, data: Buffer.from(data) });
    }
  }
  return files;
}
