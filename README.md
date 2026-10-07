# Image Genie

A local photo review layer for an existing Immich instance. Immich stores the photos, metadata, people, thumbnails, and albums. Image Genie stores no media catalog or photo database. Suggestions are calculated from the current review and stay in browser memory until you leave or refresh.

## Milestone 1

- Browse a week, month, or custom date range, initially focused on assets without albums.
- Filter screenshots and camera models. Screenshot detection is a filename/path/tag heuristic, so unusual screenshot names may be missed.
- Review Immich thumbnails, capture times, filenames, camera, location, people, and existing albums when available.
- See event suggestions based on capture time and location. Rename, change the selected assets, or dismiss each suggestion.
- Create a new Immich album or add selected assets to an existing owned album, only after explicit confirmation.

## Apple Photos review and import

On the same Mac, a small native companion reads Apple Photos through PhotoKit. It returns metadata and thumbnails to Image Genie through a private Unix socket under your user account. The Apple Photos tab lets you select assets and explicitly confirm importing their unmodified originals into Immich. You can also explicitly delete selected Apple Photos assets: deletion requires full Photos library access, a second confirmation, and typing `DELETE`, with a limit of 50 assets per batch. PhotoKit moves deleted items to Recently Deleted. With iCloud Photos, deletion syncs to other devices signed into the same Apple Account; Apple says items can be recovered for 30 days before permanent removal. Image Genie does not permanently empty Recently Deleted. It does not create Photos albums or change Photos metadata. It does not claim that an Apple asset matches an Immich asset until Immich confirms an exact-byte duplicate or a successful upload.

Build and launch the companion:

```sh
cd mac-photos
xcodebuild -project ImageGeniePhotos.xcodeproj -scheme ImageGeniePhotos -configuration Debug -derivedDataPath build/DerivedData -destination 'platform=macOS,arch=arm64' build
open build/DerivedData/Build/Products/Debug/ImageGeniePhotos.app
```

The Xcode project is included. If you edit `project.yml`, regenerate it with `xcodegen generate --spec project.yml`. In the companion window, choose **Allow Photos access** when ready. Keep the companion open while using the **Apple Photos** library switch in Image Genie. macOS may show its own access prompt; that permission is managed by macOS, not by Image Genie.

With **Optimize Mac Storage**, assets can appear in the review even when their previews are not stored on the Mac. Visible thumbnails and the **View larger** 2,400-pixel preview now fetch from iCloud automatically when necessary, with a retry control for transient failures. The larger viewer supports arrow-key navigation and fits portrait images within the available window. An import confirmation allows the companion to fetch full originals from iCloud if needed. You do not need to switch off Optimize Mac Storage, but browsing may use iCloud bandwidth. Camera model and named people are not part of this PhotoKit view; they remain available from Immich where Immich has that metadata.

Deletion affects Apple Photos only; it does not remove an asset that has already been imported into Immich. Review selected items before confirming, especially when iCloud Photos is enabled. Apple's [Photos guidance](https://support.apple.com/guide/photos/delete-photos-videos-recover-deleted-pht3bfab2f96/mac) explains how to recover items from Recently Deleted during the 30-day recovery period.

To catch up, switch to **Apple Photos**, set **From** to a date before your last import and **To** after today, then choose **Select all shown → Import selected → Confirm and import**. The date range is at most one year and the review loads at most 5,000 assets; narrow the range if it says it is capped. Screenshot and source filters apply to selection. Keep the browser tab, Next.js server, and native companion running until progress reaches the end. If a run stops, repeat it: Image Genie asks Immich whether each original's SHA-1 checksum is already present before uploading. It reports new, existing, and failed assets and keeps failed assets selected for a retry. Deduplication is exact-byte, so an edited or re-encoded copy may still appear separately.

The companion stages one Photos asset at a time in `~/Library/Application Support/ImageGenie/staging`, including its Live Photo motion clip when present. The Next.js server streams each resource into Immich's supported upload API, verifies the returned asset ID, then asks the companion to remove the temporary files. The companion also clears abandoned staging folders when it starts. An interrupted Live Photo import may leave its motion clip in Immich if the still upload failed; the failure will be shown for review. Importing does not delete anything from either library. There is no background job or automatic import yet; closing the browser stops the remaining queue after the current request.

The UI is designed for one user on this Mac. Local `npm run dev` and `npm run start` bind to `127.0.0.1`. There is no application login; do not expose port 3000 publicly. Docker remains available for the Immich-only view, but the Apple Photos companion is designed for the native macOS run.

## Setup

Use Node.js 22+. Create `.env.local` from `.env.example` and set:

```dotenv
IMMICH_URL=https://immich.home.arpa/api
IMMICH_API_KEY=your-immich-api-key
```

Alternatively, keep both values in 1Password and let the [1Password CLI](https://developer.1password.com/docs/cli/) (`op`) inject them at runtime. `.env.1password` holds `op://` references (no secrets) and is committed. Create the item once:

```sh
op item create --vault Homelab --category "API Credential" --title image-genie \
  'credential=your-immich-api-key' 'url[text]=https://immich.home.arpa/api'
```

Then run `npm run dev:op`, `npm run start:op`, or `npm run docker:op` instead of the plain scripts; no `.env.local` or `.env` file is needed. To use a different vault or item, edit the references in `.env.1password`.

The local `dev` and `start` scripts set `NODE_USE_SYSTEM_CA=1`, so Node trusts certificate authorities in the macOS keychain (for example a homelab CA for `*.home.arpa`).

The URL must end in `/api`. The API key remains on the Next.js server and is never sent to the browser. Give the key asset read, asset upload, album read, album create, album update, and asset share permissions. Thumbnail viewing may also require asset view; check Immich's permission descriptions for your server.

```sh
npm install
NODE_USE_SYSTEM_CA=1 npm run dev
```

Open <http://localhost:3000>. `NODE_USE_SYSTEM_CA=1` lets Node trust a local certificate installed in your operating system's trust store, as with this Immich host. If your certificate is already trusted by Node, plain `npm run dev` is fine. For a production process run `npm run build` then `NODE_USE_SYSTEM_CA=1 npm run start`.

## Docker

Set `IMMICH_URL` and `IMMICH_API_KEY` in a local `.env` file, then run:

```sh
docker compose up --build -d
```

For Docker, `IMMICH_URL` must resolve *inside the container*. Configure local DNS or use an Immich host name reachable on your network. If your Immich HTTPS certificate uses a private CA, mount that CA into the container and point `NODE_EXTRA_CA_CERTS` to it; the host's trusted certificates are not automatically available in the container. The `.env` file is excluded from the image and ignored by git.

## Integration and limits

This version uses the official `@immich/sdk` 3.2.2, matched to an Immich server reporting 3.2.2. It checks the server's major/minor version before reading or importing assets. If you upgrade Immich, update and test the SDK against your instance before continuing. The app uses SDK search, album lookup, thumbnail, album create, add-assets-to-album, and bulk-upload-check methods. Full originals are streamed to Immich's supported asset-upload API. It does not access Immich's database or filesystem.

Immich search loads up to 500 assets per review. Apple Photos review loads up to 5,000. Both say when more match the range; narrow the dates for larger libraries. Album membership on the Immich **all assets** view uses Immich's per-asset album lookup, so that view can take longer for a large date range. Screenshots and cameras are filtered within the loaded date range. Grouping uses a six-hour gap and 50 km location threshold when both assets have coordinates; it does not call an AI model yet.

Run `npm run typecheck`, `npm test`, and `npm run build` to verify a change. Tests mock the SDK; a configured Immich instance is needed for a live check.
