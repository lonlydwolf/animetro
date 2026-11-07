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
      return decisionHandler(.allow)
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
  func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) { markFullScreen() }
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

  // Messages from the page. "look": the livery's mode and page color, so the title bar and window match (and
  // the next launch opens in them). "save": a share card as base64 PNG, saved through a normal Save dialog
  // (a web view can't download files on its own).
  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    guard let body = message.body as? [String: Any] else { return }
    if body["type"] as? String == "look", let mode = body["mode"] as? String, let bg = body["bg"] as? String {
      look(mode: mode, bg: bg)
      UserDefaults.standard.set(mode, forKey: "mode")
      UserDefaults.standard.set(bg, forKey: "bg")
      return
    }
    guard body["type"] as? String == "save",
          let name = body["name"] as? String, let b64 = body["data"] as? String, let data = Data(base64Encoded: b64) else { return }
    let panel = NSSavePanel()
    panel.nameFieldStringValue = name
    panel.allowedContentTypes = [.png]
    panel.beginSheetModal(for: window) { response in
      guard response == .OK, let url = panel.url else { return }
      do { try data.write(to: url) } catch { NSAlert(error: error).runModal() }
    }
  }

  func look(mode: String, bg: String) {
    window.appearance = NSAppearance(named: mode == "light" ? .aqua : .darkAqua)
    guard bg.count == 7, bg.hasPrefix("#"), let v = Int(bg.dropFirst(), radix: 16) else { return }
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
