// Tests for the Mac app's __image route (Files in Animetro.swift), without AniList or a web view: a loopback HTTP
// server plays the picture host, and a stand-in for WebKit's scheme task records what the page would get back.
// The server counts the body bytes it manages to send, so a route that downloads a whole oversized answer before
// refusing it fails here even though the page sees the same 404. Run by macos/test.sh (and CI).
import Foundation
import Network
import WebKit

let MiB = 1 << 20

// One response per path. Without a declared length the body ends when the connection closes.
struct Route { let type: String, size: Int, declare: Bool, slow: Bool }
final class Sent { var bytes = 0, done = false, hungUp = false } // what the server got out, and how it ended

final class Server {
  let queue = DispatchQueue(label: "server")
  let listener: NWListener
  let routes: [String: Route]
  var log: [String: Sent] = [:] // touched only on queue
  let chunk = Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) + Data(count: 64 * 1024 - 8) // PNG-ish bytes

  init(_ routes: [String: Route]) throws {
    self.routes = routes
    let params = NWParameters.tcp
    params.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any) // loopback only
    listener = try NWListener(using: params)
    listener.newConnectionHandler = { [unowned self] in self.serve($0) }
    let ready = DispatchSemaphore(value: 0)
    listener.stateUpdateHandler = { if case .ready = $0 { ready.signal() } }
    listener.start(queue: queue)
    guard ready.wait(timeout: .now() + 5) == .success else { fatalError("the test server didn't start") }
  }
  var base: String { "http://127.0.0.1:\(listener.port!.rawValue)" }
  func sent(_ path: String) -> Sent { queue.sync { log[path] ?? Sent() } }

  func serve(_ conn: NWConnection) {
    conn.start(queue: queue)
    conn.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [unowned self] data, _, _, _ in
      let line = data.flatMap { String(data: $0, encoding: .utf8) }?.split(separator: "\r\n").first ?? ""
      let path = line.split(separator: " ").dropFirst().first.map(String.init) ?? ""
      guard let route = routes[path] else {
        return conn.send(content: Data("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".utf8),
                         completion: .contentProcessed { _ in conn.cancel() })
      }
      let sent = Sent()
      log[path] = sent
      conn.stateUpdateHandler = { if case .failed = $0, !sent.done { sent.hungUp = true } }
      let head = "HTTP/1.1 200 OK\r\nContent-Type: \(route.type)\r\n" + (route.declare ? "Content-Length: \(route.size)\r\n" : "") + "Connection: close\r\n\r\n"
      conn.send(content: Data(head.utf8), completion: .contentProcessed { _ in self.pump(conn, route, sent) })
    }
  }
  func pump(_ conn: NWConnection, _ route: Route, _ sent: Sent) {
    guard sent.bytes < route.size else {
      sent.done = true
      return conn.send(content: nil, contentContext: .finalMessage, isComplete: true, completion: .contentProcessed { _ in conn.cancel() })
    }
    let n = min(chunk.count, route.size - sent.bytes)
    conn.send(content: chunk.prefix(n), completion: .contentProcessed { [unowned self] error in
      guard error == nil else { sent.hungUp = true; return conn.cancel() }
      sent.bytes += n
      if route.slow { queue.asyncAfter(deadline: .now() + 0.005) { self.pump(conn, route, sent) } } else { pump(conn, route, sent) }
    })
  }
}

// Stands in for WebKit's side of one animetro://app/__image request.
final class Request: NSObject, WKURLSchemeTask {
  let request: URLRequest
  var status: Int?, type: String?, body = Data(), finished = false, calls = 0
  init(_ remote: String) {
    let u = remote.addingPercentEncoding(withAllowedCharacters: .alphanumerics)!
    request = URLRequest(url: URL(string: "animetro://app/__image?u=\(u)")!)
  }
  func didReceive(_ response: URLResponse) { calls += 1; status = (response as? HTTPURLResponse)?.statusCode; type = response.mimeType }
  func didReceive(_ data: Data) { calls += 1; body.append(data) }
  func didFinish() { calls += 1; finished = true }
  func didFailWithError(_ error: Error) { calls += 1; finished = true }
}

