import type { Api } from "grammy";
import type { Message, PhotoSize } from "grammy/types";
import type { Attachment } from "../db/repo.ts";

export const DOWNLOAD_LIMIT = 20 * 1024 * 1024;

const ATTACHABLE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
]);

export interface FileRef {
  fileId: string;
  fileUniqueId: string;
  name: string;
  mime: string;
  size: number | undefined;
}

export class FileTooLargeError extends Error {
  constructor() {
    super("file too large");
    this.name = "FileTooLargeError";
  }
}

export class UnsupportedFileError extends Error {
  readonly fileName: string;

  constructor(fileName: string) {
    super(`unsupported file: ${fileName}`);
    this.fileName = fileName;
    this.name = "UnsupportedFileError";
  }
}

function area(size: PhotoSize): number {
  return size.width * size.height;
}

export function messageFiles(message: Message | undefined): FileRef[] {
  let photo: PhotoSize | undefined;
  for (const size of message?.photo ?? []) {
    if (photo === undefined || area(size) > area(photo)) photo = size;
  }
  if (photo !== undefined) {
    return [
      {
        fileId: photo.file_id,
        fileUniqueId: photo.file_unique_id,
        name: "photo.jpg",
        mime: "image/jpeg",
        size: photo.file_size,
      },
    ];
  }
  const document = message?.document;
  if (document !== undefined) {
    return [
      {
        fileId: document.file_id,
        fileUniqueId: document.file_unique_id,
        name: document.file_name ?? "file",
        mime: document.mime_type ?? "application/octet-stream",
        size: document.file_size,
      },
    ];
  }
  return [];
}

function decodeText(data: Buffer): string | undefined {
  if (data.includes(0)) return undefined;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    return undefined;
  }
}

export function fileContent(ref: FileRef, data: Buffer): Attachment | string {
  if (ATTACHABLE_TYPES.has(ref.mime))
    return { fileUniqueId: ref.fileUniqueId, mime: ref.mime, data };
  const text = decodeText(data);
  if (text === undefined) throw new UnsupportedFileError(ref.name);
  return `<file name="${ref.name}">\n${text}\n</file>`;
}

export async function downloadFile(
  api: Api,
  token: string,
  ref: FileRef,
): Promise<Attachment | string> {
  if (ref.size !== undefined && ref.size > DOWNLOAD_LIMIT) throw new FileTooLargeError();
  const file = await api.getFile(ref.fileId);
  if (file.file_path === undefined) throw new Error("getFile returned no file_path");
  const response = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
  if (!response.ok) throw new Error(`file download failed: ${response.status}`);
  return fileContent(ref, Buffer.from(await response.arrayBuffer()));
}
