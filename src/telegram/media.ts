import { type Api, InputFile } from "grammy";
import type { InputMediaDocument, InputMediaPhoto } from "grammy/types";
import type { Logger } from "../log.ts";
import type { Media } from "../pipeline/answer.ts";
import { plain } from "../render/formatted.ts";
import { strings } from "../strings.ts";
import { type Destination, replyOption, sendFormatted, threadOption } from "./send.ts";

const PHOTO_LIMIT = 10 * 1024 * 1024;
const DOCUMENT_LIMIT = 50 * 1024 * 1024;
const GROUP_LIMIT = 10;

interface NamedFile {
  name: string;
  data: Buffer;
}

function named(media: readonly Media[]): { images: NamedFile[]; files: NamedFile[] } {
  const images: NamedFile[] = [];
  const files: NamedFile[] = [];
  for (const item of media) {
    if (item.type === "image") {
      const extension = item.mime.split("/")[1]?.replace("jpeg", "jpg") ?? "png";
      images.push({ name: `image-${images.length + 1}.${extension}`, data: item.data });
    } else {
      files.push({ name: item.name, data: item.data });
    }
  }
  return { images, files };
}

function chunked<T>(items: readonly T[]): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += GROUP_LIMIT) {
    result.push(items.slice(index, index + GROUP_LIMIT));
  }
  return result;
}

export class MediaSender {
  private readonly api: Api;
  private readonly logger: Logger;

  constructor(api: Api, logger: Logger) {
    this.api = api;
    this.logger = logger;
  }

  async send(
    destination: Destination,
    replyTo: number,
    media: readonly Media[],
  ): Promise<number[]> {
    const { images, files } = named(media);
    const ids: number[] = [];
    const sendable = (file: NamedFile) => file.data.length <= DOCUMENT_LIMIT;
    await this.attempt(ids, () =>
      this.sendPhotos(
        destination,
        replyTo,
        images.filter((i) => i.data.length <= PHOTO_LIMIT),
      ),
    );
    await this.attempt(ids, () =>
      this.sendDocuments(destination, replyTo, [...images, ...files].filter(sendable)),
    );
    for (const file of [...images, ...files].filter((file) => !sendable(file))) {
      await this.attempt(ids, async () => [
        await sendFormatted(
          this.api,
          destination,
          plain(strings.runFileTooLarge(file.name)),
          replyTo,
        ),
      ]);
    }
    return ids;
  }

  private async attempt(ids: number[], send: () => Promise<number[]>): Promise<void> {
    try {
      ids.push(...(await send()));
    } catch (err) {
      this.logger.warn({ err }, "media send failed");
    }
  }

  private async sendPhotos(
    destination: Destination,
    replyTo: number,
    photos: NamedFile[],
  ): Promise<number[]> {
    const options = { ...threadOption(destination), ...replyOption(replyTo) };
    if (photos.length === 1 && photos[0] !== undefined) {
      const photo = photos[0];
      return [
        (
          await this.api.sendPhoto(
            destination.chatId,
            new InputFile(photo.data, photo.name),
            options,
          )
        ).message_id,
      ];
    }
    const ids: number[] = [];
    for (const group of chunked(photos)) {
      const items: InputMediaPhoto[] = group.map((photo) => ({
        type: "photo",
        media: new InputFile(photo.data, photo.name),
      }));
      ids.push(
        ...(await this.api.sendMediaGroup(destination.chatId, items, options)).map(
          (m) => m.message_id,
        ),
      );
    }
    return ids;
  }

  private async sendDocuments(
    destination: Destination,
    replyTo: number,
    documents: NamedFile[],
  ): Promise<number[]> {
    const options = { ...threadOption(destination), ...replyOption(replyTo) };
    if (documents.length === 1 && documents[0] !== undefined) {
      const document = documents[0];
      return [
        (
          await this.api.sendDocument(
            destination.chatId,
            new InputFile(document.data, document.name),
            options,
          )
        ).message_id,
      ];
    }
    const ids: number[] = [];
    for (const group of chunked(documents)) {
      const items: InputMediaDocument[] = group.map((document) => ({
        type: "document",
        media: new InputFile(document.data, document.name),
      }));
      ids.push(
        ...(await this.api.sendMediaGroup(destination.chatId, items, options)).map(
          (m) => m.message_id,
        ),
      );
    }
    return ids;
  }
}
