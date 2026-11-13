// Animetro for macOS: the web app in a native window, no server.
// The HTML/JS/CSS ship inside the app and load through an animetro:// scheme
// (ES modules refuse to load from file://). AniList login redirects to animetro://auth,
// which this window catches before it goes anywhere.
//
// Dev mode: ANIMETRO_WEB=/path/to/animetro/web serves the files straight from that folder, so an edit
// only needs Cmd+R (see macos/dev.sh). Only then does right-click > Inspect Element open Safari's Web Inspector.
import Cocoa
import WebKit
import UniformTypeIdentifiers

let devWeb = ProcessInfo.processInfo.environment["ANIMETRO_WEB"]
let web = (devWeb.map { URL(fileURLWithPath: $0) }
  ?? Bundle.main.resourceURL!.appendingPathComponent("web")).standardizedFileURL
let home = URL(string: "animetro://app/index.html")!

// Serves files from Contents/Resources/web for animetro://app/<path>.
final class Files: NSObject, WKURLSchemeHandler, URLSessionDataDelegate {
  // An AniList picture on its way in, for the page's request that asked for it.
  final class Fetch {
    let task: WKURLSchemeTask, url: URL, download: URLSessionDataTask
    var data = Data(), type = ""
    init(_ task: WKURLSchemeTask, _ url: URL, _ download: URLSessionDataTask) { (self.task, self.url, self.download) = (task, url, download) }
  }
  var fetches: [Int: Fetch] = [:] // by download id; WebKit may stop the page's request first
  // delegate calls arrive on the main queue, like WebKit's, so fetches needs no lock
  lazy var session = URLSession(configuration: .default, delegate: self, delegateQueue: .main)
  let allows: (URL) -> Bool // which pictures __image may fetch: AniList's; macos/test.sh points it at a local server
  init(allows: @escaping (URL) -> Bool = Files.allowed) { self.allows = allows }

  func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
    let url = task.request.url!
    let path = url.path.isEmpty || url.path == "/" ? "index.html" : String(url.path.dropFirst())
    if path == "__image" { return image(task, url) }
    let file = web.appendingPathComponent(path).standardizedFileURL
    guard file.path.hasPrefix(web.path + "/"), let data = try? Data(contentsOf: file) else { return reply(task, url, nil, nil) }
    reply(task, url, data, UTType(filenameExtension: file.pathExtension)?.preferredMIMEType)
  }
  func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) { stop(task) }
  func stop(_ task: WKURLSchemeTask) { // the page went away: stop downloading, reply to nobody
    guard let (id, fetch) = fetches.first(where: { $0.value.task === task }) else { return }
    fetches[id] = nil
    fetch.download.cancel()
  }

  // Share cards draw AniList pictures on a canvas, which needs CORS, and AniList's image server answers the
  // animetro:// origin with "Access-Control-Allow-Origin: null", so WebKit drops them. The app fetches them
  // itself and serves them from its own origin: animetro://app/__image?u=<https://…anilist.co/…>.
  func image(_ task: WKURLSchemeTask, _ url: URL) {
    guard let u = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "u" })?.value,
          let remote = URL(string: u), allows(remote) else { return reply(task, url, nil, nil) }
    let download = session.dataTask(with: remote)
    fetches[download.taskIdentifier] = Fetch(task, url, download)
    download.resume()
  }
  // Pictures only, never documents: an SVG (or anything else) served from the app's own origin could carry script.
  static let raster: Set<String> = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]
  // AniList's largest banners are a few MB. Checked as the bytes arrive, so a bigger answer is never held in full.
  static let maxImage = 25 << 20

  // Headers first: anything but a 200 raster picture of a declared size within the limit stops here, before its body.
  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                  completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
    guard let fetch = fetches[dataTask.taskIdentifier] else { return completionHandler(.cancel) }
    fetch.type = response.mimeType?.lowercased() ?? ""
    let ok = (response as? HTTPURLResponse)?.statusCode == 200 && Files.raster.contains(fetch.type)
      && response.expectedContentLength <= Files.maxImage // -1 when the server doesn't say
    completionHandler(ok ? .allow : .cancel) // .cancel ends in didCompleteWithError, which answers 404
  }
  // Then the body, which may not say its size (or may lie): stop as soon as it passes the limit.
  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    guard let fetch = fetches[dataTask.taskIdentifier] else { return dataTask.cancel() }
    guard fetch.data.count + data.count <= Files.maxImage else {
      fetch.data = Data()
      return dataTask.cancel()
    }
    fetch.data.append(data)
  }
  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    guard let fetch = fetches.removeValue(forKey: task.taskIdentifier) else { return } // stopped by the page; nobody to answer
    reply(fetch.task, fetch.url, error == nil ? fetch.data : nil, fetch.type) // an error includes our own cancel
  }

  static func allowed(_ url: URL) -> Bool {
    guard url.scheme == "https", let host = url.host?.lowercased() else { return false }
    return host == "anilist.co" || host.hasSuffix(".anilist.co")
  }
  // a redirect has to stay on AniList too, or the fetch stops there (and the card draws without that picture)
  func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                  newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
    completionHandler(request.url.map(allows) == true ? request : nil)
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

