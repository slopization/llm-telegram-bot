import type { Api } from "grammy";
import type { Message, PhotoSize } from "grammy/types";
import type { Attachment } from "../db/repo.ts";

export const DOWNLOAD_LIMIT = 20 * 1024 * 1024;

const DOCUMENT_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

export interface ImageRef {
  fileId: string;
  fileUniqueId: string;
  mime: string;
  size: number | undefined;
}

export class FileTooLargeError extends Error {
  constructor() {
    super("file too large");
    this.name = "FileTooLargeError";
  }
}

function area(size: PhotoSize): number {
  return size.width * size.height;
}

export function messageImages(message: Message | undefined): ImageRef[] {
  let photo: PhotoSize | undefined;
  for (const size of message?.photo ?? []) {
    if (photo === undefined || area(size) > area(photo)) photo = size;
  }
  if (photo !== undefined) {
    return [
      {
        fileId: photo.file_id,
        fileUniqueId: photo.file_unique_id,
        mime: "image/jpeg",
        size: photo.file_size,
      },
    ];
  }
  const document = message?.document;
  if (document?.mime_type !== undefined && DOCUMENT_IMAGE_TYPES.has(document.mime_type)) {
    return [
      {
        fileId: document.file_id,
        fileUniqueId: document.file_unique_id,
        mime: document.mime_type,
        size: document.file_size,
      },
    ];
  }
  return [];
}

export async function downloadImage(api: Api, token: string, image: ImageRef): Promise<Attachment> {
  if (image.size !== undefined && image.size > DOWNLOAD_LIMIT) throw new FileTooLargeError();
  const file = await api.getFile(image.fileId);
  if (file.file_path === undefined) throw new Error("getFile returned no file_path");
  const response = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
  if (!response.ok) throw new Error(`file download failed: ${response.status}`);
  return {
    fileUniqueId: image.fileUniqueId,
    mime: image.mime,
    data: Buffer.from(await response.arrayBuffer()),
  };
}
