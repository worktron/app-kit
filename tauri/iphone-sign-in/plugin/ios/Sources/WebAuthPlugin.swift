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
  // scene-based app finds no key window, so iOS showed the sheet in a fallback window nobody could see. One sheet at a
  // time: a second call while one is open is refused, so it cannot drop the first sheet's session.
  private var session: ASWebAuthenticationSession?

  @objc public func authenticate(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(AuthenticateArgs.self)
    guard let url = URL(string: args.url) else {
      NSLog("[iphone-sign-in] refused: %@ is not an address", args.url)
      invoke.reject("Invalid URL")
      return
    }

    DispatchQueue.main.async {
      if self.session != nil {
        NSLog("[iphone-sign-in] refused: a sign-in sheet is already open")
        invoke.reject("A sign-in sheet is already open")
        return
      }
      let overScheme = {
        self.open(invoke, url, waitingFor: args.callbackScheme) { done in
          ASWebAuthenticationSession(url: url, callbackURLScheme: args.callbackScheme, completionHandler: done)
        }
      }
      // The kit's second change: from iOS 17.4 the sheet can wait for an address on the app's own site, which iOS gives
      // only to the app that site names, so the browser page hands over with no click. It asks the page for that with
      // back=https. iOS refuses it, before the sheet shows, when the site does not name the app or its file has not
      // reached the phone; then the sheet opens again waiting for the app's link, and the page asks for the click.
      if #available(iOS 17.4, *), let host = args.callbackHost, let path = args.callbackPath,
        var asking = URLComponents(url: url, resolvingAgainstBaseURL: false)
      {
        // Added to the query as the page encoded it: read back and written again, a '+' in an email turns into a space.
        asking.percentEncodedQuery = [asking.percentEncodedQuery, "back=https"].compactMap { $0 }.joined(separator: "&")
        guard let overHttps = asking.url else { return overScheme() }
        self.open(invoke, overHttps, waitingFor: "https://\(host)\(path)", refused: overScheme) { done in
          ASWebAuthenticationSession(url: overHttps, callback: .https(host: host, path: path), completionHandler: done)
        }
      } else {
        overScheme()
      }
    }
  }

  /// Starts the session `make` builds and answers the page with the link it closes on. With `refused`, a session iOS
  /// refuses or will not start runs that instead of answering.
  private func open(
    _ invoke: Invoke,
    _ url: URL,
    waitingFor: String,
    refused: (() -> Void)? = nil,
    make: (@escaping ASWebAuthenticationSession.CompletionHandler) -> ASWebAuthenticationSession
  ) {
    let session = make { [weak self] callbackURL, error in
      self?.session = nil
      if let error = error {
        // iOS gives a refusal, as of a site that does not name the app, the cancel's code: only a cancel comes with
        // nothing more to say, as Auth0.swift tells them apart.
        let nsError = error as NSError
        if (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin && nsError.userInfo.isEmpty {
          NSLog("[iphone-sign-in] sheet cancelled")
        } else if let refused = refused {
          NSLog("[iphone-sign-in] sheet refused %@: %@", waitingFor, nsError.localizedFailureReason ?? error.localizedDescription)
          DispatchQueue.main.async(execute: refused)
          return
        } else {
          NSLog("[iphone-sign-in] sheet failed: %@", nsError.localizedFailureReason ?? error.localizedDescription)
        }
        invoke.reject(error.localizedDescription)
        return
      }
      NSLog("[iphone-sign-in] sheet returned a %@ link", callbackURL?.scheme ?? "missing")
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
      refused()
    } else {
      self.session = nil
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
