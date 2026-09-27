import AppKit
import Photos

struct CatalogAsset: Encodable {
    let id: String
    let capturedAt: String
    let filename: String
    let camera: String?
    let source: String
    let location: String?
    let latitude: Double?
    let longitude: Double?
    let albums: [String]
    let people: [String]
    let isScreenshot: Bool
    let type: String
    let provider: String
}

struct CatalogPage: Encodable {
    let assets: [CatalogAsset]
    let total: Int
    let capped: Bool
}

struct StagedFile: Encodable {
    let path: String
    let filename: String
    let size: Int64
}

struct StagedAsset: Encodable {
    let token: String
    let capturedAt: String
    let photo: StagedFile
    let motion: StagedFile?
}

enum StagingError: LocalizedError {
    case notFound
    case unsupported
    case downloadFailed(String)

    var errorDescription: String? {
        switch self {
        case .notFound: return "This Photos asset is no longer available."
        case .unsupported: return "This Photos asset has no original image or video resource."
        case .downloadFailed(let message): return "Could not load the original from Photos or iCloud: \(message)"
        }
    }
}

enum PhotoCatalog {
    static let maxAssets = 500
    static let formatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    static var authorization: String {
        switch PHPhotoLibrary.authorizationStatus(for: .readWrite) {
        case .authorized: return "authorized"
        case .limited: return "limited"
        case .denied: return "denied"
        case .restricted: return "restricted"
        case .notDetermined: return "not-determined"
        @unknown default: return "unknown"
        }
    }

    static var canRead: Bool { authorization == "authorized" || authorization == "limited" }

