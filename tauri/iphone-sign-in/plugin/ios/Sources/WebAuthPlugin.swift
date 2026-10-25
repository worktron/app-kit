import AuthenticationServices
import SwiftRs
import Tauri
import UIKit
import WebKit

class AuthenticateArgs: Decodable {
  let url: String
  let callbackScheme: String
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
      let session = ASWebAuthenticationSession(
        url: url,
        callbackURLScheme: args.callbackScheme
      ) { [weak self] callbackURL, error in
        self?.session = nil
        if let error = error {
          if (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin {
            NSLog("[iphone-sign-in] sheet cancelled")
          } else {
            NSLog("[iphone-sign-in] sheet failed: %@", error.localizedDescription)
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
        NSLog("[iphone-sign-in] sheet started for %@", url.host ?? args.url)
      } else {
        self.session = nil
        NSLog("[iphone-sign-in] sheet could not start")
        invoke.reject("The sign-in sheet could not start")
      }
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
