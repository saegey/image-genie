export type ReviewAsset = {
  provider: "immich" | "apple";
  id: string;
  capturedAt: string;
  filename: string;
  camera: string | null;
  source: string | null;
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  albums: string[];
  people: string[];
  isScreenshot: boolean;
  type: "IMAGE" | "VIDEO" | "OTHER";
};

export type ReviewResponse = {
  assets: ReviewAsset[];
  total: number;
  capped: boolean;
  version: string;
};

export type EventSuggestion = {
  id: string;
  name: string;
  assetIds: string[];
  start: string;
  end: string;
  location: string | null;
};
