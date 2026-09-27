import Darwin
import Foundation

enum BridgeFailure: LocalizedError {
    case pathTooLong
    case alreadyRunning
    case socketFailure(String)

    var errorDescription: String? {
        switch self {
        case .pathTooLong: return "The local socket path is too long."
        case .alreadyRunning: return "Another Image Genie Photos companion is already running."
        case .socketFailure(let message): return message
        }
    }
}

final class PhotoSocketServer {
    private var listeningSocket: Int32 = -1
    private let queue = DispatchQueue(label: "image-genie.photos.socket", qos: .userInitiated)
    static let socketURL = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Application Support/ImageGenie/photos.sock")

    func start() throws {
        let directory = Self.socketURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        _ = chmod(directory.path, 0o700)
        let (address, length) = try Self.address(for: Self.socketURL.path)

        if FileManager.default.fileExists(atPath: Self.socketURL.path) {
            let attributes = try FileManager.default.attributesOfItem(atPath: Self.socketURL.path)
            guard attributes[.type] as? FileAttributeType == .typeSocket else {
                throw BridgeFailure.socketFailure("A non-socket file occupies the bridge path.")
            }
            let probe = socket(AF_UNIX, SOCK_STREAM, 0)
            var probeAddress = address
            let live = withUnsafePointer(to: &probeAddress) { pointer in
                pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.connect(probe, $0, length) == 0 }
            }
            Darwin.close(probe)
            if live { throw BridgeFailure.alreadyRunning }
            _ = unlink(Self.socketURL.path)
        }

        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { throw BridgeFailure.socketFailure("Could not create the bridge socket.") }
        var bindAddress = address
        let bound = withUnsafePointer(to: &bindAddress) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.bind(fd, $0, length) }
        }
        guard bound == 0, listen(fd, 16) == 0 else {
            Darwin.close(fd)
            throw BridgeFailure.socketFailure("Could not listen on the bridge socket.")
        }
        _ = chmod(Self.socketURL.path, 0o600)
        listeningSocket = fd
        PhotoCatalog.clearStaleStaging()
        queue.async { [weak self] in self?.acceptLoop() }
    }

    deinit {
        if listeningSocket >= 0 { Darwin.close(listeningSocket) }
        _ = unlink(Self.socketURL.path)
    }

    private static func address(for path: String) throws -> (sockaddr_un, socklen_t) {
        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        let bytes = Array(path.utf8CString)
        let capacity = MemoryLayout.size(ofValue: address.sun_path)
        guard bytes.count <= capacity else { throw BridgeFailure.pathTooLong }
        let offset = MemoryLayout<sockaddr_un>.offset(of: \.sun_path) ?? 2
        bytes.withUnsafeBytes { source in
            withUnsafeMutablePointer(to: &address) { pointer in
                UnsafeMutableRawPointer(pointer).advanced(by: offset).copyMemory(from: source.baseAddress!, byteCount: bytes.count)
            }
        }
        address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
        return (address, socklen_t(MemoryLayout<sockaddr_un>.size))
    }

    private func acceptLoop() {
        while listeningSocket >= 0 {
            let client = accept(listeningSocket, nil, nil)
            if client < 0 { continue }
            DispatchQueue.global(qos: .userInitiated).async { Self.handle(client) }
        }
    }

    private static func handle(_ client: Int32) {
        defer { Darwin.close(client) }
        var noSigPipe: Int32 = 1
        _ = setsockopt(client, SOL_SOCKET, SO_NOSIGPIPE, &noSigPipe, socklen_t(MemoryLayout<Int32>.size))
        var request = Data()
        while request.count < 8192 && !request.contains(Data("\r\n\r\n".utf8)) {
            var chunk = [UInt8](repeating: 0, count: 2048)
            let count = chunk.withUnsafeMutableBytes { Darwin.read(client, $0.baseAddress, $0.count) }
            if count <= 0 { return }
            request.append(contentsOf: chunk.prefix(count))
        }
        guard let firstLine = String(data: request, encoding: .utf8)?.components(separatedBy: "\r\n").first,
              let target = firstLine.split(separator: " ").dropFirst().first,
              firstLine.hasPrefix("GET "),
              let url = URLComponents(string: "http://localhost\(target)") else {
            send(client, status: 400, body: json(["error": "Invalid request"])); return
        }
        let query = Dictionary((url.queryItems ?? []).map { ($0.name, $0.value ?? "") }, uniquingKeysWith: { first, _ in first })
        switch url.path {
        case "/status":
            send(client, status: 200, body: json(["state": PhotoCatalog.authorization, "version": 2]))
        case "/assets":
            guard PhotoCatalog.canRead else { send(client, status: 403, body: json(["error": "Apple Photos access is not allowed"])); return }
            guard let start = parseDate(query["start"]), let end = parseDate(query["end"]), start < end,
                  end.timeIntervalSince(start) <= 366 * 86400 else {
                send(client, status: 400, body: json(["error": "Invalid date range"])); return
            }
            guard let offset = Int(query["offset"] ?? "0"), offset >= 0, offset <= 100000 else {
                send(client, status: 400, body: json(["error": "Invalid offset"])); return
            }
            let page = PhotoCatalog.assets(start: start, end: end, offset: offset)
            send(client, status: 200, body: (try? JSONEncoder().encode(page)) ?? json(["error": "Encoding failed"]))
        case "/thumbnail", "/preview":
            guard PhotoCatalog.canRead else { send(client, status: 403, body: json(["error": "Apple Photos access is not allowed"])); return }
            guard let id = query["id"], !id.isEmpty, id.count <= 300 else {
                send(client, status: 400, body: json(["error": "Invalid asset ID"])); return
            }
            let result = url.path == "/preview"
                ? PhotoCatalog.preview(id: id, allowCloud: query["cloud"] == "1")
                : PhotoCatalog.thumbnail(id: id, allowCloud: query["cloud"] == "1")
            if let data = result.data { send(client, status: 200, body: data, contentType: "image/jpeg") }
            else if result.inCloud { send(client, status: 409, body: json(["error": "Preview is in iCloud"])); }
            else { send(client, status: 404, body: json(["error": "Preview unavailable"])); }
        case "/stage":
            guard PhotoCatalog.canRead else { send(client, status: 403, body: json(["error": "Apple Photos access is not allowed"])); return }
            guard let id = query["id"], !id.isEmpty, id.count <= 300 else {
                send(client, status: 400, body: json(["error": "Invalid asset ID"])); return
            }
            do {
                let staged = try PhotoCatalog.stage(id: id)
                send(client, status: 200, body: try JSONEncoder().encode(staged))
            } catch {
                send(client, status: 422, body: json(["error": error.localizedDescription]))
            }
        case "/release":
            guard let token = query["token"], UUID(uuidString: token) != nil else {
                send(client, status: 400, body: json(["error": "Invalid staging token"])); return
            }
            PhotoCatalog.release(token: token)
            send(client, status: 200, body: json(["released": true]))
        default:
            send(client, status: 404, body: json(["error": "Not found"]));
        }
    }

    private static func parseDate(_ text: String?) -> Date? {
        guard let text = text else { return nil }
        return PhotoCatalog.formatter.date(from: text) ?? ISO8601DateFormatter().date(from: text)
    }

    private static func json(_ value: [String: Any]) -> Data {
        (try? JSONSerialization.data(withJSONObject: value)) ?? Data("{}".utf8)
    }

    private static func send(_ client: Int32, status: Int, body: Data, contentType: String = "application/json") {
        let reason: String
        switch status {
        case 200: reason = "OK"
        case 400: reason = "Bad Request"
        case 403: reason = "Forbidden"
        case 404: reason = "Not Found"
        case 409: reason = "Conflict"
        case 422: reason = "Unprocessable Content"
        default: reason = "Error"
        }
        let header = "HTTP/1.1 \(status) \(reason)\r\nContent-Type: \(contentType)\r\nContent-Length: \(body.count)\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n"
        writeAll(client, Data(header.utf8))
        writeAll(client, body)
    }

    private static func writeAll(_ client: Int32, _ data: Data) {
        data.withUnsafeBytes { raw in
            guard let base = raw.baseAddress else { return }
            var offset = 0
            while offset < raw.count {
                let count = Darwin.write(client, base.advanced(by: offset), raw.count - offset)
                if count <= 0 { break }
                offset += count
            }
        }
    }
}
