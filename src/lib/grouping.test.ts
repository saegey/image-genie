import { describe, expect, it } from "vitest";
import { suggestEvents } from "./grouping";
import type { ReviewAsset } from "./types";

function asset(id: string, hour: number, latitude: number): ReviewAsset {
  return { provider: "immich", id, capturedAt: `2026-09-27T${String(hour).padStart(2, "0")}:00:00Z`, filename: `${id}.jpg`, camera: null, source: null, location: "Oakland", latitude, longitude: -122.2, albums: [], people: [], isScreenshot: false, type: "IMAGE" };
}

describe("event suggestions", () => {
  it("groups nearby photos and splits distant or much later photos", () => {
    const groups = suggestEvents([asset("a", 10, 37.8), asset("b", 11, 37.81), asset("c", 12, 38.8), asset("d", 13, 38.81), asset("e", 23, 38.81)]);
    expect(groups.map((group) => group.assetIds)).toEqual([["c", "d"], ["a", "b"]]);
  });
});
