import Foundation
import PdfIncomingCore
import Tauri
import UIKit
import UniformTypeIdentifiers
import WebKit

private struct StageIncomingPdfArgs: Decodable {
    let uri: String
    let id: UUID
    let cacheDirectory: String
}

private struct BeginSaveArgs: Decodable {
    let fileName: String
    let byteLength: Int
}

private struct AppendSaveArgs: Decodable {
    let token: UUID
    let offset: Int
    let base64: String
}

private struct FinishSaveArgs: Decodable {
    let token: UUID
    let sourceId: UUID?
    let replaceOriginal: Bool
}

private struct TokenArgs: Decodable {
    let token: UUID
}

private struct Original {
    let name: String
    let fingerprint: PdfFingerprint
    let directory: URL?
}

@MainActor
private final class DocumentPickerDelegate: NSObject, UIDocumentPickerDelegate, UIAdaptivePresentationControllerDelegate {
    private var completion: ((URL?) -> Void)?

    init(completion: @escaping (URL?) -> Void) {
        self.completion = completion
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        complete(urls.first, dismissing: controller)
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        complete(nil, dismissing: controller)
    }

    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        complete(nil, dismissing: presentationController.presentedViewController)
    }

    private func complete(_ url: URL?, dismissing controller: UIViewController) {
        guard let completion else { return }
        self.completion = nil
        if let transition = controller.transitionCoordinator,
           transition.animate(alongsideTransition: nil, completion: { _ in completion(url) }) {
            return
        }
        if controller.presentingViewController != nil {
            controller.dismiss(animated: true) { completion(url) }
        } else {
            completion(url)
        }
    }
}

final class IosBridgePlugin: Plugin {
    // State and I/O belong to one serial queue. Presenter and picker lifetime
    // belong to the main thread. No provider path is sent to JavaScript.
    private let io = DispatchQueue(label: "pdf.files.ios", qos: .userInitiated)
    private weak var webview: WKWebView?
    private var pickerDelegate: DocumentPickerDelegate?
    private var picked: [(UUID, URL)] = []
    private var originals: [(UUID, Original)] = []
    private var save: PdfSaveTransaction?
    private var finishing = false
    private var uploadExpiry: DispatchWorkItem?
    private lazy var saveRoot: URL = {
        let root = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("pdf-ipados-export", isDirectory: true)
        // Recover abandoned app-private staging after process termination.
        try? FileManager.default.removeItem(at: root)
        return root
    }()

    override public func load(webview: WKWebView) {
        self.webview = webview
        io.async { _ = self.saveRoot }
    }

