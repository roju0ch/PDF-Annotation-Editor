import Foundation
import XCTest
@testable import PdfIncomingCore

private final class RecordingScope: PdfSecurityScope {
    var granted: Bool
    var starts = 0
    var stops = 0
    init(_ granted: Bool) { self.granted = granted }
    func start(_ url: URL) -> Bool { starts += 1; return granted }
    func stop(_ url: URL) { stops += 1 }
}

final class PdfIncomingReaderTests: XCTestCase {
    private var root: URL!
    private var container: URL!
    private var cache: URL!
    private let manager = FileManager.default
    private let pdf = Data("%PDF-1.7\nsynthetic-local-test\n%%EOF\n".utf8)

    override func setUpWithError() throws {
        root = manager.temporaryDirectory.appendingPathComponent("pdf-ios-tests-\(UUID().uuidString)")
        container = root.appendingPathComponent("container", isDirectory: true)
        cache = container.appendingPathComponent("Library/Caches/test.pdf/pdf-incoming", isDirectory: true)
        try manager.createDirectory(at: container, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try manager.removeItem(at: root)
    }

    private func source(_ name: String = "Plan.pdf", bytes: Data? = nil, external: Bool = false) throws -> URL {
        let directory = external ? root.appendingPathComponent("external", isDirectory: true) : container.appendingPathComponent("Documents/Inbox", isDirectory: true)
        try manager.createDirectory(at: directory, withIntermediateDirectories: true)
        let url = directory.appendingPathComponent(name)
        try (bytes ?? pdf).write(to: url)
        return url
    }

    private func stagedFiles() throws -> [String] {
        guard manager.fileExists(atPath: cache.path) else { return [] }
        return try manager.contentsOfDirectory(atPath: cache.path)
    }

    func testCopiedInboxPdfNeedsNoSecurityGrantAndPreservesUnicodeNameAndBytes() throws {
        let original = try source("Plan EG äöü # + 你好.pdf")
        let scope = RecordingScope(false)
        let result = try PdfIncomingReader(container: container, scope: scope).stage(uri: original.absoluteString, cacheDirectory: cache)
        XCTAssertEqual(result.fileName, original.lastPathComponent)
        XCTAssertEqual(result.byteLength, pdf.count)
        XCTAssertEqual(try Data(contentsOf: URL(fileURLWithPath: result.path)), pdf)
        XCTAssertEqual(try Data(contentsOf: original), pdf)
        XCTAssertEqual(scope.starts, 1)
        XCTAssertEqual(scope.stops, 0)
        XCTAssertTrue(result.path.hasPrefix(cache.path + "/pdf-incoming-"))
    }

    func testExternalPdfIsCopiedWithBalancedSecurityScope() throws {
        let original = try source(external: true)
        let scope = RecordingScope(true)
        let result = try PdfIncomingReader(container: container, scope: scope).stage(uri: original.absoluteString, cacheDirectory: cache)
        XCTAssertEqual(try Data(contentsOf: URL(fileURLWithPath: result.path)), pdf)
        XCTAssertEqual(scope.starts, 1)
        XCTAssertEqual(scope.stops, 1)
    }

    func testExternalFileWithoutGrantIsDeniedWithoutCreatingStaging() throws {
        let original = try source(external: true)
        let scope = RecordingScope(false)
        XCTAssertThrowsError(try PdfIncomingReader(container: container, scope: scope).stage(uri: original.absoluteString, cacheDirectory: cache)) {
            XCTAssertEqual($0 as? PdfIncomingError, .denied)
        }
        XCTAssertEqual(try stagedFiles(), [])
        XCTAssertEqual(scope.stops, 0)
        XCTAssertEqual(try Data(contentsOf: original), pdf)
    }

    func testNetworkAndNonFileUrisAreRejectedBeforeRequestingScope() throws {
        for uri in ["https://example.invalid/plan.pdf", "file://example.invalid/plan.pdf", "content://provider/plan", "file:relative.pdf", "file:///tmp/a.pdf?private=1"] {
            let scope = RecordingScope(true)
            XCTAssertThrowsError(try PdfIncomingReader(container: container, scope: scope).stage(uri: uri, cacheDirectory: cache)) {
                XCTAssertEqual($0 as? PdfIncomingError, .invalid)
            }
            XCTAssertEqual(scope.starts, 0)
        }
        XCTAssertEqual(try stagedFiles(), [])
    }

    func testContainerSymlinkCannotBypassDeniedExternalGrant() throws {
        let external = try source(external: true)
        let link = container.appendingPathComponent("linked.pdf")
        try manager.createSymbolicLink(at: link, withDestinationURL: external)
        XCTAssertThrowsError(try PdfIncomingReader(container: container, scope: RecordingScope(false)).stage(uri: link.absoluteString, cacheDirectory: cache)) {
            XCTAssertEqual($0 as? PdfIncomingError, .denied)
        }
        XCTAssertEqual(try stagedFiles(), [])
    }

    func testCacheSymlinkCannotWriteOutsideContainer() throws {
        let original = try source()
        let outside = root.appendingPathComponent("outside", isDirectory: true)
        try manager.createDirectory(at: outside, withIntermediateDirectories: true)
        let linkedCache = container.appendingPathComponent("cache-link", isDirectory: true)
        try manager.createSymbolicLink(at: linkedCache, withDestinationURL: outside)
        let scope = RecordingScope(true)
        XCTAssertThrowsError(try PdfIncomingReader(container: container, scope: scope).stage(uri: original.absoluteString, cacheDirectory: linkedCache)) {
            XCTAssertEqual($0 as? PdfIncomingError, .invalid)
        }
        XCTAssertEqual(try manager.contentsOfDirectory(atPath: outside.path), [])
        XCTAssertEqual(scope.starts, 0)
    }

    func testNonPdfCleansPartialAndReleasesScopeWithoutChangingSource() throws {
        let bytes = Data("this is not a PDF".utf8)
        let original = try source(bytes: bytes, external: true)
        let scope = RecordingScope(true)
        XCTAssertThrowsError(try PdfIncomingReader(container: container, scope: scope).stage(uri: original.absoluteString, cacheDirectory: cache)) {
            XCTAssertEqual($0 as? PdfIncomingError, .invalid)
        }
        XCTAssertEqual(scope.stops, 1)
        XCTAssertEqual(try stagedFiles(), [])
        XCTAssertEqual(try Data(contentsOf: original), bytes)
    }

    func testOversizedPdfIsRejectedAndReleasesScope() throws {
        let original = try source(bytes: pdf + Data(repeating: 65, count: 100), external: true)
        let scope = RecordingScope(true)
        XCTAssertThrowsError(try PdfIncomingReader(container: container, scope: scope, maximumBytes: 64).stage(uri: original.absoluteString, cacheDirectory: cache)) {
            XCTAssertEqual($0 as? PdfIncomingError, .tooLarge)
        }
        XCTAssertEqual(scope.stops, 1)
        XCTAssertEqual(try stagedFiles(), [])
    }

    func testExactLimitMultiBlockPdfIsCopiedWithoutTruncation() throws {
        let bytes = pdf + Data(repeating: 84, count: 131072 - pdf.count)
        let original = try source(bytes: bytes)
        let result = try PdfIncomingReader(container: container, scope: RecordingScope(false), maximumBytes: bytes.count).stage(uri: original.absoluteString, cacheDirectory: cache)
        XCTAssertEqual(result.byteLength, bytes.count)
        XCTAssertEqual(try Data(contentsOf: URL(fileURLWithPath: result.path)), bytes)
    }

    func testPdfHeaderWithinFirst1024BytesMatchesExistingImportPipeline() throws {
        let bytes = Data(repeating: 32, count: 512) + pdf
        let original = try source(bytes: bytes)
        let result = try PdfIncomingReader(container: container, scope: RecordingScope(false)).stage(uri: original.absoluteString, cacheDirectory: cache)
        XCTAssertEqual(try Data(contentsOf: URL(fileURLWithPath: result.path)), bytes)
    }

    func testPdfHeaderBeyondFirst1024BytesIsRejectedAndCleaned() throws {
        let original = try source(bytes: Data(repeating: 32, count: 1024) + pdf)
        XCTAssertThrowsError(try PdfIncomingReader(container: container, scope: RecordingScope(false)).stage(uri: original.absoluteString, cacheDirectory: cache)) {
            XCTAssertEqual($0 as? PdfIncomingError, .invalid)
        }
        XCTAssertEqual(try stagedFiles(), [])
    }

    func testDirectoriesCannotBecomeDocuments() throws {
        let directory = container.appendingPathComponent("Documents", isDirectory: true)
        try manager.createDirectory(at: directory, withIntermediateDirectories: true)
        XCTAssertThrowsError(try PdfIncomingReader(container: container, scope: RecordingScope(false)).stage(uri: directory.absoluteString, cacheDirectory: cache)) {
            XCTAssertEqual($0 as? PdfIncomingError, .invalid)
        }
        XCTAssertEqual(try stagedFiles(), [])
    }

    func testMissingFileReturnsOnlyGenericErrorAndReleasesGrant() throws {
        let missing = root.appendingPathComponent("private-provider-path-secret.pdf")
        let scope = RecordingScope(true)
        XCTAssertThrowsError(try PdfIncomingReader(container: container, scope: scope).stage(uri: missing.absoluteString, cacheDirectory: cache)) {
            guard let error = $0 as? PdfIncomingError else { return XCTFail("Unsafe native error escaped") }
            XCTAssertFalse(error.message.contains("private-provider-path-secret"))
            XCTAssertFalse(error.message.contains(root.path))
        }
        XCTAssertEqual(scope.stops, 1)
        XCTAssertEqual(try stagedFiles(), [])
    }

    func testControlCharactersInFilenameUseSafeDisplayFallback() throws {
        let original = try source("bad\nname.pdf")
        let result = try PdfIncomingReader(container: container, scope: RecordingScope(false)).stage(uri: original.absoluteString, cacheDirectory: cache)
        XCTAssertEqual(result.fileName, "Dokument.pdf")
    }

    func testCacheFailurePreservesPreexistingFileAndReleasesGrant() throws {
        let original = try source()
        let occupied = container.appendingPathComponent("occupied-cache")
        try Data("leave me".utf8).write(to: occupied)
        let scope = RecordingScope(true)
        XCTAssertThrowsError(try PdfIncomingReader(container: container, scope: scope).stage(uri: original.absoluteString, cacheDirectory: occupied))
        XCTAssertEqual(try Data(contentsOf: occupied), Data("leave me".utf8))
        XCTAssertEqual(scope.stops, 1)
    }

    func testPrivateStagingPermissionsAndDistinctCopies() throws {
        let original = try source()
        let reader = PdfIncomingReader(container: container, scope: RecordingScope(false))
        let first = try reader.stage(uri: original.absoluteString, cacheDirectory: cache)
        let second = try reader.stage(uri: original.absoluteString, cacheDirectory: cache)
        XCTAssertNotEqual(first.path, second.path)
        let permissions = try XCTUnwrap(manager.attributesOfItem(atPath: first.path)[.posixPermissions] as? NSNumber)
        XCTAssertEqual(permissions.intValue & 0o777, 0o600)
        XCTAssertEqual(try Data(contentsOf: URL(fileURLWithPath: first.path)), pdf)
        XCTAssertEqual(try Data(contentsOf: URL(fileURLWithPath: second.path)), pdf)
    }
}
