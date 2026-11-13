// Animetro for macOS: the web app in a native window, no server.
// The HTML/JS/CSS ship inside the app and load through an animetro:// scheme
// (ES modules refuse to load from file://). AniList login redirects to animetro://auth,
// which this window catches before it goes anywhere.
//
// Dev mode: ANIMETRO_WEB=/path/to/animetro/web serves the files straight from that folder, so an edit
// only needs Cmd+R (see macos/dev.sh). Right-click > Inspect Element opens Safari's Web Inspector.
import Cocoa
import WebKit
import UniformTypeIdentifiers

let web = (ProcessInfo.processInfo.environment["ANIMETRO_WEB"].map { URL(fileURLWithPath: $0) }
  ?? Bundle.main.resourceURL!.appendingPathComponent("web")).standardizedFileURL
let home = URL(string: "animetro://app/index.html")!

// Serves files from Contents/Resources/web for animetro://app/<path>.
final class Files: NSObject, WKURLSchemeHandler, URLSessionTaskDelegate {
  var live = Set<ObjectIdentifier>() // image fetches still waiting; WebKit may cancel them first
  lazy var session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)

  func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
    let url = task.request.url!
    let path = url.path.isEmpty || url.path == "/" ? "index.html" : String(url.path.dropFirst())
    if path == "__image" { return image(task, url) }
    let file = web.appendingPathComponent(path).standardizedFileURL
    guard file.path.hasPrefix(web.path + "/"), let data = try? Data(contentsOf: file) else { return reply(task, url, nil, nil) }
    reply(task, url, data, UTType(filenameExtension: file.pathExtension)?.preferredMIMEType)
  }
  func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) { live.remove(ObjectIdentifier(task)) }

  // Share cards draw AniList pictures on a canvas, which needs CORS, and AniList's image server answers the
  // animetro:// origin with "Access-Control-Allow-Origin: null", so WebKit drops them. The app fetches them
  // itself and serves them from its own origin: animetro://app/__image?u=<https://…anilist.co/…>.
  func image(_ task: WKURLSchemeTask, _ url: URL) {
    guard let u = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "u" })?.value,
          let remote = URL(string: u), Files.allowed(remote) else { return reply(task, url, nil, nil) }
    let id = ObjectIdentifier(task)
    live.insert(id)
    session.dataTask(with: remote) { data, response, _ in
      DispatchQueue.main.async {
        guard self.live.remove(id) != nil else { return } // the page went away; the task is already stopped
        let type = response?.mimeType ?? ""
        let ok = (response as? HTTPURLResponse)?.statusCode == 200 && type.hasPrefix("image/")
        self.reply(task, url, ok ? data : nil, type)
      }
    }.resume()
  }

  static func allowed(_ url: URL) -> Bool {
    guard url.scheme == "https", let host = url.host?.lowercased() else { return false }
    return host == "anilist.co" || host.hasSuffix(".anilist.co")
  }
  // a redirect has to stay on AniList too, or the fetch stops there (and the card draws without that picture)
  func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                  newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
    completionHandler(request.url.map(Files.allowed) == true ? request : nil)
  }

  // nil data = 404
  func reply(_ task: WKURLSchemeTask, _ url: URL, _ data: Data?, _ type: String?) {
    guard let data else {
      task.didReceive(HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: [:])!)
      return task.didFinish()
    }
    task.didReceive(HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1",
                                    headerFields: ["Content-Type": type ?? "application/octet-stream", "Content-Length": "\(data.count)", "Cache-Control": "no-store"])!)
    task.didReceive(data)
    task.didFinish()
  }
}

