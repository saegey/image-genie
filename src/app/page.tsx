"use client";

import { useEffect, useMemo, useState } from "react";
import { suggestEvents } from "@/lib/grouping";
import type { EventSuggestion, ReviewAsset, ReviewResponse } from "@/lib/types";

type Period = "week" | "month";
type ScreenshotFilter = "all" | "only" | "hide";
type Catalog = "immich" | "apple";

function dateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function periodRange(period: Period, reference = new Date()) {
  const start = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
  if (period === "week") start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  else start.setDate(1);
  const end = new Date(start);
  if (period === "week") end.setDate(end.getDate() + 7);
  else end.setMonth(end.getMonth() + 1);
  return { start: dateInput(start), end: dateInput(end) };
}

function movePeriod(period: Period, start: string, direction: number) {
  const current = new Date(`${start}T12:00:00`);
  if (period === "week") current.setDate(current.getDate() + direction * 7);
  else current.setMonth(current.getMonth() + direction);
  return periodRange(period, current);
}

function humanDate(value: string, options?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-US", options || { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function formatRange(start: string, end: string) {
  const inclusiveEnd = new Date(`${end}T12:00:00`);
  inclusiveEnd.setDate(inclusiveEnd.getDate() - 1);
  return `${humanDate(`${start}T12:00:00`)} – ${humanDate(inclusiveEnd.toISOString())}`;
}

