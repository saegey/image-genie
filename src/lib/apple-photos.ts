import http from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ReviewResponse } from "./types";

function bridgeSocketPath() {
  return process.env.IMAGE_GENIE_PHOTOS_SOCKET || join(homedir(), "Library", "Application Support", "ImageGenie", "photos.sock");
}

export class ApplePhotosError extends Error {
  constructor(message: string, public status = 503) { super(message); }
}

type BridgeReply = { status: number; body: Buffer; contentType: string };

export async function callPhotos(path: string, timeout = 60000, method = "GET"): Promise<BridgeReply> {
  return await new Promise<BridgeReply>((resolve, reject) => {
    const request = http.request({ socketPath: bridgeSocketPath(), path, method, timeout, headers: { Host: "localhost" } }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode || 502, body: Buffer.concat(chunks), contentType: String(response.headers["content-type"] || "application/octet-stream") }));
      response.on("error", reject);
    });
    request.on("timeout", () => request.destroy(new ApplePhotosError("Apple Photos took too long to respond. Check the companion and iCloud connection.")));
    request.on("error", (error) => reject(error));
    request.end();
  }).catch((error: unknown) => {
    if (error instanceof ApplePhotosError) throw error;
    throw new ApplePhotosError("Open the Image Genie Photos companion on this Mac, then allow Photos access.");
  });
}

export async function getAppleStatus(): Promise<{ state: string; version: number }> {
  try {
    const reply = await callPhotos("/status");
    if (reply.status !== 200) throw new ApplePhotosError("The Apple Photos companion is not ready.");
    return JSON.parse(reply.body.toString("utf8"));
  } catch {
    return { state: "disconnected", version: 0 };
  }
}

export async function getAppleReview(start: string, end: string): Promise<ReviewResponse> {
  const assets: ReviewResponse["assets"] = [];
  let total = 0;
  let capped = false;
  do {
    const query = new URLSearchParams({ start, end, offset: String(assets.length) });
    const reply = await callPhotos(`/assets?${query}`);
    if (reply.status === 403) throw new ApplePhotosError("Allow Photos access in the Image Genie Photos companion.", 403);
    if (reply.status !== 200) throw new ApplePhotosError(`Apple Photos returned HTTP ${reply.status}. Rebuild the companion if it is out of date.`, reply.status);
    const page = JSON.parse(reply.body.toString("utf8")) as Omit<ReviewResponse, "version">;
    if (!Array.isArray(page.assets) || typeof page.total !== "number") throw new ApplePhotosError("The Apple Photos companion returned an invalid response.", 502);
    assets.push(...page.assets);
    total = page.total;
    capped = page.capped;
    if (page.assets.length === 0 || assets.length >= 5000) break;
  } while (capped);
  return { assets, total, capped, version: "PhotoKit" };
}

export async function getAppleThumbnail(id: string, allowCloud: boolean): Promise<BridgeReply> {
  const query = new URLSearchParams({ id, cloud: allowCloud ? "1" : "0" });
  return await callPhotos(`/thumbnail?${query}`, allowCloud ? 180000 : 60000);
}

export async function getApplePreview(id: string, allowCloud: boolean): Promise<BridgeReply> {
  const query = new URLSearchParams({ id, cloud: allowCloud ? "1" : "0" });
  return await callPhotos(`/preview?${query}`, 180000);
}

export type StagedFile = { path: string; filename: string; size: number };
export type StagedAsset = { token: string; capturedAt: string; photo: StagedFile; motion: StagedFile | null };

export async function stageAppleAsset(id: string): Promise<StagedAsset> {
  const reply = await callPhotos(`/stage?${new URLSearchParams({ id })}`, 1800000);
  if (reply.status !== 200) {
    const detail = JSON.parse(reply.body.toString("utf8")) as { error?: string };
    throw new ApplePhotosError(detail.error || "Could not prepare the original in Apple Photos.", reply.status);
  }
  const staged = JSON.parse(reply.body.toString("utf8")) as StagedAsset;
  if (!staged.token || !staged.photo?.path || !staged.photo.filename || !Number.isSafeInteger(staged.photo.size)) {
    throw new ApplePhotosError("The Photos companion returned an invalid original.", 502);
  }
  return staged;
}

export async function releaseAppleAsset(token: string): Promise<void> {
  await callPhotos(`/release?${new URLSearchParams({ token })}`);
}

export async function deleteAppleAsset(id: string): Promise<void> {
  const reply = await callPhotos(`/delete?${new URLSearchParams({ id })}`, 60000, "DELETE");
  if (reply.status !== 200) {
    let detail: { error?: string } = {};
    try { detail = JSON.parse(reply.body.toString("utf8")) as { error?: string }; } catch { /* Companion returned an invalid error body. */ }
    throw new ApplePhotosError(detail.error || `Apple Photos returned HTTP ${reply.status}.`, reply.status);
  }
  let result: { deleted?: boolean };
  try { result = JSON.parse(reply.body.toString("utf8")) as { deleted?: boolean }; }
  catch { throw new ApplePhotosError("The Photos companion returned an invalid deletion response.", 502); }
  if (result.deleted !== true) throw new ApplePhotosError("The Photos companion did not confirm deletion.", 502);
}