final class App: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
  var window: NSWindow!
  var view: WKWebView!
  var titleWatch: NSKeyValueObservation?
  let selfTest = ProcessInfo.processInfo.environment["ANIMETRO_SELFTEST"] != nil
  var savingScores = 0 // scores Rapid rating is still sending to AniList; the page reports it, leaving drops them

  func applicationDidFinishLaunching(_ note: Notification) {
    let config = WKWebViewConfiguration()
    config.setURLSchemeHandler(Files(), forURLScheme: "animetro")
    config.websiteDataStore = .default() // keeps your login and settings between launches
    config.userContentController.add(self, name: "animetro") // the page asks for native help here (saving images)
    view = WKWebView(frame: .zero, configuration: config)
    view.navigationDelegate = self
    view.uiDelegate = self
    view.allowsBackForwardNavigationGestures = true
    if #available(macOS 13.3, *) { view.isInspectable = true } // right-click > Inspect Element
    view.setValue(false, forKey: "drawsBackground") // no white flash before the dark page paints

    window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 860),
                      styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
    window.title = "Animetro"
    window.delegate = self
    window.titlebarAppearsTransparent = true
    window.titleVisibility = .hidden // the page's header shows the name; the title still names the window in menus and Mission Control
    look(mode: UserDefaults.standard.string(forKey: "mode") ?? "dark", bg: UserDefaults.standard.string(forKey: "bg") ?? "#131833")
    window.minSize = NSSize(width: 420, height: 500)
    window.contentView = view
    window.center()
    window.setFrameAutosaveName("Animetro")
    window.makeKeyAndOrderFront(nil)
    titleWatch = view.observe(\.title) { [weak self] v, _ in self?.window.title = v.title?.isEmpty == false ? v.title! : "Animetro" }

    NSApp.mainMenu = menu()
    view.load(URLRequest(url: home))
    NSApp.activate(ignoringOtherApps: true)
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { true }

  // A web view can't run beforeunload for a closing window or a quitting app, so ask here. done(true) = leave.
  func leaveWhileSaving(_ done: @escaping (Bool) -> Void) {
    guard savingScores > 0 else { return done(true) }
    guard window.attachedSheet == nil else { return done(false) } // already asking (or saving a card)
    let n = savingScores, alert = NSAlert()
    alert.messageText = "Your scores are still saving"
    alert.informativeText = "Animetro is still sending \(n) score\(n == 1 ? "" : "s") to AniList. If you leave now, \(n == 1 ? "it" : "they") won't be saved."
    alert.addButton(withTitle: "Stay")
    alert.addButton(withTitle: "Leave Anyway")
    alert.beginSheetModal(for: window) { done($0 == .alertSecondButtonReturn) }
  }
  func windowShouldClose(_ sender: NSWindow) -> Bool {
    guard savingScores > 0 else { return true }
    leaveWhileSaving { if $0 { self.savingScores = 0; sender.close() } }
    return false
  }
  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    guard savingScores > 0 else { return .terminateNow }
    guard window.attachedSheet == nil else { return .terminateCancel }
    leaveWhileSaving { NSApp.reply(toApplicationShouldTerminate: $0) }
    return .terminateLater
  }

  // Stay inside the app for Animetro pages and AniList login; open everything else in your browser.
  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    guard let url = action.request.url else { return decisionHandler(.cancel) }
    if url.scheme == "animetro" && url.host == "auth" {
      // AniList sends the token here as #access_token=...; api.js picks it up from pass.html's hash.
      var page = URLComponents(string: "animetro://app/pass.html")!
      page.fragment = url.fragment ?? URLComponents(url: url, resolvingAgainstBaseURL: false)?.query
      webView.load(URLRequest(url: page.url!))
      return decisionHandler(.cancel)
    }
    let mainFrame = action.targetFrame?.isMainFrame ?? true
    if url.scheme == "animetro" || !mainFrame || url.host == "anilist.co" || url.scheme == "about" {
      guard mainFrame, savingScores > 0 else { return decisionHandler(.allow) }
      return leaveWhileSaving { decisionHandler($0 ? .allow : .cancel) } // links, Back, Reload: same question
    }
    NSWorkspace.shared.open(url)
    decisionHandler(.cancel)
  }

  // target="_blank" links (streaming sites, AniList profile) go to your browser.
  func webView(_ webView: WKWebView, createWebViewWith config: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    if let url = action.request.url { NSWorkspace.shared.open(url) }
    return nil
  }

  // The page leaves room for the close/minimize/zoom buttons, which full screen hides; tell each page which it is.
  func windowDidEnterFullScreen(_ note: Notification) { markFullScreen() }
  func windowDidExitFullScreen(_ note: Notification) { markFullScreen() }
  func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) { savingScores = 0; markFullScreen() } // a new page has nothing in flight
  func markFullScreen() {
    view.evaluateJavaScript("document.documentElement.toggleAttribute('data-fullscreen', \(window.styleMask.contains(.fullScreen)))")
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    guard selfTest else { return }
    // ANIMETRO_SELFTEST=1: check the page booted, storage works, AniList answers and card pictures draw, print JSON, quit.
    let js = """
      // wait for the page to say it loaded (or failed), up to 15 seconds
      for (let i = 0; i < 60 && !document.documentElement.dataset.ready; i++) await new Promise(r => setTimeout(r, 250));
      localStorage.setItem('animetro.selftest', '1');
      const stored = localStorage.getItem('animetro.selftest') === '1';
      localStorage.removeItem('animetro.selftest');
      const api = await fetch('https://graphql.anilist.co', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: '{ Media(id: 1) { id } }' }), signal: AbortSignal.timeout(8000) }).then(r => r.json()).then(j => j.data.Media.id === 1).catch(() => false);
      // share cards: an AniList picture through the app's image route must draw on a canvas that can still be saved
      const card = await new Promise(r => { const i = new Image(); setTimeout(() => r(false), 8000);
        i.onload = () => { try { const c = document.createElement('canvas'); c.getContext('2d').drawImage(i, 0, 0); c.toDataURL(); r(true); } catch { r(false); } };
        i.onerror = () => r(false);
        i.src = '__image?u=' + encodeURIComponent('https://s4.anilist.co/file/anilistcdn/media/anime/cover/small/bx1-GCsPm7waJ4kS.png'); });
      return JSON.stringify({ ready: document.documentElement.dataset.ready || 'timeout', header: !!document.querySelector('header.top'), page: document.querySelector('main')?.innerText.slice(0, 60),
        stored, api, card, title: document.title, secure: isSecureContext, clipboard: !!navigator.clipboard,
        native: !!window.webkit?.messageHandlers?.animetro, web: '\(web.path)' });
      """
    webView.callAsyncJavaScript(js, arguments: [:], in: nil, in: .page) { result in
      switch result {
      case .success(let value): print(value as? String ?? String(describing: value))
      case .failure(let error): print("{\"error\": \"\(error.localizedDescription)\"}")
      }
      exit(0)
    }
  }

  // Messages from the page. "busy": how many scores Rapid rating is still saving. "look": the livery's mode and page color, so the title bar and window match (and
  // the next launch opens in them). "save": a share card as base64 PNG, saved through a normal Save dialog
  // (a web view can't download files on its own).
  // Only Animetro's own pages may ask: the main frame, served from animetro://app. AniList's login page also loads
  // in this window, and any frame can reach the handler, so everything else is ignored, as is any odd-shaped message.
  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    let origin = message.frameInfo.securityOrigin
    guard message.frameInfo.isMainFrame, origin.protocol == "animetro", origin.host == "app",
          let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
    if type == "look", let mode = body["mode"] as? String, mode == "light" || mode == "dark",
       let bg = body["bg"] as? String, App.isHexColor(bg) {
      look(mode: mode, bg: bg)
      UserDefaults.standard.set(mode, forKey: "mode")
      UserDefaults.standard.set(bg, forKey: "bg")
      return
    }
    if type == "busy" {
      guard let n = body["n"] as? Int, (0...10_000).contains(n) else { return }
      savingScores = n
      return
    }
    // a share card is a 1200×675 PNG, a few hundred KB; anything near 16 MB of base64 is not one
    guard type == "save", let name = body["name"] as? String, (1...255).contains(name.count),
          let b64 = body["data"] as? String, b64.utf8.count <= 16 << 20, let data = Data(base64Encoded: b64),
          data.starts(with: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) else { return } // PNG signature
    let panel = NSSavePanel()
    panel.nameFieldStringValue = name
    panel.allowedContentTypes = [.png]
    panel.beginSheetModal(for: window) { response in
      guard response == .OK, let url = panel.url else { return }
      do { try data.write(to: url) } catch { NSAlert(error: error).runModal() }
    }
  }

  static func isHexColor(_ s: String) -> Bool {
    s.utf8.count == 7 && s.hasPrefix("#") && s.dropFirst().allSatisfy(\.isHexDigit)
  }
  func look(mode: String, bg: String) {
    window.appearance = NSAppearance(named: mode == "light" ? .aqua : .darkAqua)
    guard App.isHexColor(bg), let v = Int(bg.dropFirst(), radix: 16) else { return }
    window.backgroundColor = NSColor(red: CGFloat(v >> 16 & 255) / 255, green: CGFloat(v >> 8 & 255) / 255, blue: CGFloat(v & 255) / 255, alpha: 1)
  }

  @objc func goHome() { view.load(URLRequest(url: home)) }
  @objc func goBack() { view.goBack() }
  @objc func goForward() { view.goForward() }
  @objc func reload() { view.reload() }
  @objc func find() { view.evaluateJavaScript("document.querySelector('.top-search input, #q')?.focus()") }

  func menu() -> NSMenu {
    let bar = NSMenu()
    func add(_ title: String, _ items: [NSMenuItem]) {
      let top = NSMenuItem(), sub = NSMenu(title: title)
      items.forEach(sub.addItem)
      top.submenu = sub
      bar.addItem(top)
    }
    func item(_ title: String, _ action: Selector?, _ key: String, _ mods: NSEvent.ModifierFlags = .command) -> NSMenuItem {
      let i = NSMenuItem(title: title, action: action, keyEquivalent: key)
      i.keyEquivalentModifierMask = mods
      return i
    }
    add("Animetro", [item("About Animetro", #selector(NSApplication.orderFrontStandardAboutPanel(_:)), ""), .separator(),
                     item("Hide Animetro", #selector(NSApplication.hide(_:)), "h"),
                     item("Quit Animetro", #selector(NSApplication.terminate(_:)), "q")])
    // Without an Edit menu, ⌘C / ⌘V don't work in text fields.
    add("Edit", [item("Undo", Selector(("undo:")), "z"), item("Redo", Selector(("redo:")), "z", [.command, .shift]), .separator(),
                 item("Cut", #selector(NSText.cut(_:)), "x"), item("Copy", #selector(NSText.copy(_:)), "c"),
                 item("Paste", #selector(NSText.paste(_:)), "v"), item("Select All", #selector(NSText.selectAll(_:)), "a")])
    add("Go", [item("Home", #selector(goHome), "h", [.command, .shift]), item("Find a Series", #selector(find), "f"),
               item("Back", #selector(goBack), "["), item("Forward", #selector(goForward), "]"), item("Reload", #selector(reload), "r")])
    add("Window", [item("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m"), item("Zoom", #selector(NSWindow.performZoom(_:)), ""),
                   item("Close", #selector(NSWindow.performClose(_:)), "w")])
    return bar
  }
}

let app = NSApplication.shared
let delegate = App()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