    private static var stagingDirectory: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/ImageGenie/staging", isDirectory: true)
    }

    static func stage(id: String) throws -> StagedAsset {
        guard let asset = PHAsset.fetchAssets(withLocalIdentifiers: [id], options: nil).firstObject else {
            throw StagingError.notFound
        }
        let resources = PHAssetResource.assetResources(for: asset)
        let originalTypes: [PHAssetResourceType] = asset.mediaType == .video ? [.video, .fullSizeVideo] : [.photo, .fullSizePhoto]
        guard let original = originalTypes.compactMap({ type in resources.first(where: { $0.type == type }) }).first else {
            throw StagingError.unsupported
        }
        let motion = resources.first(where: { $0.type == .pairedVideo || $0.type == .fullSizePairedVideo })
        let token = UUID().uuidString
        let directory = stagingDirectory.appendingPathComponent(token, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        _ = chmod(stagingDirectory.path, 0o700)
        _ = chmod(directory.path, 0o700)
        do {
            let photo = try write(original, role: "original", into: directory)
            let paired = try motion.map { try write($0, role: "motion", into: directory) }
            return StagedAsset(token: token, capturedAt: formatter.string(from: asset.creationDate ?? Date()), photo: photo, motion: paired)
        } catch {
            try? FileManager.default.removeItem(at: directory)
            throw error
        }
    }

    static func release(token: String) {
        guard UUID(uuidString: token) != nil else { return }
        try? FileManager.default.removeItem(at: stagingDirectory.appendingPathComponent(token, isDirectory: true))
    }

    static func clearStaleStaging() {
        guard let directories = try? FileManager.default.contentsOfDirectory(at: stagingDirectory, includingPropertiesForKeys: [.isDirectoryKey]) else { return }
        for directory in directories where UUID(uuidString: directory.lastPathComponent) != nil {
            try? FileManager.default.removeItem(at: directory)
        }
    }

    private static func write(_ resource: PHAssetResource, role: String, into directory: URL) throws -> StagedFile {
        let originalName = (resource.originalFilename as NSString).lastPathComponent.isEmpty ? role : (resource.originalFilename as NSString).lastPathComponent
        let fileExtension = (originalName as NSString).pathExtension
        let destination = directory.appendingPathComponent(role + (fileExtension.isEmpty ? "" : ".\(fileExtension)"))
        let options = PHAssetResourceRequestOptions()
        options.isNetworkAccessAllowed = true
        let completion = DispatchSemaphore(value: 0)
        var failure: Error?
        PHAssetResourceManager.default().writeData(for: resource, toFile: destination, options: options) { error in
            failure = error
            completion.signal()
        }
        guard completion.wait(timeout: .now() + 1800) == .success else {
            throw StagingError.downloadFailed("Timed out waiting for iCloud")
        }
        if let failure { throw StagingError.downloadFailed(failure.localizedDescription) }
        let size = (try FileManager.default.attributesOfItem(atPath: destination.path)[.size] as? NSNumber)?.int64Value ?? 0
        guard size > 0 else { throw StagingError.downloadFailed("Original resource is empty") }
        _ = chmod(destination.path, 0o600)
        return StagedFile(path: destination.path, filename: originalName, size: size)
    }

    static func assets(start: Date, end: Date, offset: Int = 0) -> CatalogPage {
        let options = PHFetchOptions()
        options.predicate = NSPredicate(format: "creationDate >= %@ AND creationDate < %@", start as NSDate, end as NSDate)
        options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        let found = PHAsset.fetchAssets(with: options)
        var items: [CatalogAsset] = []
        let lowerBound = min(offset, found.count)
        let upperBound = min(found.count, lowerBound + maxAssets)
        items.reserveCapacity(upperBound - lowerBound)
        for index in lowerBound..<upperBound {
            let asset = found.object(at: index)
            guard let date = asset.creationDate else { continue }
            let resource = PHAssetResource.assetResources(for: asset).first
            let coordinates = asset.location?.coordinate
            let collections = PHAssetCollection.fetchAssetCollectionsContaining(asset, with: .album, options: nil)
            var albumNames: [String] = []
            collections.enumerateObjects { collection, _, _ in
                if let title = collection.localizedTitle { albumNames.append(title) }
            }
            let source: String
            if asset.sourceType.contains(.typeCloudShared) { source = "iCloud Shared" }
            else if asset.sourceType.contains(.typeiTunesSynced) { source = "Synced" }
            else { source = "Apple Photos" }
            items.append(CatalogAsset(
                id: asset.localIdentifier,
                capturedAt: formatter.string(from: date),
                filename: resource?.originalFilename ?? "Untitled",
                camera: nil,
                source: source,
                location: coordinates.map { String(format: "%.4f, %.4f", $0.latitude, $0.longitude) },
                latitude: coordinates?.latitude,
                longitude: coordinates?.longitude,
                albums: albumNames,
                people: [],
                isScreenshot: asset.mediaSubtypes.contains(.photoScreenshot),
                type: asset.mediaType == .video ? "VIDEO" : "IMAGE",
                provider: "apple"
            ))
        }
        return CatalogPage(assets: items, total: found.count, capped: found.count > upperBound)
    }

    static func thumbnail(id: String, allowCloud: Bool) -> (data: Data?, inCloud: Bool) {
        image(id: id, allowCloud: allowCloud, targetSize: CGSize(width: 400, height: 320), contentMode: .aspectFill)
    }

    static func preview(id: String, allowCloud: Bool) -> (data: Data?, inCloud: Bool) {
        image(id: id, allowCloud: allowCloud, targetSize: CGSize(width: 2400, height: 2400), contentMode: .aspectFit)
    }

    private static func image(id: String, allowCloud: Bool, targetSize: CGSize, contentMode: PHImageContentMode) -> (data: Data?, inCloud: Bool) {
        guard let asset = PHAsset.fetchAssets(withLocalIdentifiers: [id], options: nil).firstObject else { return (nil, false) }
        let options = PHImageRequestOptions()
        options.isSynchronous = true
        options.isNetworkAccessAllowed = allowCloud
        options.deliveryMode = .highQualityFormat
        options.resizeMode = .exact
        var result: NSImage?
        var inCloud = false
        PHImageManager.default().requestImage(
            for: asset,
            targetSize: targetSize,
            contentMode: contentMode,
            options: options
        ) { image, info in
            result = image
            inCloud = info?[PHImageResultIsInCloudKey] as? Bool ?? false
        }
        guard let image = result,
              let tiff = image.tiffRepresentation,
              let bitmap = NSBitmapImageRep(data: tiff),
              let data = bitmap.representation(using: .jpeg, properties: [.compressionFactor: 0.78]) else {
            return (nil, inCloud)
        }
        return (data, false)
    }
}
