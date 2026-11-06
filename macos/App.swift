import AppKit
import CoreLocation
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    private var window: NSWindow!
    private var web: WKWebView!
    private var engine: Process?
    private var session: URL?
    private let geocoder = CLGeocoder()

    func applicationDidFinishLaunching(_ notification: Notification) {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.userContentController.add(self, name: "athanbot")
        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.uiDelegate = self
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 780, height: 720),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "AthanBot"
        window.contentMinSize = NSSize(width: 480, height: 460)
        window.contentView = web
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        let menu = NSMenu()
        let appItem = NSMenuItem()
        menu.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Quit AthanBot", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu

        let editItem = NSMenuItem()
        menu.addItem(editItem)
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = editMenu

        NSApp.mainMenu = menu
        let path = Bundle.main.bundleURL.path
        if path.hasPrefix("/Volumes/") || path.contains("/AppTranslocation/") {
            showError("Drag AthanBot to Applications, then open it from there.")
        } else {
            startSetup()
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationWillTerminate(_ notification: Notification) {
        if engine?.isRunning == true { engine?.terminate() }
        web?.configuration.userContentController.removeScriptMessageHandler(forName: "athanbot")
    }

    private func startSetup() {
        guard let resources = Bundle.main.resourceURL else { return showError("AthanBot is missing its resources.") }
        let process = Process()
        process.executableURL = Bundle.main.bundleURL.appendingPathComponent("Contents/MacOS/athanbot-node")
        process.arguments = [resources.appendingPathComponent("src/main.js").path, "app-setup"]
        var env = ProcessInfo.processInfo.environment
        env["ATHANBOT_MAC_AUDIO"] = Bundle.main.bundleURL.appendingPathComponent("Contents/MacOS/athanbot-audio").path
        process.environment = env
        let output = Pipe()
        process.standardOutput = output
        process.standardError = FileHandle.standardError
        engine = process
        output.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            handle.readabilityHandler = nil
            DispatchQueue.main.async {
                guard let line = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
                      let url = URL(string: line), url.scheme == "http", url.host == "127.0.0.1",
                      url.port != nil, url.fragment?.count == 64 else {
                    self?.showError("AthanBot could not open setup.")
                    return
                }
                self?.session = url
                self?.web.load(URLRequest(url: url))
            }
        }
        process.terminationHandler = { [weak self] _ in
            DispatchQueue.main.async {
                if self?.session != nil { self?.showError("AthanBot setup stopped. Quit and reopen the app to try again.") }
            }
        }
        do { try process.run() }
        catch { showError("AthanBot could not start. Move it to Applications or install a fresh copy.") }
    }

    private func showError(_ message: String) {
        let alert = NSAlert()
        alert.messageText = message
        alert.beginSheetModal(for: window)
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url, url.scheme == "http", url.host == "127.0.0.1",
              url.port == session?.port, action.targetFrame?.isMainFrame == true else {
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        showError("AthanBot could not load setup. Quit and reopen the app to try again.")
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.message = "Choose an Athan recording to import."
        panel.beginSheetModal(for: window) { result in completionHandler(result == .OK ? panel.urls : nil) }
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        let origin = message.frameInfo.securityOrigin
        guard message.frameInfo.isMainFrame, origin.protocol == "http", origin.host == "127.0.0.1",
              origin.port == session?.port, let data = message.body as? [String: String] else { return }
        switch data["action"] {
        case "bluetooth":
            if let url = URL(string: "x-apple.systempreferences:com.apple.BluetoothSettings") { NSWorkspace.shared.open(url) }
        case "location":
            let query = (data["query"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard !query.isEmpty, query.count <= 150 else {
                respond("athanbotLocationResult", ["error": "Enter a city and state or country."])
                return
            }
            geocoder.geocodeAddressString(query) { [weak self] results, _ in
                DispatchQueue.main.async {
                    guard let place = results?.first, let location = place.location else {
                        self?.respond("athanbotLocationResult", ["error": "City not found. Try adding the state or country."])
                        return
                    }
                    let label = [place.locality ?? place.name, place.administrativeArea, place.country].compactMap { $0 }.joined(separator: ", ")
                    self?.respond("athanbotLocationResult", [
                        "latitude": location.coordinate.latitude, "longitude": location.coordinate.longitude,
                        "timeZone": place.timeZone?.identifier ?? "", "label": label,
                    ])
                }
            }
        case "installWake":
            installWake()
        default: break
        }
    }

    private func respond(_ method: String, _ data: [String: Any]) {
        guard let encoded = try? JSONSerialization.data(withJSONObject: data),
              let json = String(data: encoded, encoding: .utf8) else { return }
        web.evaluateJavaScript("window.\(method)(\(json))")
    }

    private func installWake() {
        guard let script = Bundle.main.url(forResource: "install-wake", withExtension: "sh") else {
            respond("athanbotWakeResult", ["error": "The sleep playback installer is missing."])
            return
        }
        let alert = NSAlert()
        alert.messageText = "Enable scheduled wake-ups?"
        alert.informativeText = "AthanBot needs administrator approval to schedule wake-ups. Afterward, test with your Mac unplugged and its lid closed."
        alert.addButton(withTitle: "Continue")
        alert.addButton(withTitle: "Cancel")
        alert.beginSheetModal(for: window) { [weak self] choice in
            guard choice == .alertFirstButtonReturn else {
                self?.respond("athanbotWakeResult", ["error": "Sleep playback setup was canceled."])
                return
            }
            let quote: (String) -> String = { "'" + $0.replacingOccurrences(of: "'", with: "'\\''") + "'" }
            let command = "/bin/sh " + quote(script.path) + " " + quote(NSUserName())
            let literal = command.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
            process.arguments = ["-e", "do shell script \"\(literal)\" with administrator privileges"]
            process.standardOutput = FileHandle.nullDevice
            process.standardError = FileHandle.standardError
            process.terminationHandler = { result in
                DispatchQueue.main.async {
                    if result.terminationStatus == 0 { self?.respond("athanbotWakeResult", [:]) }
                    else { self?.respond("athanbotWakeResult", ["error": "Sleep playback was not enabled. Try again and approve the Mac prompt."]) }
                }
            }
            do { try process.run() }
            catch { self?.respond("athanbotWakeResult", ["error": "Could not open the Mac authorization prompt."]) }
        }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.setActivationPolicy(.regular)
app.delegate = delegate
app.run()
