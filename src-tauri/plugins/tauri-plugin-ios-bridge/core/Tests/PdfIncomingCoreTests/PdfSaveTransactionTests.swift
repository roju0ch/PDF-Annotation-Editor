import Foundation
import XCTest
@testable import PdfIncomingCore

final class PdfSaveTransactionTests: XCTestCase {
    private var directory: URL!
    private let bytes = Data("%PDF-1.7\nsynthetic test\n%%EOF\n".utf8)

    override func setUpWithError() throws {
        directory = URL(fileURLWithPath: NSHomeDirectory())
            .appendingPathComponent("pdf-save-test-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
    }

    override func tearDownWithError() throws {
        try FileManager.default.removeItem(at: directory)
    }

    private func transaction(for data: Data, name: String = "Plan ä # +.pdf") throws -> PdfSaveTransaction {
        try PdfSaveTransaction(root: directory, fileName: name, byteLength: data.count)
    }

    func testBoundedChunksRoundTripAndCleanup() throws {
        let data = bytes + Data(repeating: 42, count: PdfSaveTransaction.chunkSize)
        let tx = try transaction(for: data)
        let split = PdfSaveTransaction.chunkSize
        XCTAssertThrowsError(try tx.append(offset: 0, base64: data.base64EncodedString()))
        XCTAssertThrowsError(try tx.append(offset: 1, base64: data.prefix(split).base64EncodedString()))
        XCTAssertEqual(try tx.append(offset: 0, base64: data.prefix(split).base64EncodedString()), split)
        XCTAssertThrowsError(try tx.seal()) { XCTAssertEqual($0 as? PdfSaveError, .incomplete) }
        XCTAssertEqual(try tx.append(offset: split, base64: data.dropFirst(split).base64EncodedString()), data.count)
        let fingerprint = try tx.seal()
        let saved = try tx.exportFile(named: tx.suggestedName)
        XCTAssertEqual(saved.lastPathComponent, "Plan ä # +.pdf")
        XCTAssertEqual(try Data(contentsOf: saved), data)
        try PdfSaveTransaction.verifyExport(saved, expected: fingerprint)
        tx.cleanup()
        XCTAssertFalse(FileManager.default.fileExists(atPath: saved.path))
    }

    func testAbortedOrInvalidTransferLeavesNoTemporaryFile() throws {
        let tx = try transaction(for: bytes)
        let bad = Data(repeating: 1, count: bytes.count)
        XCTAssertThrowsError(try tx.append(offset: 0, base64: bad.base64EncodedString())) {
            XCTAssertEqual($0 as? PdfSaveError, .invalid)
        }
        tx.cleanup()
        XCTAssertTrue(try FileManager.default.contentsOfDirectory(atPath: directory.path).isEmpty)
        XCTAssertThrowsError(try transaction(for: bytes, name: "../escape.pdf"))
    }

    func testVerifiedCopyRejectsMissingAccessOrDifferentContents() throws {
        let tx = try transaction(for: bytes)
        _ = try tx.append(offset: 0, base64: bytes.base64EncodedString())
        let fingerprint = try tx.seal()
        let local = directory.appendingPathComponent("Auswahl.pdf")
        try Data(repeating: 0, count: bytes.count).write(to: local)
        XCTAssertThrowsError(try PdfSaveTransaction.verifyExport(local, expected: fingerprint)) {
            XCTAssertEqual($0 as? PdfSaveError, .unverified)
        }
        let outside = FileManager.default.temporaryDirectory.appendingPathComponent("pdf-test-\(UUID().uuidString).pdf")
        try bytes.write(to: outside)
        defer { try? FileManager.default.removeItem(at: outside) }
        XCTAssertThrowsError(try PdfSaveTransaction.verifyExport(outside, expected: fingerprint)) {
            XCTAssertEqual($0 as? PdfSaveError, .inaccessible)
        }
    }

    func testReplacesOnlyAnUnchangedOriginalAndVerifiesNewBytes() throws {
        let original = directory.appendingPathComponent("Original.pdf")
        try bytes.write(to: original)
        let opened = try PdfFingerprint.read(original)
        let edited = bytes + Data("edit".utf8)
        let tx = try transaction(for: edited)
        _ = try tx.append(offset: 0, base64: edited.base64EncodedString())
        let expected = try tx.seal()
        let staged = try tx.exportFile(named: "Original.pdf")
        try PdfSaveTransaction.replace(original, with: staged, original: opened, expected: expected)
        XCTAssertEqual(try PdfFingerprint.read(original), expected)
        XCTAssertThrowsError(try PdfSaveTransaction.replace(original, with: staged, original: opened, expected: expected)) {
            XCTAssertEqual($0 as? PdfSaveError, .changed)
        }
        XCTAssertEqual(try Data(contentsOf: original), edited)
    }
}