final class App: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, NSMenuItemValidation {
  var window: NSWindow!
  var view: WKWebView!
  var titleWatch: NSKeyValueObservation?
  let selfTest = ProcessInfo.processInfo.environment["ANIMETRO_SELFTEST"] != nil
  var savingScores = 0 // scores Rapid rating is still sending to AniList; the page reports it, leaving drops them
  var crashes: [Date] = [] // when the page's process last died, to tell a one-off from a page that keeps dying
  var selfTestReport: [String: Any]? // the self-test's page checks, kept while its login check runs on My pass

  func applicationDidFinishLaunching(_ note: Notification) {
    let config = WKWebViewConfiguration()
    config.setURLSchemeHandler(Files(), forURLScheme: "animetro")
    // keeps your login and settings between launches; the self-test gets a blank one, so it starts logged out and
    // never touches yours
    config.websiteDataStore = selfTest ? .nonPersistent() : .default()
    config.userContentController.add(self, name: "animetro") // the page asks for native help here (saving images)
    view = WKWebView(frame: .zero, configuration: config)
    view.navigationDelegate = self
    view.uiDelegate = self
    view.allowsBackForwardNavigationGestures = true
    if #available(macOS 13.3, *) { view.isInspectable = devWeb != nil } // right-click > Inspect Element, in dev mode only
    view.setValue(false, forKey: "drawsBackground") // no white flash before the dark page paints
    let zoom = UserDefaults.standard.double(forKey: "pageZoom") // View > Zoom In/Out, from last time (0 when never set)
    view.pageZoom = App.zoomSteps.contains(zoom) ? zoom : 1

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
    if selfTest, selfTestReport != nil, url.host?.lowercased() == "anilist.co", url.path == "/api/v2/oauth/authorize" {
      finishSelfTest(login: url) // the self-test's Log in click: note where it was going, never open AniList's page
      return decisionHandler(.cancel)
    }
    let mainFrame = action.targetFrame?.isMainFrame ?? true
    let scheme = url.scheme?.lowercased()
    let aniList = scheme == "https" && url.host?.lowercased() == "anilist.co" // the login page, and only over HTTPS
    if scheme == "animetro" || !mainFrame || aniList || scheme == "about" {
      guard mainFrame, savingScores > 0 else { return decisionHandler(.allow) }
      return leaveWhileSaving { decisionHandler($0 ? .allow : .cancel) } // links, Back, Reload: same question
    }
    App.openExternally(url)
    decisionHandler(.cancel)
  }

  // target="_blank" links (streaming sites, AniList profile) go to your browser.
  func webView(_ webView: WKWebView, createWebViewWith config: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    if let url = action.request.url { App.openExternally(url) }
    return nil
  }

  // Only web and mail links leave the app. Any other scheme would hand the URL to whatever app claims it
  // (file:, custom app schemes, …), so those are dropped.
  static func openExternally(_ url: URL) {
    guard let scheme = url.scheme?.lowercased(), ["https", "http", "mailto"].contains(scheme) else { return }
    NSWorkspace.shared.open(url)
  }