async function jsonOrError(response: Response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function AssetTile({ asset, selected, onToggle, selectable = false }: { asset: ReviewAsset; selected?: boolean; onToggle?: () => void; selectable?: boolean }) {
  return <button type="button" className={`asset-tile ${selectable ? "selectable" : ""} ${selected ? "selected" : ""}`} onClick={onToggle} disabled={!selectable} aria-pressed={selectable ? selected : undefined}>
    <span className="asset-image"><img src={`/api/thumbnail/${asset.id}`} alt={asset.filename} loading="lazy" />{asset.type === "VIDEO" && <span className="video-badge">VIDEO</span>}{selectable && <span className="select-mark">{selected ? "✓" : "+"}</span>}</span>
    <span className="asset-info"><strong title={asset.filename}>{asset.filename}</strong><small>{humanDate(asset.capturedAt, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</small>{asset.camera && <small>{asset.camera}</small>}{asset.location && <small>{asset.location}</small>}{asset.people.length > 0 && <small>People: {asset.people.join(", ")}</small>}{asset.albums.length > 0 && <small>Albums: {asset.albums.join(", ")}</small>}</span>
  </button>;
}

function AppleAssetTile({ asset, selected, onToggle, onOpen }: { asset: ReviewAsset; selected: boolean; onToggle: () => void; onOpen: () => void }) {
  const [missing, setMissing] = useState(false);
  const [retry, setRetry] = useState(0);
  const query = new URLSearchParams({ id: asset.id, cloud: "1", retry: String(retry) });
  return <article className={`asset-tile apple-tile ${selected ? "selected" : ""}`}>
    <span className="asset-image">
      {!missing && <img key={retry} src={`/api/apple/thumbnail?${query}`} alt={asset.filename} loading="lazy" onError={() => setMissing(true)} />}
      {missing && <span className="cloud-placeholder"><span>☁</span>Preview unavailable<button type="button" onClick={() => { setRetry((value) => value + 1); setMissing(false); }}>Retry</button></span>}
      {asset.type === "VIDEO" && <span className="video-badge">VIDEO</span>}
      <button className="select-mark apple-select" type="button" aria-label={`${selected ? "Remove" : "Select"} ${asset.filename} for import`} aria-pressed={selected} onClick={onToggle}>{selected ? "✓" : "+"}</button>
      <button className="apple-open" type="button" onClick={onOpen}>View larger</button>
    </span>
    <span className="asset-info"><strong title={asset.filename}>{asset.filename}</strong><small>{humanDate(asset.capturedAt, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</small><small>{asset.source}</small>{asset.location && <small>{asset.location}</small>}{asset.albums.length > 0 && <small>Albums: {asset.albums.join(", ")}</small>}</span>
  </article>;
}

function ApplePreview({ asset, position, count, onClose, onPrevious, onNext }: { asset: ReviewAsset; position: number; count: number; onClose: () => void; onPrevious: () => void; onNext: () => void }) {
  const [missing, setMissing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [retry, setRetry] = useState(0);
  const query = new URLSearchParams({ id: asset.id, cloud: "1", retry: String(retry) });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft") onPrevious();
      if (event.key === "ArrowRight") onNext();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", onKey); };
  }, [onClose, onPrevious, onNext]);
  return <div className="preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="preview-dialog" role="dialog" aria-modal="true" aria-label={`Larger preview of ${asset.filename}`}>
      <div className="preview-toolbar"><div><strong>{asset.filename}</strong><span>{position} of {count} · {humanDate(asset.capturedAt, { dateStyle: "medium", timeStyle: "short" })}{asset.type === "VIDEO" ? " · video still" : ""}</span></div><button type="button" onClick={onClose} autoFocus aria-label="Close preview">×</button></div>
      <div className="preview-stage"><button type="button" className="preview-arrow" onClick={onPrevious} disabled={count < 2} aria-label="Previous photo">‹</button><div className="preview-media">{!missing ? <><img key={retry} src={`/api/apple/preview?${query}`} alt={asset.filename} onLoad={() => setLoaded(true)} onError={() => setMissing(true)} />{!loaded && <div className="preview-loading" role="status">Loading preview…</div>}</> : <div className="preview-missing"><span>☁</span><p>Larger preview unavailable</p><button type="button" className="secondary-button" onClick={() => { setRetry((value) => value + 1); setLoaded(false); setMissing(false); }}>Retry</button></div>}</div><button type="button" className="preview-arrow" onClick={onNext} disabled={count < 2} aria-label="Next photo">›</button></div>
      <div className="preview-footer"><span>{asset.location || asset.source || "Apple Photos"}</span><span>Use ← → to browse · Esc to close</span></div>
    </section>
  </div>;
}

function SuggestionCard({ suggestion, assets, onCreate, onDismiss, busy }: { suggestion: EventSuggestion; assets: ReviewAsset[]; onCreate: (name: string, ids: string[]) => Promise<void>; onDismiss: () => void; busy: boolean }) {
  const [name, setName] = useState(suggestion.name);
  const [selected, setSelected] = useState<string[]>(suggestion.assetIds);
  const [confirming, setConfirming] = useState(false);
  const [actionError, setActionError] = useState("");
  const chosen = new Set(selected);
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  return <article className="suggestion-card">
    <div className="suggestion-heading"><div><span className="eyebrow">ALBUM SUGGESTION</span><h3>{suggestion.name}</h3><p>{humanDate(suggestion.start)} · {suggestion.assetIds.length} assets{suggestion.location ? ` · ${suggestion.location}` : ""}</p></div><button className="text-button" onClick={onDismiss} type="button">Dismiss</button></div>
    <div className="suggestion-photos">{suggestion.assetIds.map((id) => byId.get(id)).filter((asset): asset is ReviewAsset => Boolean(asset)).map((asset) => <AssetTile key={asset.id} asset={asset} selected={chosen.has(asset.id)} onToggle={() => setSelected((previous) => previous.includes(asset.id) ? previous.filter((id) => id !== asset.id) : [...previous, asset.id])} selectable />)}</div>
    <div className="suggestion-actions"><label className="name-field">Album name<input value={name} maxLength={200} onChange={(event) => setName(event.target.value)} aria-label="Album name" /></label><button className="primary-button" type="button" disabled={!name.trim() || selected.length === 0 || busy} onClick={() => setConfirming(true)}>Create album <span>↗</span></button></div>
    {confirming && <div className="confirm-backdrop" role="presentation"><div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title"><span className="eyebrow">CONFIRM IN IMMICH</span><h3 id="confirm-title">Create “{name.trim()}”?</h3><p>This creates one Immich album containing {selected.length} selected {selected.length === 1 ? "asset" : "assets"}.</p>{actionError && <p className="dialog-error" role="alert">{actionError}</p>}<div className="confirm-actions"><button className="secondary-button" type="button" onClick={() => setConfirming(false)} disabled={busy}>Cancel</button><button className="primary-button" type="button" disabled={busy} onClick={async () => { setActionError(""); try { await onCreate(name.trim(), selected); setConfirming(false); } catch (cause) { setActionError(cause instanceof Error ? cause.message : "Could not create album."); } }}>{busy ? "Creating…" : "Confirm and create"}</button></div></div></div>}
  </article>;
}

export default function Home() {
  const [catalog, setCatalog] = useState<Catalog>("immich");
  const [appleStatus, setAppleStatus] = useState("disconnected");
  const [appleVersion, setAppleVersion] = useState(0);
  const [period, setPeriod] = useState<Period>("month");
  const [range, setRange] = useState<{ start: string; end: string } | null>(null);
  const [unalbumed, setUnalbumed] = useState(true);
  const [screenshots, setScreenshots] = useState<ScreenshotFilter>("all");
  const [camera, setCamera] = useState("all");
  const [review, setReview] = useState<ReviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [appleSelected, setAppleSelected] = useState<string[]>([]);
  const [importConfirming, setImportConfirming] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{ done: number; total: number; imported: number; duplicates: number; failed: string[] } | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  useEffect(() => setRange(periodRange("month")), []);

  async function refresh(signal?: AbortSignal) {
    if (!range) return;
    setLoading(true);
    setError("");
    try {
      const start = new Date(`${range.start}T00:00:00`).toISOString();
      const end = new Date(`${range.end}T00:00:00`).toISOString();
      const params = new URLSearchParams({ start, end, ...(catalog === "immich" ? { unalbumed: String(unalbumed) } : {}) });
      const endpoint = catalog === "immich" ? "/api/review" : "/api/apple/review";
      const result = await jsonOrError(await fetch(`${endpoint}?${params}`, { signal, cache: "no-store" })) as ReviewResponse;
      if (!signal?.aborted) { setReview(result); setDismissed([]); setAppleSelected([]); }
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : "Could not load review.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }

  useEffect(() => { const controller = new AbortController(); void refresh(controller.signal); return () => controller.abort(); }, [range?.start, range?.end, unalbumed, catalog]);
  useEffect(() => { if (catalog === "apple") void fetch("/api/apple/status", { cache: "no-store" }).then((response) => response.json()).then((data) => { setAppleStatus(data.state || "disconnected"); setAppleVersion(data.version || 0); }).catch(() => { setAppleStatus("disconnected"); setAppleVersion(0); }); }, [catalog, error]);

  const cameras = useMemo(() => [...new Set((review?.assets || []).map((asset) => asset.camera).filter((value): value is string => Boolean(value)))].sort(), [review]);
  const sources = useMemo(() => [...new Set((review?.assets || []).map((asset) => asset.source).filter((value): value is string => Boolean(value)))].sort(), [review]);
  const visible = useMemo(() => (review?.assets || []).filter((asset) => (screenshots === "all" || (screenshots === "only" ? asset.isScreenshot : !asset.isScreenshot)) && (camera === "all" || (camera.startsWith("camera:") ? asset.camera === camera.slice(7) : asset.source === camera.slice(7)))), [review, screenshots, camera]);
  const suggestions = useMemo(() => catalog === "immich" ? suggestEvents(visible.filter((asset) => asset.albums.length === 0)).filter((suggestion) => !dismissed.includes(suggestion.id)) : [], [catalog, visible, dismissed]);
  const suggestedIds = useMemo(() => new Set(suggestions.flatMap((suggestion) => suggestion.assetIds)), [suggestions]);
  const remaining = visible.filter((asset) => !suggestedIds.has(asset.id));
  const previewIndex = visible.findIndex((asset) => asset.id === previewId);
  const previewAsset = previewIndex >= 0 ? visible[previewIndex] : null;

  function movePreview(direction: number) {
    if (previewIndex < 0 || visible.length < 2) return;
    setPreviewId(visible[(previewIndex + direction + visible.length) % visible.length].id);
  }

  async function create(name: string, ids: string[]) {
    setCreating(true); setError(""); setNotice("");
    try {
      const result = await jsonOrError(await fetch("/api/albums", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, assetIds: ids, confirmed: true }) })) as { name: string; count: number };
      setNotice(`Created “${result.name}” in Immich with ${result.count} assets.`);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create album."); throw cause; }
    finally { setCreating(false); }
  }

  async function importSelected() {
    const ids = [...appleSelected];
    setImportConfirming(false); setImporting(true); setError(""); setNotice("");
    let imported = 0, duplicates = 0;
    const failed: string[] = [];
    const failedIds: string[] = [];
    setImportProgress({ done: 0, total: ids.length, imported, duplicates, failed });
    for (const [index, id] of ids.entries()) {
      try {
        const result = await jsonOrError(await fetch("/api/apple/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, confirmed: true }) })) as { status: "imported" | "already-in-immich" };
        if (result.status === "imported") imported++;
        else duplicates++;
      } catch (cause) {
        const filename = review?.assets.find((asset) => asset.id === id)?.filename || id;
        failed.push(`${filename}: ${cause instanceof Error ? cause.message : "Import failed"}`);
        failedIds.push(id);
      }
      setImportProgress({ done: index + 1, total: ids.length, imported, duplicates, failed: [...failed] });
    }
    setImporting(false);
    setNotice(`Import finished: ${imported} new, ${duplicates} already in Immich, ${failed.length} failed.`);
    setAppleSelected(failedIds);
  }

  function changePeriod(next: Period) { setPeriod(next); setRange(periodRange(next)); setCamera("all"); }
  return <main className="app-shell">
    <header className="topbar"><div className="brand"><span className="brand-symbol">✳</span><span>image<span className="brand-light">genie</span></span></div><div className="connection"><span className="connection-dot" />{catalog === "immich" ? `IMMICH ${review?.version || "LOCAL"}` : `APPLE PHOTOS · ${appleStatus.toUpperCase()}`}</div></header>
    <section className="intro"><div><span className="eyebrow">YOUR PHOTO WORKSPACE</span><h1>Make room for<br /><em>the moments.</em></h1><p>{catalog === "immich" ? "Review what Immich already knows, shape the stories, then save only the albums you choose." : "Choose photos on this Mac, then import their originals into Immich when you confirm."}</p></div><div className="intro-graphic" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><span className="graphic-spark">✳</span><span className="graphic-caption">A LITTLE MORE ORDER<br />A LOT MORE MEMORY</span></div></section>
    <section className="workspace"><aside className="sidebar"><span className="eyebrow">01 / REVIEW SETUP</span><h2>Choose your view</h2><span className="sidebar-label">Library</span><div className="segmented library-switch" role="group" aria-label="Photo library"><button type="button" className={catalog === "immich" ? "active" : ""} onClick={() => { setCatalog("immich"); setReview(null); setCamera("all"); }}>Immich</button><button type="button" className={catalog === "apple" ? "active" : ""} onClick={() => { setCatalog("apple"); setReview(null); setCamera("all"); }}>Apple Photos</button></div><span className="sidebar-label">Period</span><div className="segmented" role="group" aria-label="Review period"><button type="button" className={period === "week" ? "active" : ""} onClick={() => changePeriod("week")}>Week</button><button type="button" className={period === "month" ? "active" : ""} onClick={() => changePeriod("month")}>Month</button></div>
      <div className="range-navigator"><button type="button" aria-label="Previous period" onClick={() => range && setRange(movePeriod(period, range.start, -1))}>←</button><span>{range ? formatRange(range.start, range.end) : "Loading…"}</span><button type="button" aria-label="Next period" onClick={() => range && setRange(movePeriod(period, range.start, 1))}>→</button></div>
      <div className="date-fields"><label>From<input type="date" value={range?.start || ""} onChange={(event) => setRange((previous) => previous ? { ...previous, start: event.target.value } : previous)} /></label><label>To (exclusive)<input type="date" value={range?.end || ""} onChange={(event) => setRange((previous) => previous ? { ...previous, end: event.target.value } : previous)} /></label></div>
      <div className="filter-rule" /><span className="eyebrow">FILTER ASSETS</span>{catalog === "immich" && <label className="switch-row"><span>Not in an album<small>Focus on unorganized assets</small></span><input type="checkbox" checked={unalbumed} onChange={(event) => setUnalbumed(event.target.checked)} /></label>}
      <label className="select-label">Screenshots<select value={screenshots} onChange={(event) => setScreenshots(event.target.value as ScreenshotFilter)}><option value="all">All assets</option><option value="only">Screenshots only</option><option value="hide">Hide screenshots</option></select></label>
      <label className="select-label">Camera / source<select value={camera} onChange={(event) => setCamera(event.target.value)}><option value="all">All cameras and sources</option>{cameras.length > 0 && <optgroup label="Cameras">{cameras.map((value) => <option key={value} value={`camera:${value}`}>{value}</option>)}</optgroup>}<optgroup label={catalog === "immich" ? "Immich libraries" : "Photo sources"}>{sources.map((value) => <option key={value} value={`source:${value}`}>{value}</option>)}</optgroup></select></label>
      <div className="sidebar-note"><span>✧</span><p>{catalog === "immich" ? "Suggestions live here only while you review. Your photos and albums stay in Immich." : "Previews load from iCloud when needed. Import downloads originals only after confirmation. Apple Photos stays unchanged."}</p></div>
    </aside><div className="review-content"><div className="review-header"><div><span className="eyebrow">02 / EXPLORE & ORGANIZE</span><h2>{period === "week" ? "Your week" : "Your month"} in view</h2><p>{loading ? `Looking through ${catalog === "immich" ? "Immich" : "Apple Photos"}…` : `${visible.length} assets to review${review?.capped ? ` · first ${review.assets.length} of ${review.total} shown; narrow the date range for more` : ""}`}</p></div><button className="refresh-button" type="button" onClick={() => void refresh()} disabled={loading || importing}>↻ <span>Refresh</span></button></div>
      {catalog === "apple" && <div className="apple-banner"><strong>Apple Photos → Immich</strong><span>{appleVersion < 2 ? "Rebuild and reopen the Photos companion to enable importing." : "Import only after confirmation. Originals may be downloaded from iCloud; Apple Photos will not be changed."}</span><button type="button" onClick={() => { void fetch("/api/apple/status", { cache: "no-store" }).then((response) => response.json()).then((data) => { setAppleStatus(data.state || "disconnected"); setAppleVersion(data.version || 0); }); void refresh(); }} disabled={importing}>Check connection</button></div>}
      {catalog === "apple" && visible.length > 0 && <div className="import-toolbar"><div><strong>{appleSelected.length} selected</strong><span>{review?.capped ? "This range exceeds the display limit; narrow the dates to include the rest." : "Select photos and videos to send to Immich."}</span></div><button className="secondary-button" type="button" onClick={() => setAppleSelected(visible.map((asset) => asset.id))} disabled={importing}>Select all shown</button><button className="text-button" type="button" onClick={() => setAppleSelected([])} disabled={importing || appleSelected.length === 0}>Clear</button><button className="primary-button" type="button" onClick={() => setImportConfirming(true)} disabled={importing || appleVersion < 2 || appleSelected.length === 0 || loading}>Import selected</button></div>}
      {importProgress && catalog === "apple" && <div className="import-progress" role="status"><strong>{importing ? "Importing originals…" : "Import complete"}</strong><span>{importProgress.done} of {importProgress.total} processed · {importProgress.imported} new · {importProgress.duplicates} already in Immich · {importProgress.failed.length} failed</span><progress value={importProgress.done} max={importProgress.total} />{importProgress.failed.length > 0 && <details><summary>Show failed assets</summary><ul>{importProgress.failed.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}</div>}
      {importConfirming && <div className="confirm-backdrop" role="presentation"><div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="import-confirm-title"><span className="eyebrow">CONFIRM IMPORT</span><h3 id="import-confirm-title">Import {appleSelected.length} originals?</h3><p>Image Genie will load originals from Apple Photos or iCloud, upload them to Immich, verify each upload, and remove temporary copies. Exact duplicates are skipped. Apple Photos will not be changed or deleted. Keep this page and the companion open until the import finishes.</p><div className="confirm-actions"><button className="secondary-button" type="button" onClick={() => setImportConfirming(false)}>Cancel</button><button className="primary-button" type="button" onClick={() => void importSelected()}>Confirm and import</button></div></div></div>}
      {catalog === "apple" && previewAsset && <ApplePreview key={previewAsset.id} asset={previewAsset} position={previewIndex + 1} count={visible.length} onClose={() => setPreviewId(null)} onPrevious={() => movePreview(-1)} onNext={() => movePreview(1)} />}
      {error && <div className="message error" role="alert">{error}</div>}{notice && <div className="message success" role="status">{notice}</div>}
      {!loading && !error && visible.length === 0 && <div className="empty-state"><span>✳</span><h3>All clear here</h3><p>{catalog === "immich" ? "No assets match this date range and these filters. Try another period or show all albums." : "No Apple Photos assets match this date range and these filters. Try another period."}</p></div>}
      {suggestions.length > 0 && <section className="suggestions"><div className="section-heading"><div><span className="eyebrow">CURATED FROM YOUR TIMELINE</span><h2>Possible stories <sup>{suggestions.length}</sup></h2></div><p>Grouped by nearby capture times and locations. You make the final call.</p></div><div className="suggestion-list">{suggestions.map((suggestion) => <SuggestionCard key={suggestion.id} suggestion={suggestion} assets={visible} onCreate={create} onDismiss={() => setDismissed((previous) => [...previous, suggestion.id])} busy={creating} />)}</div></section>}
      {remaining.length > 0 && <section className="loose-assets"><div className="section-heading"><div><span className="eyebrow">{catalog === "immich" ? "THE REST OF THE ROLL" : "APPLE PHOTOS LIBRARY"}</span><h2>{catalog === "immich" ? "Individual moments" : "Photos and videos"} <sup>{remaining.length}</sup></h2></div><p>{catalog === "immich" ? "Single assets and photos outside the current suggestions." : "Open a larger preview or select assets to import."}</p></div><div className="asset-grid">{remaining.map((asset) => catalog === "immich" ? <AssetTile key={asset.id} asset={asset} /> : <AppleAssetTile key={asset.id} asset={asset} selected={appleSelected.includes(asset.id)} onToggle={() => setAppleSelected((previous) => previous.includes(asset.id) ? previous.filter((id) => id !== asset.id) : [...previous, asset.id])} onOpen={() => setPreviewId(asset.id)} />)}</div></section>}
    </div></section><footer>IMAGE GENIE <span>·</span> ORGANIZE WITH IMMICH, AT YOUR PACE</footer>
  </main>;
}
