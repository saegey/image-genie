import { beforeEach, describe, expect, it, vi } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

const mocks = vi.hoisted(() => ({
  status: vi.fn(), stage: vi.fn(), release: vi.fn(), check: vi.fn(), info: vi.fn(), version: vi.fn(), init: vi.fn(),
}));

vi.mock("./apple-photos", () => ({ getAppleStatus: mocks.status, stageAppleAsset: mocks.stage, releaseAppleAsset: mocks.release }));
vi.mock("@immich/sdk", async (original) => ({ ...await original<typeof import("@immich/sdk")>(), checkBulkUpload: mocks.check, getAssetInfo: mocks.info, getServerVersion: mocks.version, init: mocks.init }));
vi.mock("node:fs", () => ({ createReadStream: () => Readable.from([Buffer.from("abc")]) }));
vi.mock("node:fs/promises", () => ({ realpath: async (path: string) => path, stat: async () => ({ isFile: () => true, size: 3 }) }));

import { importAppleAsset } from "./import-apple";

const token = "11111111-1111-1111-1111-111111111111";
const directory = join(homedir(), "Library", "Application Support", "ImageGenie", "staging", token);
const staged = {
  token,
  capturedAt: "2026-09-01T12:00:00.000Z",
  photo: { path: join(directory, "original.HEIC"), filename: "IMG_1.HEIC", size: 3 },
  motion: null,
};

describe("confirmed Apple Photos import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.IMMICH_URL = "https://immich.home.arpa/api";
    process.env.IMMICH_API_KEY = "test-key";
    mocks.status.mockResolvedValue({ state: "authorized", version: 2 });
    mocks.stage.mockResolvedValue(staged);
    mocks.release.mockResolvedValue(undefined);
    mocks.version.mockResolvedValue({ major: 3, minor: 2, patch: 2 });
    mocks.info.mockResolvedValue({ id: "immich-id" });
  });

  it("does not upload an exact duplicate and releases the staged original", async () => {
    mocks.check.mockResolvedValue({ results: [{ action: "reject", reason: "duplicate", assetId: "immich-id" }] });
    const upload = vi.spyOn(globalThis, "fetch");
    const result = await importAppleAsset("apple/L0/001");
    expect(result).toMatchObject({ status: "already-in-immich", immichId: "immich-id" });
    expect(upload).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledWith(token);
    upload.mockRestore();
  });

  it("uploads and verifies a new original, then releases its temporary file", async () => {
    mocks.check.mockResolvedValue({ results: [{ action: "accept" }] });
    const upload = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "new-id", status: "created" }), { status: 201 }));
    const result = await importAppleAsset("apple/L0/001");
    expect(result).toMatchObject({ status: "imported", immichId: "new-id" });
    expect(upload).toHaveBeenCalledWith("https://immich.home.arpa/api/assets", expect.objectContaining({ method: "POST" }));
    expect(mocks.info).toHaveBeenCalledWith({ id: "new-id" });
    expect(mocks.release).toHaveBeenCalledWith(token);
    upload.mockRestore();
  });

  it("uploads a Live Photo motion clip before its still and links the two", async () => {
    mocks.stage.mockResolvedValue({ ...staged, motion: { path: join(directory, "motion.MOV"), filename: "IMG_1.MOV", size: 3 } });
    mocks.check.mockResolvedValue({ results: [{ action: "accept" }] });
    const upload = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "motion-id", status: "created" }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "still-id", status: "created" }), { status: 201 }));
    const result = await importAppleAsset("apple/L0/001");
    expect(result.immichId).toBe("still-id");
    expect(upload).toHaveBeenCalledTimes(2);
    const firstBody = upload.mock.calls[0][1]?.body as unknown as Readable;
    const secondBody = upload.mock.calls[1][1]?.body as unknown as Readable;
    let first = "", second = "";
    for await (const chunk of firstBody) first += chunk.toString();
    for await (const chunk of secondBody) second += chunk.toString();
    expect(first).toContain('filename="IMG_1.MOV"');
    expect(second).toContain('name="livePhotoVideoId"\r\n\r\nmotion-id');
    expect(mocks.release).toHaveBeenCalledWith(token);
    upload.mockRestore();
  });
});
