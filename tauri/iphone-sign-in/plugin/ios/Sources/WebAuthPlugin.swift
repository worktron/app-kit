import AuthenticationServices
import SwiftRs
import Tauri
import UIKit
import WebKit

class AuthenticateArgs: Decodable {
  let url: String
  let callbackScheme: String
  // The site and path to wait for over https instead, where iOS allows it. A page from before it sends neither.
  let callbackHost: String?
  let callbackPath: String?
}

class WebAuthPlugin: Plugin {
  // The kit's change to the published 1.0.0: the session is kept until it ends, and it is shown over the app's own
  // window. The published plugin kept no reference and looked the window up with UIApplication.windows, which in a
  // scene-based app finds no key window, so iOS showed the sheet in a fallback window nobody could see. One sign-in at a
  // time: a second call while one is under way, its retry's wait included, is refused, so it cannot drop the first.
  private var session: ASWebAuthenticationSession?
  private var signingIn = false
  // About when the app started, for the line a refusal sends: the plugin loads as the app does.
  private let loaded = ProcessInfo.processInfo.systemUptime
  // The last build whose sheet came back over https, so a refusal says whether one tap ever worked on this install.
  private static let workedKey = "app-kit.iphone-sign-in.one-tap-build"
  // How long after a refusal the sheet asks over https once more: iOS 26 can refuse a site whose file it has not
  // fetched yet, and other developers report a second ask a moment later gets through (Apple's forum thread 805606).
  private static let retryAfter: TimeInterval = 2
  // ASCII letters and digits only: CharacterSet.alphanumerics takes every alphabet's letters, and Apple's reason comes
  // in the phone's language, so an é left bare would reach percentEncodedQuery, which traps on it.
  private static let plainCharacters = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789")

  @objc public func authenticate(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(AuthenticateArgs.self)
    guard let url = URL(string: args.url) else {
      NSLog("[iphone-sign-in] refused: %@ is not an address", args.url)
      invoke.reject("Invalid URL")
      return
    }

    DispatchQueue.main.async {
      if self.signingIn {
        NSLog("[iphone-sign-in] refused: a sign-in sheet is already open")
        invoke.reject("A sign-in sheet is already open")
        return
      }
      self.signingIn = true
      // The sheet waiting for the app's link. After a refusal over https, the browser page's address carries why, in
      // refused=, and the page sends it to the app's server, since nobody can read a TestFlight install's own log.
      let overScheme = { (refusal: String?) in
        var page = url
        if let refusal = refusal, var withReason = URLComponents(url: url, resolvingAgainstBaseURL: false),
          let encoded = refusal.addingPercentEncoding(withAllowedCharacters: WebAuthPlugin.plainCharacters)
        {
          withReason.percentEncodedQuery = [withReason.percentEncodedQuery, "refused=\(encoded)"].compactMap { $0 }.joined(separator: "&")
          page = withReason.url ?? url
        }
        self.open(invoke, page, waitingFor: args.callbackScheme) { done in
          ASWebAuthenticationSession(url: page, callbackURLScheme: args.callbackScheme, completionHandler: done)
        }
      }
      // The kit's second change: from iOS 17.4 the sheet can wait for an address on the app's own site, which iOS gives
      // only to the app that site names, so the browser page hands over with no click. It asks the page for that with
      // back=https. iOS refuses it, before the sheet shows, when the site does not name the app or its file has not
      // reached the phone; then the sheet asks once more, and after a second refusal opens again waiting for the app's
      // link, and the page asks for the click.
      if #available(iOS 17.4, *), let host = args.callbackHost, let path = args.callbackPath,
        var asking = URLComponents(url: url, resolvingAgainstBaseURL: false)
      {
        // Added to the query as the page encoded it: read back and written again, a '+' in an email turns into a space.
        asking.percentEncodedQuery = [asking.percentEncodedQuery, "back=https"].compactMap { $0 }.joined(separator: "&")
        guard let overHttps = asking.url else { return overScheme(nil) }
        let waitingFor = "https://\(host)\(path)"
        let askOverHttps = { (refused: @escaping (String) -> Void) in
          self.open(invoke, overHttps, waitingFor: waitingFor, overHttps: true, refused: refused) { done in
            ASWebAuthenticationSession(url: overHttps, callback: .https(host: host, path: path), completionHandler: done)
          }
        }
        askOverHttps { first in
          NSLog("[iphone-sign-in] asking for %@ once more in %.0f s", waitingFor, WebAuthPlugin.retryAfter)
          DispatchQueue.main.asyncAfter(deadline: .now() + WebAuthPlugin.retryAfter) {
            askOverHttps { second in overScheme(self.refusal(first, second)) }
          }
        }
      } else {
        overScheme(nil)
      }
    }
  }

