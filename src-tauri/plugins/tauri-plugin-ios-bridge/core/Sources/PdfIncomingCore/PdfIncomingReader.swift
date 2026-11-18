import Darwin
import Foundation

public struct StagedIncomingPdf: Encodable {
    public let path: String
    public let fileName: String
    public let byteLength: Int
}

public enum PdfIncomingError: Error, Equatable {
    case invalid
    case denied
    case tooLarge
    case unavailable

    public var code: String {
        switch self {
        case .invalid: return "invalid"
        case .denied: return "denied"
        case .tooLarge: return "too-large"
        case .unavailable: return "unavailable"
        }
    }

    public var message: String {
        switch self {
        case .invalid, .tooLarge:
            return "Bitte eine gültige PDF-Datei auswählen (maximal 100 MB)."
        case .denied:
            return "Die PDF konnte nicht geöffnet werden. Bitte den Dateizugriff erlauben und erneut versuchen."
        case .unavailable:
            return "Die PDF konnte nicht geöffnet werden. Bitte die Datei erneut über ‚Öffnen mit‘ auswählen."
        }
    }
}

/// The real implementation holds the OS grant until the coordinated copy ends.
/// A protocol makes grant ownership/error paths testable with real local files.
public protocol PdfSecurityScope {
    func start(_ url: URL) -> Bool
    func stop(_ url: URL)
}

public struct SystemPdfSecurityScope: PdfSecurityScope {
    public init() {}
    public func start(_ url: URL) -> Bool { url.startAccessingSecurityScopedResource() }
    public func stop(_ url: URL) { url.stopAccessingSecurityScopedResource() }
}

public final class PdfIncomingReader {
    public static let maximumBytes = 100 * 1024 * 1024
    private let container: URL
    private let scope: PdfSecurityScope
    private let maximum: Int
    private let manager: FileManager

    public init(
        container: URL = URL(fileURLWithPath: NSHomeDirectory(), isDirectory: true),
        scope: PdfSecurityScope = SystemPdfSecurityScope(),
        maximumBytes: Int = PdfIncomingReader.maximumBytes,
        manager: FileManager = .default
    ) {
        self.container = container.standardizedFileURL.resolvingSymlinksInPath()
        self.scope = scope
        self.maximum = min(maximumBytes, Self.maximumBytes)
        self.manager = manager
    }

    public func stage(uri: String, cacheDirectory: URL) throws -> StagedIncomingPdf {
        guard maximum >= 5, uri.utf8.count <= 16 * 1024,
              let source = URL(string: uri), source.isFileURL,
              source.path.hasPrefix("/"), source.query == nil, source.fragment == nil,
              !source.path.unicodeScalars.contains(where: { $0.value == 0 }),
              source.host == nil || source.host == "" || source.host == "localhost",
              cacheDirectory.isFileURL, Self.contains(cacheDirectory, in: container)
        else { throw PdfIncomingError.invalid }

        let accessed = scope.start(source)
        // Open In may copy a PDF into our Documents/Inbox. Such app-container
        // files need no security scope. External files must have an actual grant.
        guard accessed || Self.contains(source, in: container) else {
            throw PdfIncomingError.denied
        }
        defer { if accessed { scope.stop(source) } }

        let coordinator = NSFileCoordinator(filePresenter: nil)
        var coordinatorError: NSError?
        var result: Result<StagedIncomingPdf, Error>?
        coordinator.coordinate(readingItemAt: source, options: .withoutChanges, error: &coordinatorError) {
            coordinatedURL in
            result = Result { try self.copy(coordinatedURL, cacheDirectory: cacheDirectory) }
        }
        if let result {
            do { return try result.get() }
            catch let error as PdfIncomingError { throw error }
            catch { throw Self.safeError(error) }
        }
        if let coordinatorError { throw Self.safeError(coordinatorError) }
        throw PdfIncomingError.unavailable
    }

    private func copy(_ source: URL, cacheDirectory: URL) throws -> StagedIncomingPdf {
        let properties = try source.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
        guard properties.isRegularFile == true else { throw PdfIncomingError.invalid }
        if let knownSize = properties.fileSize, knownSize > maximum { throw PdfIncomingError.tooLarge }

        try manager.createDirectory(
            at: cacheDirectory, withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        // Resolve again after creation: an unexpected cache symlink must not
        // allow a private staging file to escape the application's container.
        guard Self.contains(cacheDirectory, in: container) else { throw PdfIncomingError.invalid }
        let target = cacheDirectory.appendingPathComponent("pdf-incoming-\(UUID().uuidString).tmp")
        let descriptor = target.path.withCString { Darwin.open($0, O_WRONLY | O_CREAT | O_EXCL, mode_t(0o600)) }
        guard descriptor >= 0 else { throw PdfIncomingError.unavailable }
        let output = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
        var completed = false
        defer {
            try? output.close()
            if !completed { try? manager.removeItem(at: target) }
        }
        let input = try FileHandle(forReadingFrom: source)
        defer { try? input.close() }
        var length = 0
        var header = Data()
        while true {
            // Read at most one byte beyond the limit, never an unbounded file
            // or provider buffer. Oversized/growing inputs remove their partial.
            let requested = min(64 * 1024, maximum - length + 1)
            guard let chunk = try input.read(upToCount: requested), !chunk.isEmpty else { break }
            guard chunk.count <= maximum - length else { throw PdfIncomingError.tooLarge }
            if header.count < 1024 { header.append(chunk.prefix(1024 - header.count)) }
            try output.write(contentsOf: chunk)
            length += chunk.count
        }
        guard length >= 5, header.range(of: Data("%PDF-".utf8)) != nil else {
            throw PdfIncomingError.invalid
        }
        try output.synchronize()
        try output.close()
        completed = true
        return StagedIncomingPdf(
            path: target.path,
            fileName: Self.safeName(source.lastPathComponent),
            byteLength: length
        )
    }

    private static func contains(_ url: URL, in directory: URL) -> Bool {
        let path = url.standardizedFileURL.resolvingSymlinksInPath().path
        let root = directory.standardizedFileURL.resolvingSymlinksInPath().path
        return path.hasPrefix(root.hasSuffix("/") ? root : root + "/")
    }

    private static func safeName(_ value: String) -> String {
        guard !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              value.utf16.count <= 255,
              !value.contains("/"), !value.contains("\\"),
              value.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) })
        else { return "Dokument.pdf" }
        return value
    }

    private static func safeError(_ error: Error) -> PdfIncomingError {
        let native = error as NSError
        if native.domain == NSCocoaErrorDomain,
           native.code == NSFileReadNoPermissionError || native.code == NSFileWriteNoPermissionError {
            return .denied
        }
        return .unavailable
    }
}
