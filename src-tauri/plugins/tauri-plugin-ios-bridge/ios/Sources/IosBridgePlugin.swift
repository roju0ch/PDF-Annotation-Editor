import Foundation
import PdfIncomingCore
import Tauri

private struct StageIncomingPdfArgs: Decodable {
    let uri: String
    let cacheDirectory: String
}

final class IosBridgePlugin: Plugin {
    private let imports = DispatchQueue(label: "pdf.incoming.ios", qos: .userInitiated)

    @objc public func stageIncomingPdf(_ invoke: Invoke) {
        let args: StageIncomingPdfArgs
        do {
            args = try invoke.parseArgs(StageIncomingPdfArgs.self)
        } catch {
            invoke.reject(PdfIncomingError.invalid.message, code: PdfIncomingError.invalid.code)
            return
        }
        // Holding the security scope and coordinating the read happen together
        // on a background queue, including every close/error/cleanup path.
        imports.async {
            do {
                let result = try PdfIncomingReader().stage(
                    uri: args.uri,
                    cacheDirectory: URL(fileURLWithPath: args.cacheDirectory, isDirectory: true)
                )
                invoke.resolve(result)
            } catch let error as PdfIncomingError {
                invoke.reject(error.message, code: error.code)
            } catch {
                // NSError may contain a private provider URI/path. Do not log
                // it or include it in the IPC error payload.
                invoke.reject(PdfIncomingError.unavailable.message, code: PdfIncomingError.unavailable.code)
            }
        }
    }
}

@_cdecl("init_plugin_ios_bridge")
public func initPlugin() -> Plugin {
    IosBridgePlugin()
}