    @objc public func pickIncomingPdf(_ invoke: Invoke) {
        DispatchQueue.main.async {
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.pdf], asCopy: false)
            do {
                try self.present(picker) { url in
                    guard let url else { invoke.resolve([String: String]()); return }
                    self.io.async {
                        let id = UUID()
                        if self.picked.count >= 8 { self.picked.removeFirst() }
                        self.picked.append((id, url))
                        invoke.resolve(["token": id.uuidString])
                    }
                }
            } catch { invoke.reject(PdfIncomingError.unavailable.message, code: PdfIncomingError.unavailable.code) }
        }
    }

    @objc public func stageIncomingPdf(_ invoke: Invoke) {
        let args: StageIncomingPdfArgs
        do {
            args = try invoke.parseArgs(StageIncomingPdfArgs.self)
        } catch {
            invoke.reject(PdfIncomingError.invalid.message, code: PdfIncomingError.invalid.code)
            return
        }
        io.async {
            do {
                let directory = URL(fileURLWithPath: args.cacheDirectory, isDirectory: true)
                let reader = PdfIncomingReader()
                let result: StagedIncomingPdf
                var originalDirectory: URL?
                if args.uri.hasPrefix("picked:") {
                    guard let id = UUID(uuidString: String(args.uri.dropFirst("picked:".count))),
                          let index = self.picked.firstIndex(where: { $0.0 == id })
                    else { throw PdfIncomingError.denied }
                    let source = self.picked.remove(at: index).1
                    result = try reader.stage(source: source, cacheDirectory: directory)
                    originalDirectory = source.deletingLastPathComponent()
                } else {
                    result = try reader.stage(uri: args.uri, cacheDirectory: directory)
                }
                // The fingerprint belongs to the exact bytes accepted by Rust.
                // Files imports can be copies, so only an explicit new selection
                // can ever authorize replacement.
                if let fingerprint = try? PdfFingerprint.read(URL(fileURLWithPath: result.path)) {
                    self.remember(args.id, Original(name: result.fileName, fingerprint: fingerprint, directory: originalDirectory))
                }
                invoke.resolve(result)
            } catch let error as PdfIncomingError {
                invoke.reject(error.message, code: error.code)
            } catch {
                invoke.reject(PdfIncomingError.unavailable.message, code: PdfIncomingError.unavailable.code)
            }
        }
    }

    @objc public func beginPdfSave(_ invoke: Invoke) {
        io.async {
            do {
                let args = try invoke.parseArgs(BeginSaveArgs.self)
                guard self.save == nil else { throw PdfSaveError.busy }
                let save = try PdfSaveTransaction(root: self.saveRoot, fileName: args.fileName, byteLength: args.byteLength)
                self.save = save
                self.expireUpload(save.id)
                invoke.resolve(["token": save.id.uuidString])
            } catch { self.reject(invoke, error) }
        }
    }

    @objc public func appendPdfSave(_ invoke: Invoke) {
        io.async {
            do {
                let args = try invoke.parseArgs(AppendSaveArgs.self)
                guard let save = self.save, save.id == args.token, !self.finishing else { throw PdfSaveError.invalid }
                let received = try save.append(offset: args.offset, base64: args.base64)
                self.expireUpload(save.id)
                invoke.resolve(["received": received])
            } catch { self.reject(invoke, error) }
        }
    }

    @objc public func abortPdfSave(_ invoke: Invoke) {
        io.async {
            do {
                let args = try invoke.parseArgs(TokenArgs.self)
                if !self.finishing, self.save?.id == args.token { self.clearSave() }
                invoke.resolve()
            } catch { self.reject(invoke, error) }
        }
    }

    @objc public func finishPdfSave(_ invoke: Invoke) {
        io.async {
            do {
                let args = try invoke.parseArgs(FinishSaveArgs.self)
                guard let save = self.save, save.id == args.token, !self.finishing else { throw PdfSaveError.invalid }
                let original = self.originals.first(where: { $0.0 == args.sourceId })?.1
                if args.replaceOriginal && original == nil { throw PdfSaveError.inaccessible }
                let expected = try save.seal()
                let staged = try save.exportFile(named: save.suggestedName)
                self.finishing = true
                self.uploadExpiry?.cancel()
                self.uploadExpiry = nil
                DispatchQueue.main.async {
                    self.presentSave(invoke, token: save.id, staged: staged, expected: expected,
                                     original: original, replace: args.replaceOriginal)
                }
            } catch {
                // A rejected duplicate finish must not remove a live picker transfer.
                self.reject(invoke, error)
            }
        }
    }

    @MainActor
    private func presentSave(
        _ invoke: Invoke, token: UUID, staged: URL, expected: PdfFingerprint, original: Original?, replace: Bool
    ) {
        let picker = replace
            ? UIDocumentPickerViewController(forOpeningContentTypes: [.pdf], asCopy: false)
            : UIDocumentPickerViewController(forExporting: [staged], asCopy: true)
        picker.directoryURL = original?.directory
        do {
            try present(picker) { url in
                guard let url else { self.complete(invoke, token: token, status: "cancelled"); return }
                if replace, let original {
                    self.confirmReplacement(invoke, token: token, target: url, staged: staged,
                                            original: original, expected: expected)
                } else {
                    self.store(invoke, token: token, target: url, staged: staged, expected: expected, original: nil)
                }
            }
        } catch {
            complete(invoke, token: token, error: error)
        }
    }

    @MainActor
    private func confirmReplacement(
        _ invoke: Invoke, token: UUID, target: URL, staged: URL, original: Original, expected: PdfFingerprint
    ) {
        guard target.lastPathComponent.precomposedStringWithCanonicalMapping == original.name.precomposedStringWithCanonicalMapping else {
            complete(invoke, token: token, error: PdfSaveError.changed)
            return
        }
        guard let presenter else { complete(invoke, token: token, error: PdfSaveError.unavailable); return }
        let dialog = UIAlertController(title: "Original ersetzen?",
                                       message: "Die Datei „\(target.lastPathComponent)“ wird durch die bearbeitete PDF ersetzt.",
                                       preferredStyle: .alert)
        dialog.addAction(UIAlertAction(title: "Abbrechen", style: .cancel) { _ in
            self.complete(invoke, token: token, status: "cancelled")
        })
        dialog.addAction(UIAlertAction(title: "Original ersetzen", style: .destructive) { _ in
            self.store(invoke, token: token, target: target, staged: staged, expected: expected, original: original)
        })
        presenter.present(dialog, animated: true)
    }

    private func store(
        _ invoke: Invoke, token: UUID, target: URL, staged: URL, expected: PdfFingerprint, original: Original?
    ) {
        io.async {
            do {
                let name = try PdfSaveTransaction.pdfName(target.lastPathComponent)
                guard name == target.lastPathComponent else { throw PdfSaveError.unverified }
                if let original {
                    try PdfSaveTransaction.replace(target, with: staged, original: original.fingerprint, expected: expected)
                } else {
                    try PdfSaveTransaction.verifyExport(target, expected: expected)
                }
                self.remember(token, Original(name: name, fingerprint: expected, directory: target.deletingLastPathComponent()))
                self.clearSave()
                invoke.resolve(["status": "saved", "fileName": name])
            } catch {
                self.clearSave()
                self.reject(invoke, error)
            }
        }
    }

    private func complete(_ invoke: Invoke, token: UUID, status: String? = nil, error: Error? = nil) {
        io.async {
            guard self.save?.id == token else { return }
            self.clearSave()
            if let status { invoke.resolve(["status": status]) }
            else { self.reject(invoke, error ?? PdfSaveError.unavailable) }
        }
    }

    @MainActor
    private var presenter: UIViewController? {
        guard let window = webview?.window, let root = window.rootViewController,
              root.presentedViewController == nil
        else { return nil }
        if let scene = window.windowScene {
            guard scene.activationState == .foregroundActive else { return nil }
        } else {
            guard UIApplication.shared.applicationState == .active else { return nil }
        }
        return root
    }

    @MainActor
    private func present(_ picker: UIDocumentPickerViewController, completion: @escaping (URL?) -> Void) throws {
        guard pickerDelegate == nil, let presenter else { throw PdfSaveError.busy }
        let delegate = DocumentPickerDelegate { [weak self] url in
            self?.pickerDelegate = nil
            completion(url)
        }
        pickerDelegate = delegate
        picker.delegate = delegate
        picker.presentationController?.delegate = delegate
        presenter.present(picker, animated: true)
    }

    private func clearSave() {
        uploadExpiry?.cancel()
        uploadExpiry = nil
        save?.cleanup()
        save = nil
        finishing = false
    }

    private func expireUpload(_ token: UUID) {
        uploadExpiry?.cancel()
        let expiry = DispatchWorkItem { [weak self] in
            guard let self, self.save?.id == token, !self.finishing else { return }
            self.clearSave()
        }
        uploadExpiry = expiry
        io.asyncAfter(deadline: .now() + .seconds(120), execute: expiry)
    }

    private func remember(_ id: UUID, _ original: Original) {
        originals.removeAll { $0.0 == id }
        if originals.count >= 32 { originals.removeFirst() }
        originals.append((id, original))
    }

    private func reject(_ invoke: Invoke, _ error: Error) {
        invoke.reject((error as? PdfSaveError ?? .unavailable).message)
    }
}

@_cdecl("init_plugin_ios_bridge")
public func initPlugin() -> Plugin {
    IosBridgePlugin()
}
