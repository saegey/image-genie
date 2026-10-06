import {
  AssetMediaSize,
  AssetOrder,
  SearchOrderField,
  addAssetsToAlbums,
  getAllAlbums,
  getServerVersion,
  init,
  isHttpError,
  searchAssets,
  viewAsset,
  createAlbum,
  type AssetResponseDto,
  type MetadataSearchDto,
} from "@immich/sdk";
import type { ReviewAsset, ReviewResponse } from "./types";

const MAX_ASSETS = 500;
const PAGE_SIZE = 100;

export class ImmichError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

function configure() {
  const baseUrl = process.env.IMMICH_URL?.trim().replace(/\/$/, "");
  const apiKey = process.env.IMMICH_API_KEY?.trim();
  if (!baseUrl || !apiKey || apiKey === "replace-me") {
    throw new ImmichError("Set IMMICH_URL and IMMICH_API_KEY in .env.local, then restart the app.", 503);
  }
  if (!/^https?:\/\//.test(baseUrl) || !baseUrl.endsWith("/api")) {
    throw new ImmichError("IMMICH_URL must be an http(s) URL ending in /api.", 503);
  }
  init({ baseUrl, apiKey });
  return { baseUrl, apiKey };
}

export async function getImportConnection() {
  const connection = configure();
  try {
    const version = await getServerVersion();
    if (version.major !== 3 || version.minor !== 2) {
      throw new ImmichError(`Immich ${version.major}.${version.minor}.${version.patch} is connected. Import was checked against 3.2.2; verify API compatibility before continuing.`, 409);
    }
    return connection;
  } catch (error) {
    throw explainImmichError(error);
  }
}

export function explainImmichError(error: unknown): ImmichError {
  if (error instanceof ImmichError) return error;
  if (isHttpError(error)) {
    if (error.status === 401 || error.status === 403) {
      return new ImmichError("Immich rejected the API key or its permissions. Check asset read and album permissions.", 502);
    }
    return new ImmichError(`Immich returned HTTP ${error.status}: ${error.data?.message || error.message}`);
  }
  return new ImmichError(error instanceof Error ? `Could not reach Immich: ${error.message}` : "Could not reach Immich.");
}

function screenshot(asset: AssetResponseDto): boolean {
  const text = `${asset.originalFileName} ${asset.originalPath} ${(asset.tags || []).map((tag) => tag.name).join(" ")}`;
  return /screen[ _-]?(shot|capture)|screencap|capture d.e.cran/i.test(text);
}

function mapAsset(asset: AssetResponseDto, albums: string[]): ReviewAsset {
  const exif = asset.exifInfo;
  const camera = [exif?.make, exif?.model].filter(Boolean).join(" ") || null;
  const location = [exif?.city, exif?.state, exif?.country].filter(Boolean).join(", ") || null;
  return {
    provider: "immich",
    id: asset.id,
    capturedAt: asset.fileCreatedAt,
    filename: asset.originalFileName,
    camera,
    source: asset.libraryId ? `Library ${asset.libraryId.slice(0, 8)}` : "No library",
    location,
    latitude: exif?.latitude ?? null,
    longitude: exif?.longitude ?? null,
    albums,
    people: (asset.people || []).map((person) => person.name).filter(Boolean),
    isScreenshot: screenshot(asset),
    type: asset.type === "IMAGE" || asset.type === "VIDEO" ? asset.type : "OTHER",
  };
}

async function mapWithAlbums(assets: AssetResponseDto[], unalbumed: boolean): Promise<ReviewAsset[]> {
  if (unalbumed) return assets.map((asset) => mapAsset(asset, []));
  const mapped: ReviewAsset[] = new Array(assets.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(8, assets.length) }, async () => {
    while (next < assets.length) {
      const index = next++;
      const albums = await getAllAlbums({ assetId: assets[index].id });
      mapped[index] = mapAsset(assets[index], albums.map((album) => album.albumName));
    }
  });
  await Promise.all(workers);
  return mapped;
}

export async function getReview(start: string, end: string, unalbumed: boolean): Promise<ReviewResponse> {
  configure();
  try {
    const version = await getServerVersion();
    if (version.major !== 3 || version.minor !== 2) {
      throw new ImmichError(`Immich ${version.major}.${version.minor}.${version.patch} is connected. This milestone was checked against 3.2.2; verify SDK compatibility before continuing.`, 409);
    }
    const assets: AssetResponseDto[] = [];
    let cursor: string | undefined;
    let capped = false;
    let total = 0;
    do {
      const query: MetadataSearchDto = {
        filter: {
          takenAt: { gte: start, lt: end },
          ...(unalbumed ? { hasAlbums: { eq: false } } : {}),
        },
        cursor,
        size: PAGE_SIZE,
        withExif: true,
        withPeople: true,
        orderBy: { field: SearchOrderField.FileCreatedAt, direction: AssetOrder.Desc },
      };
      const result = await searchAssets({ metadataSearchDto: query });
      assets.push(...result.assets.items);
      // V3 search reports the current page count here, not the full range count.
      total = assets.length;
      cursor = result.assets.nextCursor || undefined;
      if (assets.length >= MAX_ASSETS && cursor) {
        capped = true;
        break;
      }
    } while (cursor);
    return {
      assets: await mapWithAlbums(assets.slice(0, MAX_ASSETS), unalbumed),
      total,
      capped,
      version: `${version.major}.${version.minor}.${version.patch}`,
    };
  } catch (error) {
    throw explainImmichError(error);
  }
}

export async function getThumbnail(id: string): Promise<Blob> {
  configure();
  try {
    return await viewAsset({ id, size: AssetMediaSize.Thumbnail });
  } catch (error) {
    throw explainImmichError(error);
  }
}

export async function createConfirmedAlbum(name: string, ids: string[]) {
  configure();
  try {
    // Immich creates the album and adds the assets in one server operation.
    return await createAlbum({ createAlbumDto: { albumName: name, assetIds: ids } });
  } catch (error) {
    throw explainImmichError(error);
  }
}

export async function getOwnedAlbums() {
  configure();
  try {
    const albums = await getAllAlbums({ isOwned: true });
    return albums.map(({ id, albumName, assetCount }) => ({ id, name: albumName, assetCount }))
      .sort((first, second) => first.name.localeCompare(second.name));
  } catch (error) {
    throw explainImmichError(error);
  }
}

export async function addConfirmedAssetsToAlbum(albumId: string, ids: string[]) {
  configure();
  try {
    const result = await addAssetsToAlbums({ albumsAddAssetsDto: { albumIds: [albumId], assetIds: ids } });
    if (!result.success) {
      const detail = result.error ? ` (${result.error})` : "";
      throw new ImmichError(`Immich could not add the selected assets to that album${detail}.`, 409);
    }
    return result;
  } catch (error) {
    throw explainImmichError(error);
  }
}
