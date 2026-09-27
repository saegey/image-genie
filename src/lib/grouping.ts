import type { EventSuggestion, ReviewAsset } from "./types";

const MAX_GAP_MS = 6 * 60 * 60 * 1000;
const MAX_DISTANCE_KM = 50;

function distanceKm(a: ReviewAsset, b: ReviewAsset): number | null {
  if (a.latitude === null || a.longitude === null || b.latitude === null || b.longitude === null) return null;
  const radians = Math.PI / 180;
  const lat = (b.latitude - a.latitude) * radians;
  const lon = (b.longitude - a.longitude) * radians;
  const haversine = Math.sin(lat / 2) ** 2 + Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians) * Math.sin(lon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export function suggestEvents(assets: ReviewAsset[]): EventSuggestion[] {
  const sorted = [...assets].sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
  const groups: ReviewAsset[][] = [];
  for (const asset of sorted) {
    const group = groups.at(-1);
    const previous = group?.at(-1);
    const gap = previous ? Date.parse(asset.capturedAt) - Date.parse(previous.capturedAt) : Infinity;
    const distance = previous ? distanceKm(previous, asset) : null;
    if (!group || gap > MAX_GAP_MS || (distance !== null && distance > MAX_DISTANCE_KM)) {
      groups.push([asset]);
    } else {
      group.push(asset);
    }
  }
  return groups.filter((group) => group.length >= 2).map((group) => {
    const first = group[0];
    const last = group[group.length - 1];
    const location = group.map((asset) => asset.location).find(Boolean) || null;
    const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(first.capturedAt));
    return {
      id: group.map((asset) => asset.id).join(":"),
      name: location ? `${location.split(",")[0]} · ${date}` : `Photos · ${date}`,
      assetIds: group.map((asset) => asset.id),
      start: first.capturedAt,
      end: last.capturedAt,
      location,
    };
  }).reverse();
}
