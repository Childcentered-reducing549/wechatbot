import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

import type { MessageItem } from "./types.js";
import { MessageItemType } from "./types.js";
import { downloadAndDecrypt, downloadPlain } from "./cdn.js";

const MEDIA_TMP_DIR = "/tmp/wechatbot/media";

export type MediaResult = {
  /** Local path to the downloaded/decrypted file. */
  path?: string;
  /** MIME type of the media. */
  mimeType?: string;
  /** Text content from voice STT. */
  voiceText?: string;
};

function tempPath(ext: string): string {
  const name = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`;
  return path.join(MEDIA_TMP_DIR, name);
}

async function saveBuffer(buf: Buffer, ext: string): Promise<string> {
  await fs.mkdir(MEDIA_TMP_DIR, { recursive: true });
  const p = tempPath(ext);
  await fs.writeFile(p, buf);
  return p;
}

/** SILK -> PCM -> WAV, returns null if silk-wasm unavailable. */
async function silkToWav(silkBuf: Buffer): Promise<Buffer | null> {
  try {
    const { decode } = await import("silk-wasm");
    const result = await decode(silkBuf, 24_000);
    const pcm = result.data;
    const pcmBytes = pcm.byteLength;
    const totalSize = 44 + pcmBytes;
    const buf = Buffer.allocUnsafe(totalSize);
    let o = 0;
    buf.write("RIFF", o); o += 4;
    buf.writeUInt32LE(totalSize - 8, o); o += 4;
    buf.write("WAVE", o); o += 4;
    buf.write("fmt ", o); o += 4;
    buf.writeUInt32LE(16, o); o += 4;
    buf.writeUInt16LE(1, o); o += 2;
    buf.writeUInt16LE(1, o); o += 2;
    buf.writeUInt32LE(24_000, o); o += 4;
    buf.writeUInt32LE(48_000, o); o += 4;
    buf.writeUInt16LE(2, o); o += 2;
    buf.writeUInt16LE(16, o); o += 2;
    buf.write("data", o); o += 4;
    buf.writeUInt32LE(pcmBytes, o); o += 4;
    Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).copy(buf, o);
    return buf;
  } catch {
    return null;
  }
}

/**
 * Download media from a message's item_list.
 * Priority: IMAGE > VOICE (with STT shortcut).
 */
export async function downloadMedia(
  itemList: MessageItem[] | undefined,
  cdnBaseUrl: string,
): Promise<MediaResult> {
  if (!itemList?.length) return {};

  // Try image first
  const imageItem = itemList.find(
    (i) => i.type === MessageItemType.IMAGE && i.image_item?.media?.encrypt_query_param,
  );
  if (imageItem?.image_item) {
    const img = imageItem.image_item;
    const aesKeyBase64 = img.aeskey
      ? Buffer.from(img.aeskey, "hex").toString("base64")
      : img.media?.aes_key;
    try {
      const buf = aesKeyBase64
        ? await downloadAndDecrypt(img.media!.encrypt_query_param!, aesKeyBase64, cdnBaseUrl)
        : await downloadPlain(img.media!.encrypt_query_param!, cdnBaseUrl);
      const filePath = await saveBuffer(buf, ".jpg");
      return { path: filePath, mimeType: "image/jpeg" };
    } catch (err) {
      console.error("[wechat] Image download failed:", err);
    }
  }

  // Try voice — prefer WeChat STT text, fall back to SILK decode
  const voiceItem = itemList.find(
    (i) => i.type === MessageItemType.VOICE && i.voice_item,
  );
  if (voiceItem?.voice_item) {
    const voice = voiceItem.voice_item;
    // WeChat built-in STT
    if (voice.text) {
      return { voiceText: voice.text };
    }
    // Decode SILK
    if (voice.media?.encrypt_query_param && voice.media.aes_key) {
      try {
        const silkBuf = await downloadAndDecrypt(
          voice.media.encrypt_query_param,
          voice.media.aes_key,
          cdnBaseUrl,
        );
        const wavBuf = await silkToWav(silkBuf);
        if (wavBuf) {
          const filePath = await saveBuffer(wavBuf, ".wav");
          return { path: filePath, mimeType: "audio/wav" };
        }
        const filePath = await saveBuffer(silkBuf, ".silk");
        return { path: filePath, mimeType: "audio/silk" };
      } catch (err) {
        console.error("[wechat] Voice download failed:", err);
      }
    }
  }

  return {};
}