// Runs the main queue (where Files hears from URLSession) until the condition holds or time runs out.
@discardableResult func wait(_ seconds: Double = 20, until done: () -> Bool) -> Bool {
  let end = Date() + seconds
  while !done() && Date() < end { RunLoop.main.run(until: Date() + 0.01) }
  return done()
}
var failures = 0
func check(_ name: String, _ ok: Bool, _ detail: @autoclosure () -> String) {
  print(ok ? "ok   \(name)" : "FAIL \(name): \(detail())")
  if !ok { failures += 1 }
}
func mib(_ n: Int) -> String { String(format: "%.1f MiB", Double(n) / Double(MiB)) }

let limit = Files.maxImage
let server = try Server([
  "/small.png": Route(type: "image/png", size: 1 * MiB, declare: true, slow: false),
  "/at-limit.png": Route(type: "image/png", size: limit, declare: false, slow: false),
  "/declared-big.png": Route(type: "image/png", size: 100 * MiB, declare: true, slow: false),
  "/stream-big.png": Route(type: "image/png", size: 200 * MiB, declare: false, slow: false),
  "/picture.svg": Route(type: "image/svg+xml", size: 64 * 1024, declare: true, slow: false),
  "/slow.png": Route(type: "image/png", size: 100 * MiB, declare: false, slow: true),
])
let files = Files(allows: { $0.scheme == "http" && $0.host == "127.0.0.1" })

// Asks Files for a picture and waits for its answer.
func fetch(_ path: String) -> Request {
  let r = Request(server.base + path)
  files.image(r, r.request.url!)
  wait { r.finished }
  return r
}

do { // an ordinary picture comes through whole, with its type
  let r = fetch("/small.png")
  check("an allowed picture is relayed", r.status == 200 && r.type == "image/png" && r.body.count == 1 * MiB,
        "status \(r.status ?? 0), \(r.type ?? "no type"), \(mib(r.body.count))")
}
do { // the limit is inclusive, and counting the stream doesn't break a picture without a length
  let r = fetch("/at-limit.png")
  check("a picture of exactly 25 MiB with no declared length is relayed", r.status == 200 && r.body.count == limit,
        "status \(r.status ?? 0), \(mib(r.body.count))")
}
do { // refused from its headers: the body never comes down
  let r = fetch("/declared-big.png")
  wait(5) { server.sent("/declared-big.png").hungUp }
  let s = server.sent("/declared-big.png")
  check("an oversized declared Content-Length gets a 404", r.status == 404 && r.body.isEmpty, "status \(r.status ?? 0)")
  check("...and the download stops at the headers", s.hungUp && !s.done && s.bytes < limit,
        "server sent \(mib(s.bytes)) of 100 MiB, done \(s.done), client hung up \(s.hungUp)")
}
do { // no length to go on: cut off once the body passes the limit, not after all 200 MiB arrive
  let r = fetch("/stream-big.png")
  wait(5) { server.sent("/stream-big.png").hungUp }
  let s = server.sent("/stream-big.png")
  check("an unknown-length stream past 25 MiB gets a 404", r.status == 404 && r.body.isEmpty, "status \(r.status ?? 0)")
  check("...and the download stops soon after the limit", s.hungUp && !s.done && s.bytes < limit + 16 * MiB,
        "server sent \(mib(s.bytes)) of 200 MiB, done \(s.done), client hung up \(s.hungUp)")
}
do {
  let r = fetch("/picture.svg")
  check("an SVG gets a 404", r.status == 404 && r.body.isEmpty, "status \(r.status ?? 0)")
}
do { // the page goes away mid-download: Files cancels it and never answers the stopped request
  let r = Request(server.base + "/slow.png")
  files.image(r, r.request.url!)
  wait { server.sent("/slow.png").bytes >= 1 * MiB }
  files.stop(r)
  let stopped = wait(5) { server.sent("/slow.png").hungUp }
  wait(0.5) { false } // give a late answer time to show up
  check("stopping the page's request cancels its download", stopped && !server.sent("/slow.png").done,
        "server sent \(mib(server.sent("/slow.png").bytes)), client hung up \(stopped)")
  check("...and the stopped request gets no answer", r.calls == 0, "\(r.calls) calls after stop")
}
do {
  let r = Request("https://example.com/cover.png")
  files.image(r, r.request.url!)
  check("a URL outside the allowlist gets a 404 without a fetch", r.status == 404 && r.finished, "status \(r.status ?? 0)")
}
check("no download is left running", files.fetches.isEmpty, "\(files.fetches.count) still tracked")

print(failures == 0 ? "image route: all checks passed" : "image route: \(failures) check(s) failed")
exit(failures == 0 ? 0 : 1)
