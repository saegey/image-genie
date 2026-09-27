import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import { Readable } from "node:stream";
import { AssetMediaStatus, AssetRejectReason, checkBulkUpload, getAssetInfo, isHttpError } from "@immich/sdk";
import { getAppleStatus, releaseAppleAsset, stageAppleAsset, type StagedFile } from "./apple-photos";
import { getImportConnection, ImmichError, explainImmichError } from "./immich";

export type ImportResult = { id: string; immichId: string; status: "imported" | "already-in-immich"; filename: string };

function safeFilename(name: string) {
  return name.replace(/[\r\n"\\]/g, "_").slice(0, 240) || "original";
}

function mediaType(name: string) {
  const extension = name.split(".").pop()?.toLowerCase();
  return ({ heic: "image/heic", heif: "image/heif", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", dng: "image/x-adobe-dng", mov: "video/quicktime", mp4: "video/mp4", m4v: "video/x-m4v" } as Record<string, string>)[extension || ""] || "application/octet-stream";
}

async function checkedFile(token: string, file: StagedFile) {
  const expected = join(homedir(), "Library", "Application Support", "ImageGenie", "staging", token) + sep;
  const actual = await realpath(file.path);
  if (!actual.startsWith(expected)) throw new Error("The Photos companion returned a file outside its private staging folder.");
  const details = await stat(actual);
  if (!details.isFile() || details.size !== file.size || details.size === 0) throw new Error("The staged original is missing or incomplete.");
  return actual;
}

async function checksum(path: string) {
  const hash = createHash("sha1");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function duplicateId(path: string) {
  const result = await checkBulkUpload({ assetBulkUploadCheckDto: { assets: [{ id: "staged", checksum: await checksum(path) }] } });
  const check = result.results[0];
  if (!check) throw new Error("Immich did not return an upload check result.");
  if (check.action === "reject") {
    if (check.reason === AssetRejectReason.Duplicate && check.assetId) return check.assetId;
    throw new Error(`Immich rejected this file: ${check.reason || "unknown reason"}.`);
  }
  return null;
}

async function uploadFile(path: string, file: StagedFile, capturedAt: string, livePhotoVideoId: string | null, baseUrl: string, apiKey: string) {
  const boundary = `image-genie-${randomUUID()}`;
  const field = (name: string, value: string) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
  const prefix = [
    field("fileCreatedAt", capturedAt),
    field("fileModifiedAt", capturedAt),
    ...(livePhotoVideoId ? [field("livePhotoVideoId", livePhotoVideoId)] : []),
    `--${boundary}\r\nContent-Disposition: form-data; name="assetData"; filename="${safeFilename(file.filename)}"\r\nContent-Type: ${mediaType(file.filename)}\r\n\r\n`,
  ].join("");
  const suffix = `\r\n--${boundary}--\r\n`;
  async function* chunks() {
    yield Buffer.from(prefix);
    for await (const chunk of createReadStream(path)) yield chunk;
    yield Buffer.from(suffix);
  }
  const response = await fetch(`${baseUrl}/assets`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": String(Buffer.byteLength(prefix) + file.size + Buffer.byteLength(suffix)),
    },
    body: Readable.from(chunks()) as unknown as BodyInit,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  if (!response.ok) {
    const body = await response.text();
    throw new ImmichError(`Immich upload failed (HTTP ${response.status}): ${body.slice(0, 240)}`, 502);
  }
  const result = await response.json() as { id?: string; status?: string };
  if (!result.id || ![AssetMediaStatus.Created, AssetMediaStatus.Duplicate].includes(result.status as AssetMediaStatus)) {
    throw new ImmichError("Immich returned an invalid upload receipt.", 502);
  }
  await getAssetInfo({ id: result.id });
  return result.id;
}

export async function importAppleAsset(id: string): Promise<ImportResult> {
  const status = await getAppleStatus();
  if (status.state !== "authorized" && status.state !== "limited") throw new Error("Open the Photos companion and allow Photos access.");
  if (status.version < 2) throw new Error("Rebuild and reopen the Photos companion to enable importing.");
  const connection = await getImportConnection();
  const staged = await stageAppleAsset(id);
  try {
    const photoPath = await checkedFile(staged.token, staged.photo);
    const existing = await duplicateId(photoPath);
    if (existing) {
      await getAssetInfo({ id: existing });
      return { id, immichId: existing, status: "already-in-immich", filename: staged.photo.filename };
    }
    let motionId: string | null = null;
    if (staged.motion) {
      const motionPath = await checkedFile(staged.token, staged.motion);
      motionId = await duplicateId(motionPath) || await uploadFile(motionPath, staged.motion, staged.capturedAt, null, connection.baseUrl, connection.apiKey);
    }
    const immichId = await uploadFile(photoPath, staged.photo, staged.capturedAt, motionId, connection.baseUrl, connection.apiKey);
    return { id, immichId, status: "imported", filename: staged.photo.filename };
  } catch (error) {
    if (isHttpError(error)) throw explainImmichError(error);
    throw error;
  } finally {
    try { await releaseAppleAsset(staged.token); } catch { /* A later retry can clean this staging item. */ }
  }
}
