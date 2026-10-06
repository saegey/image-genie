import Photos
import SwiftUI

@main
struct ImageGeniePhotosApp: App {
    @StateObject private var model = BridgeModel()

    var body: some Scene {
        WindowGroup("Image Genie Photos") {
            VStack(alignment: .leading, spacing: 18) {
                Image(systemName: "photo.on.rectangle.angled")
                    .font(.system(size: 38))
                    .foregroundStyle(.green)
                Text("Apple Photos connection")
                    .font(.title2.bold())
                Text("Image Genie can show Photos metadata and previews, prepare originals for Immich, and delete selected assets after you confirm in Image Genie.")
                    .foregroundStyle(.secondary)
                HStack(spacing: 8) {
                    Circle().fill(model.socketReady ? Color.green : Color.orange).frame(width: 8, height: 8)
                    Text(model.socketReady ? "Local connection ready" : "Local connection unavailable")
                }
                Text("Photos access: \(model.authorizationLabel)")
                if model.authorizationLabel == "Not requested" || model.authorizationLabel == "Denied" {
                    Button("Allow Photos access") { model.requestAccess() }
                        .buttonStyle(.borderedProminent)
                }
                if model.authorizationLabel == "Limited" {
                    Text("Full Photos library access is needed to delete items. Change Image Genie Photos access in System Settings.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                if let error = model.error {
                    Text(error).foregroundStyle(.red).font(.footnote)
                }
                Text("Keep this app open while reviewing, importing, or deleting Apple Photos in Image Genie.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            .padding(28)
            .frame(width: 440, height: 320)
        }
        .windowResizability(.contentSize)
    }
}

final class BridgeModel: ObservableObject {
    @Published var authorizationLabel = "Not requested"
    @Published var socketReady = false
    @Published var error: String?
    private let server = PhotoSocketServer()

    init() {
        refreshAuthorization()
        do {
            try server.start()
            socketReady = true
        } catch {
            self.error = "Could not start the local bridge: \(error.localizedDescription)"
        }
    }

    func requestAccess() {
        PHPhotoLibrary.requestAuthorization(for: .readWrite) { [weak self] _ in
            DispatchQueue.main.async { self?.refreshAuthorization() }
        }
    }

    private func refreshAuthorization() {
        switch PHPhotoLibrary.authorizationStatus(for: .readWrite) {
        case .authorized: authorizationLabel = "Allowed"
        case .limited: authorizationLabel = "Limited"
        case .denied: authorizationLabel = "Denied"
        case .restricted: authorizationLabel = "Restricted"
        case .notDetermined: authorizationLabel = "Not requested"
        @unknown default: authorizationLabel = "Unknown"
        }
    }
}
