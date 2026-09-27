import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getApplePreview, getAppleReview, getAppleStatus, getAppleThumbnail, releaseAppleAsset, stageAppleAsset } from "./apple-photos";

const directory = mkdtempSync(join(tmpdir(), "image-genie-photos-test-"));
const socket = join(directory, "bridge.sock");
const server = http.createServer((request, response) => {
  const url = new URL(request.url || "/", "http://localhost");
  if (url.pathname === "/status") return void response.end(JSON.stringify({ state: "authorized", version: 2 }));
  if (url.pathname === "/assets") {
    response.setHeader("Content-Type", "application/json");
    return void response.end(JSON.stringify({ assets: [{ id: "one/L0/001", provider: "apple", filename: "IMG_1.HEIC" }], total: 1, capped: false }));
  }
  if ((url.pathname === "/thumbnail" || url.pathname === "/preview") && url.searchParams.get("id") === "one/L0/001") {
    response.setHeader("Content-Type", "image/jpeg");
    return void response.end(Buffer.from([0xff, 0xd8, 0xff]));
  }
  if (url.pathname === "/stage" && url.searchParams.get("id") === "one/L0/001") {
    response.setHeader("Content-Type", "application/json");
    return void response.end(JSON.stringify({ token: "11111111-1111-1111-1111-111111111111", capturedAt: "2026-09-01T00:00:00.000Z", photo: { path: "/tmp/original.HEIC", filename: "IMG_1.HEIC", size: 123 }, motion: null }));
  }
  if (url.pathname === "/release") return void response.end(JSON.stringify({ released: true }));
  response.statusCode = 404;
  response.end();
});

beforeAll(async () => {
  process.env.IMAGE_GENIE_PHOTOS_SOCKET = socket;
  await new Promise<void>((resolve) => server.listen(socket, resolve));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  delete process.env.IMAGE_GENIE_PHOTOS_SOCKET;
  rmSync(directory, { recursive: true, force: true });
});

describe("Apple Photos local bridge", () => {
  it("reads companion status and date-range metadata", async () => {
    expect(await getAppleStatus()).toEqual({ state: "authorized", version: 2 });
    const review = await getAppleReview("2026-09-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z");
    expect(review.version).toBe("PhotoKit");
    expect(review.assets[0].id).toBe("one/L0/001");
  });

  it("requests an encoded Photos identifier for a thumbnail", async () => {
    const reply = await getAppleThumbnail("one/L0/001", false);
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  });

  it("requests a larger preview through the same private bridge", async () => {
    const reply = await getApplePreview("one/L0/001", true);
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  });

  it("stages and releases an original through the private bridge", async () => {
    const staged = await stageAppleAsset("one/L0/001");
    expect(staged.photo.filename).toBe("IMG_1.HEIC");
    await expect(releaseAppleAsset(staged.token)).resolves.toBeUndefined();
  });
});