  /// The line the browser page sends the app's server after two refusals: Apple's reason is one sentence whatever the
  /// cause, so it comes with what tells the causes apart.
  private func refusal(_ first: String, _ second: String) -> String {
    let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "unknown"
    let worked = UserDefaults.standard.string(forKey: WebAuthPlugin.workedKey)
    let before =
      worked == build
      ? "one tap worked before on this build" : worked.map { "one tap last worked on build \($0)" } ?? "one tap never worked on this install"
    let seconds = Int(ProcessInfo.processInfo.systemUptime - loaded)
    let reasons = first == second ? first : "\(first); then \(second)"
    let line = "iOS \(UIDevice.current.systemVersion), build \(build), \(seconds) s after the app started, refused twice, \(before): \(reasons)"
    NSLog("[iphone-sign-in] sheet falls back to the app's link: %@", line)
    return line
  }

  /// Starts the session `make` builds and answers the page with the link it closes on. With `refused`, a session iOS
  /// refuses or will not start runs that with the reason instead of answering.
  private func open(
    _ invoke: Invoke,
    _ url: URL,
    waitingFor: String,
    overHttps: Bool = false,
    refused: ((String) -> Void)? = nil,
    make: (@escaping ASWebAuthenticationSession.CompletionHandler) -> ASWebAuthenticationSession
  ) {
    let session = make { [weak self] callbackURL, error in
      self?.session = nil
      if let error = error {
        // iOS gives a refusal, as of a site that does not name the app, the cancel's code: only a cancel comes with
        // nothing more to say, as Auth0.swift tells them apart.
        let nsError = error as NSError
        let reason = nsError.localizedFailureReason ?? error.localizedDescription
        if (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin && nsError.userInfo.isEmpty {
          NSLog("[iphone-sign-in] sheet cancelled")
        } else if let refused = refused {
          NSLog("[iphone-sign-in] sheet refused %@: %@", waitingFor, reason)
          DispatchQueue.main.async { refused(reason) }
          return
        } else {
          NSLog("[iphone-sign-in] sheet failed: %@", reason)
        }
        self?.signingIn = false
        invoke.reject(error.localizedDescription)
        return
      }
      NSLog("[iphone-sign-in] sheet returned a %@ link", callbackURL?.scheme ?? "missing")
      if overHttps, let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String {
        UserDefaults.standard.set(build, forKey: WebAuthPlugin.workedKey)
      }
      self?.signingIn = false
      invoke.resolve([
        "callbackUrl": callbackURL?.absoluteString ?? ""
      ])
    }
    session.presentationContextProvider = self
    self.session = session
    if session.start() {
      NSLog("[iphone-sign-in] sheet started for %@, waiting for %@", url.host ?? url.absoluteString, waitingFor)
    } else if let refused = refused {
      self.session = nil
      NSLog("[iphone-sign-in] sheet could not start waiting for %@", waitingFor)
      refused("the sheet could not start")
    } else {
      self.session = nil
      self.signingIn = false
      NSLog("[iphone-sign-in] sheet could not start")
      invoke.reject("The sign-in sheet could not start")
    }
  }
}

extension WebAuthPlugin: ASWebAuthenticationPresentationContextProviding {
  func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
    if let window = manager.viewController?.view.window {
      return window
    }
    let windows = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
    return windows.first { $0.isKeyWindow } ?? windows.first ?? ASPresentationAnchor()
  }
}

@_cdecl("init_plugin_web_auth")
func initPlugin() -> Plugin {
  return WebAuthPlugin()
}
