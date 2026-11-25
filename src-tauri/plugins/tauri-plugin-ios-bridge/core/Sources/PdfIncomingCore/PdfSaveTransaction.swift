import CryptoKit
import Foundation

public enum PdfSaveError: Error, Equatable {
    case invalid, incomplete, busy, inaccessible, changed, unverified, unavailable

    public var message: String {
        switch self {
        case .invalid: return "Bitte einen gültigen PDF-Dateinamen und eine PDF bis 150 MB verwenden."
        case .incomplete: return "Die PDF wurde nicht vollständig an die App übergeben."
        case .busy: return "Ein Dateidialog oder ein Speichervorgang ist bereits aktiv."
        case .inaccessible: return "iPadOS hat den Dateizugriff verweigert. Bitte erneut auswählen oder eine Kopie speichern."
        case .changed: return "Die ausgewählte Datei entspricht nicht der geöffneten PDF. Bitte eine Kopie speichern."
        case .unverified: return "Die Zieldatei konnte nicht überprüft werden. Die Änderungen bleiben in der App ungesichert."
        case .unavailable: return "Die PDF konnte nicht gespeichert werden. Bitte eine Kopie an einem anderen Ort speichern."
        }
    }
}

public struct PdfFingerprint: Equatable {
    public static let maximumBytes = 150 * 1024 * 1024
    public let byteCount: Int
    public let digest: Data

    public static func read(_ file: URL) throws -> Self {
        let properties = try file.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
        guard properties.isRegularFile == true, properties.isSymbolicLink != true,
              properties.fileSize.map({ $0 <= maximumBytes }) ?? true
        else { throw PdfSaveError.invalid }

        let input = try FileHandle(forReadingFrom: file)
        defer { try? input.close() }
        var hash = SHA256()
        var count = 0
        while let bytes = try input.read(upToCount: min(64 * 1024, maximumBytes - count + 1)), !bytes.isEmpty {
            count += bytes.count
            guard count <= maximumBytes else { throw PdfSaveError.invalid }
            hash.update(data: bytes)
        }
        return Self(byteCount: count, digest: Data(hash.finalize()))
    }
}

public final class PdfSaveTransaction {
    public static let chunkSize = 256 * 1024
    public let id = UUID()
    public let suggestedName: String
    private let directory: URL
    private var file: URL
    private let byteLength: Int
    private var output: FileHandle?
    private var received = 0
    private var header = Data()
    private var checksum = SHA256()

    public init(root: URL, fileName: String, byteLength: Int) throws {
        suggestedName = try Self.pdfName(fileName)
        guard (5...PdfFingerprint.maximumBytes).contains(byteLength) else { throw PdfSaveError.invalid }
        self.byteLength = byteLength
        directory = root.appendingPathComponent(id.uuidString, isDirectory: true)
        file = directory.appendingPathComponent("staged")
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            guard FileManager.default.createFile(atPath: file.path, contents: nil, attributes: [.posixPermissions: 0o600])
            else { throw PdfSaveError.unavailable }
            output = try FileHandle(forWritingTo: file)
        } catch {
            try? FileManager.default.removeItem(at: directory)
            throw error
        }
    }

    deinit { cleanup() }

    public static func pdfName(_ value: String) throws -> String {
        let name = value
        let result = name.lowercased().hasSuffix(".pdf") ? name : name + ".pdf"
        guard result.utf8.count <= 255, name != ".", name != "..",
              !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, !name.hasPrefix("."),
              !name.contains("/"), !name.contains("\\"),
              !name.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) })
        else { throw PdfSaveError.invalid }
        return result
    }

    public func append(offset: Int, base64: String) throws -> Int {
        guard let output, offset == received,
              base64.utf8.count <= 4 * ((Self.chunkSize + 2) / 3),
              let bytes = Data(base64Encoded: base64),
              bytes.count == min(Self.chunkSize, byteLength - received), !bytes.isEmpty
        else { throw PdfSaveError.incomplete }

        if header.count < 5 { header.append(bytes.prefix(5 - header.count)) }
        guard Data("%PDF-".utf8).starts(with: header) else { throw PdfSaveError.invalid }
        try output.write(contentsOf: bytes)
        checksum.update(data: bytes)
        received += bytes.count
        return received
    }

    public func seal() throws -> PdfFingerprint {
        guard let output, received == byteLength else { throw PdfSaveError.incomplete }
        try output.synchronize()
        try output.close()
        self.output = nil
        let expected = PdfFingerprint(byteCount: received, digest: Data(checksum.finalize()))
        try Self.verify(file, expected: expected)
        return expected
    }

    public func exportFile(named name: String) throws -> URL {
        guard output == nil else { throw PdfSaveError.incomplete }
        let target = directory.appendingPathComponent(try Self.pdfName(name))
        if file != target {
            try FileManager.default.moveItem(at: file, to: target)
            file = target
        }
        return file
    }

    public func cleanup() {
        try? output?.close()
        output = nil
        try? FileManager.default.removeItem(at: directory)
    }

    public static func verify(_ file: URL, expected: PdfFingerprint) throws {
        guard (try? PdfFingerprint.read(file)) == expected else { throw PdfSaveError.unverified }
    }

    public static func verifyExport(_ url: URL, expected: PdfFingerprint) throws {
        try withAccess(url) {
            let coordinator = NSFileCoordinator(filePresenter: nil)
            var error: NSError?
            var result: Result<Void, Error>?
            coordinator.coordinate(readingItemAt: url, options: .withoutChanges, error: &error) { target in
                result = Result { try verify(target, expected: expected) }
            }
            guard let result else { throw PdfSaveError.unverified }
            try result.get()
        }
    }

    public static func replace(
        _ url: URL, with staged: URL, original: PdfFingerprint, expected: PdfFingerprint
    ) throws {
        try withAccess(url) {
            let coordinator = NSFileCoordinator(filePresenter: nil)
            var error: NSError?
            var result: Result<Void, Error>?
            coordinator.coordinate(writingItemAt: url, options: .forReplacing, error: &error) { target in
                result = Result {
                    guard try PdfFingerprint.read(target) == original else { throw PdfSaveError.changed }
                    let manager = FileManager.default
                    // The replacement lives on the destination volume. If the
                    // provider cannot support replacement, leave the original intact.
                    let directory = try manager.url(
                        for: .itemReplacementDirectory, in: .userDomainMask,
                        appropriateFor: target, create: true
                    )
                    defer { try? manager.removeItem(at: directory) }
                    let replacement = directory.appendingPathComponent(target.lastPathComponent)
                    try manager.copyItem(at: staged, to: replacement)
                    try verify(replacement, expected: expected)
                    let saved = try manager.replaceItemAt(target, withItemAt: replacement) ?? target
                    try verify(saved, expected: expected)
                }
            }
            guard let result else { throw PdfSaveError.inaccessible }
            do {
                try result.get()
            } catch let error as NSError where error.domain == NSCocoaErrorDomain &&
                (error.code == NSFileReadNoPermissionError || error.code == NSFileWriteNoPermissionError) {
                throw PdfSaveError.inaccessible
            }
        }
    }

    private static func withAccess<T>(_ url: URL, _ work: () throws -> T) throws -> T {
        guard url.isFileURL else { throw PdfSaveError.inaccessible }
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let root = URL(fileURLWithPath: NSHomeDirectory()).resolvingSymlinksInPath().path
        guard scoped || url.resolvingSymlinksInPath().path.hasPrefix(root + "/") else {
            throw PdfSaveError.inaccessible
        }
        return try work()
    }
}