  // WebKit runs the page in its own process; if that dies (memory pressure, a WebKit bug) the window goes blank.
  // Bring it back: the same page the first time, Home if it dies again soon after, and if Home keeps dying too, ask
  // instead of looping. Whatever the page was sending to AniList died with it.
  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    savingScores = 0
    let now = Date()
    crashes = crashes.filter { now.timeIntervalSince($0) < 30 } + [now]
    switch crashes.count {
    case 1 where webView.url != nil: webView.reload()
    case 1, 2: webView.load(URLRequest(url: home))
    default:
      guard window.attachedSheet == nil else { return }
      let alert = NSAlert()
      alert.messageText = "Animetro's page keeps stopping"
      alert.informativeText = "The page quit unexpectedly several times in a row."
      alert.addButton(withTitle: "Try Again")
      alert.addButton(withTitle: "Quit")
      alert.beginSheetModal(for: window) { response in
        if response == .alertSecondButtonReturn { return NSApp.terminate(nil) }
        self.crashes = []
        webView.load(URLRequest(url: home))
      }
    }
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
    if selfTestReport != nil { return clickLogIn(webView) }
    // ANIMETRO_SELFTEST=1: run the checks below, print one line of JSON, quit. macos/selftest.sh fails unless every
    // check passes: ready ("ok": the home page booted), header (the shared header rendered), stored (localStorage
    // works), api (AniList answers a GraphQL query), card (an AniList picture through the image route draws on a canvas
    // that can still be exported), secure (a secure context, which clipboard and crypto need), clipboard, native (the
    // Save-image bridge is there). The rest (page, title, web) is there to read when it fails.
    // api and card need the network, so each gets a second try before it counts as failed.
    let js = """
      // wait for the page to say it loaded (or failed), up to 15 seconds
      for (let i = 0; i < 60 && !document.documentElement.dataset.ready; i++) await new Promise(r => setTimeout(r, 250));
      let stored = false;
      try {
        localStorage.setItem('animetro.selftest', '1');
        stored = localStorage.getItem('animetro.selftest') === '1';
        localStorage.removeItem('animetro.selftest');
      } catch {}
      const twice = async probe => (await probe()) || (await new Promise(r => setTimeout(r, 1000)), probe());
      const api = twice(() => fetch('https://graphql.anilist.co', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: '{ Media(id: 1) { id } }' }), signal: AbortSignal.timeout(8000) }).then(r => r.json()).then(j => j.data.Media.id === 1).catch(() => false));
      // share cards: an AniList picture through the app's image route must draw on a canvas that can still be saved
      const card = twice(() => new Promise(r => { const i = new Image(); setTimeout(() => r(false), 8000);
        i.onload = () => { try { const c = document.createElement('canvas'); c.getContext('2d').drawImage(i, 0, 0); c.toDataURL(); r(true); } catch { r(false); } };
        i.onerror = () => r(false);
        i.src = '__image?u=' + encodeURIComponent('https://s4.anilist.co/file/anilistcdn/media/anime/cover/small/bx1-GCsPm7waJ4kS.png'); }));
      return JSON.stringify({ ready: document.documentElement.dataset.ready || 'timeout', header: !!document.querySelector('header.top'),
        stored, api: await api, card: await card, secure: isSecureContext, clipboard: !!navigator.clipboard,
        native: !!window.webkit?.messageHandlers?.animetro, page: document.querySelector('main')?.innerText.slice(0, 60) ?? null,
        title: document.title, web });
      """
    webView.callAsyncJavaScript(js, arguments: ["web": web.path], in: nil, in: .page) { result in
      switch result {
      case .success(let value):
        guard let text = value as? String, let data = text.data(using: .utf8),
              let report = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
          print(value as? String ?? String(describing: value)); exit(0)
        }
        // then the login check: open My pass (logged out, see websiteDataStore) and click Log in with AniList
        self.selfTestReport = report
        DispatchQueue.main.asyncAfter(deadline: .now() + 20) { self.finishSelfTest(login: nil) } // the click never came
        webView.load(URLRequest(url: URL(string: "animetro://app/pass.html")!))
      case .failure(let error): // still one line of valid JSON, whatever the message says
        let line = try? JSONSerialization.data(withJSONObject: ["error": error.localizedDescription])
        print(line.flatMap { String(data: $0, encoding: .utf8) } ?? "{\"error\": \"unknown\"}")
        exit(0)
      }
    }
  }

  // Self-test, part two, on My pass: click the one-click Log in link as a rider would. decidePolicyFor catches the
  // navigation it starts and finishSelfTest reports where it went; AniList's page is never loaded.
  func clickLogIn(_ webView: WKWebView) {
    let js = """
      for (let i = 0; i < 40; i++) {
        const a = [...document.querySelectorAll('a')].find(a => a.textContent.trim() === 'Log in with AniList');
        if (a) { a.click(); return true; }
        await new Promise(r => setTimeout(r, 250));
      }
      return false;
      """
    webView.callAsyncJavaScript(js, arguments: [:], in: nil, in: .page) { result in
      if case .success(let clicked) = result, clicked as? Bool != true { self.finishSelfTest(login: nil) } // no link
    }
  }

  // login: true when the click went to AniList's authorize page for Animetro's Mac client: implicit grant
  // (response_type=token, so no secret) with a one-time state. loginURL shows where it went.
  func finishSelfTest(login: URL?) {
    guard var report = selfTestReport else { return }
    selfTestReport = nil
    let query = login.flatMap { URLComponents(url: $0, resolvingAgainstBaseURL: false)?.queryItems } ?? []
    let item = { (name: String) in query.first { $0.name == name }?.value ?? "" }
    let state = item("state")
    report["login"] = login?.scheme == "https" && login?.host == "anilist.co" && login?.path == "/api/v2/oauth/authorize"
      && query.map(\.name) == ["client_id", "response_type", "state"]
      && item("client_id") == "56211" && item("response_type") == "token"
      && state.count == 32 && state.allSatisfy(\.isHexDigit)
    report["loginURL"] = login?.absoluteString ?? NSNull()
    let line = (try? JSONSerialization.data(withJSONObject: report)).flatMap { String(data: $0, encoding: .utf8) }
    print(line ?? "{\"error\": \"report\"}")
    exit(0)
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
  // View > Zoom In / Zoom Out / Actual Size: the page's text and layout, in Safari's steps, remembered between launches.
  static let zoomSteps: [CGFloat] = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]
  @objc func zoomIn() { setZoom(App.zoomSteps.first { $0 > view.pageZoom + 0.001 }) }
  @objc func zoomOut() { setZoom(App.zoomSteps.last { $0 < view.pageZoom - 0.001 }) }
  @objc func actualSize() { setZoom(1) }
  func setZoom(_ zoom: CGFloat?) {
    guard let zoom else { return } // already at the largest or smallest step
    view.pageZoom = zoom
    UserDefaults.standard.set(Double(zoom), forKey: "pageZoom")
  }
  func validateMenuItem(_ item: NSMenuItem) -> Bool {
    switch item.action {
    case #selector(zoomIn): return view.pageZoom < App.zoomSteps.last! - 0.001
    case #selector(zoomOut): return view.pageZoom > App.zoomSteps.first! + 0.001
    case #selector(actualSize): return abs(view.pageZoom - 1) > 0.001
    default: return true
    }
  }

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
    // ⌘= zooms in too (the same key as + without Shift); a hidden item still answers its shortcut
    let zoomInToo = item("Zoom In", #selector(zoomIn), "=")
    zoomInToo.isHidden = true
    add("View", [item("Zoom In", #selector(zoomIn), "+"), zoomInToo, item("Zoom Out", #selector(zoomOut), "-"),
                 item("Actual Size", #selector(actualSize), "0")])
    add("Go", [item("Home", #selector(goHome), "h", [.command, .shift]), item("Find a Series", #selector(find), "f"),
               item("Back", #selector(goBack), "["), item("Forward", #selector(goForward), "]"), item("Reload", #selector(reload), "r")])
    add("Window", [item("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m"), item("Zoom", #selector(NSWindow.performZoom(_:)), ""),
                   item("Close", #selector(NSWindow.performClose(_:)), "w")])
    return bar
  }
}

// The app starts here (build.sh compiles with -parse-as-library so @main can be used). macos/test.sh builds this
// file with ANIMETRO_TESTS and its own main.swift, which runs the tests instead.
#if !ANIMETRO_TESTS
@main enum Main {
  static let delegate = App() // NSApplication holds its delegate weakly
  static func main() {
    let app = NSApplication.shared
    app.delegate = delegate
    app.setActivationPolicy(.regular)
    app.run()
  }
}
#endif
