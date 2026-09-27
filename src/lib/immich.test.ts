import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssetOrder, SearchOrderField } from "@immich/sdk";

const sdk = vi.hoisted(() => ({
  init: vi.fn(),
  getServerVersion: vi.fn(),
  searchAssets: vi.fn(),
  getAllAlbums: vi.fn(),
  createAlbum: vi.fn(),
  viewAsset: vi.fn(),
  isHttpError: vi.fn(() => false),
}));

vi.mock("@immich/sdk", async (original) => ({ ...await original<typeof import("@immich/sdk")>(), ...sdk }));

import { createConfirmedAlbum, getReview } from "./immich";

const asset = {
  id: "11111111-1111-1111-1111-111111111111",
  fileCreatedAt: "2026-09-27T10:00:00.000Z",
  originalFileName: "IMG_001.jpg",
  originalPath: "/library/IMG_001.jpg",
  type: "IMAGE",
  exifInfo: { make: "Apple", model: "iPhone", city: "Oakland", latitude: 37.8, longitude: -122.2 },
  people: [{ name: "Sam" }],
};

describe("Immich integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.IMMICH_URL = "https://immich.home.arpa/api";
    process.env.IMMICH_API_KEY = "test-key";
    sdk.getServerVersion.mockResolvedValue({ major: 3, minor: 2, patch: 2 });
    sdk.searchAssets.mockResolvedValue({ assets: { items: [asset], total: 1, nextCursor: null } });
    sdk.getAllAlbums.mockResolvedValue([{ albumName: "Family" }]);
  });

  it("searches the selected date range and uses Immich's no-album filter", async () => {
    const review = await getReview("2026-09-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z", true);
    expect(sdk.init).toHaveBeenCalledWith({ baseUrl: "https://immich.home.arpa/api", apiKey: "test-key" });
    expect(sdk.searchAssets).toHaveBeenCalledWith({ metadataSearchDto: expect.objectContaining({
      filter: { takenAt: { gte: "2026-09-01T00:00:00.000Z", lt: "2026-10-01T00:00:00.000Z" }, hasAlbums: { eq: false } },
      withExif: true,
      withPeople: true,
      orderBy: { field: SearchOrderField.FileCreatedAt, direction: AssetOrder.Desc },
    }) });
    expect(sdk.getAllAlbums).not.toHaveBeenCalled();
    expect(review.assets[0]).toMatchObject({ camera: "Apple iPhone", location: "Oakland", people: ["Sam"], albums: [] });
  });

  it("looks up album membership when all assets are shown", async () => {
    const review = await getReview("2026-09-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z", false);
    expect(sdk.getAllAlbums).toHaveBeenCalledWith({ assetId: asset.id });
    expect(review.assets[0].albums).toEqual(["Family"]);
  });

  it("creates an album with selected asset IDs in Immich's atomic create request", async () => {
    sdk.createAlbum.mockResolvedValue({ id: "album-id", albumName: "Oakland · Sep 27", assetCount: 1 });
    await createConfirmedAlbum("Oakland · Sep 27", [asset.id]);
    expect(sdk.createAlbum).toHaveBeenCalledWith({ createAlbumDto: { albumName: "Oakland · Sep 27", assetIds: [asset.id] } });
  });

  it("stops when the server version differs from the checked SDK version", async () => {
    sdk.getServerVersion.mockResolvedValue({ major: 3, minor: 3, patch: 0 });
    await expect(getReview("2026-09-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z", true)).rejects.toThrow("verify SDK compatibility");
    expect(sdk.searchAssets).not.toHaveBeenCalled();
  });
});
