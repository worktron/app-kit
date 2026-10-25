// app-kit's copy of tauri-plugin-mobile-push 0.1.4's Swift side. Changed from the original: the notification delegate is
// set when the plugin starts, and set again once the window loads, so a tap that launches the app is not lost; and a tap
// keeps the notification's page (its `url`) until the page takes it, with an event telling an open page to take it now.

import UIKit
import WebKit
import UserNotifications
import Tauri
import ObjectiveC

// MARK: - Token Fetcher (thread-safe async token retrieval)

/// Fetches an APNs device token by registering for remote notifications
/// and blocking until the AppDelegate callback fires.
private class TokenFetcher {
    let semaphore = DispatchSemaphore(value: 0)
    var token: String?
    var error: String?

    func resolve(_ tokenString: String) {
        self.token = tokenString
        semaphore.signal()
    }

    func reject(_ errorMessage: String) {
        self.error = errorMessage
        semaphore.signal()
    }
}

/// The active token fetcher — set during getDeviceToken, read by AppDelegate callbacks.
/// Access is serialized: only one getToken call can be in-flight at a time (guarded by tokenLock).
private var activeTokenFetcher: TokenFetcher?
private let tokenLock = NSLock()

// MARK: - AppDelegate method injection

/// Whether we've already injected APNs methods into the AppDelegate class.
private var apnsDelegateSetUp = false

/// Configured foreground presentation options. Set via FFI at plugin init.
/// Defaults to banner + list + sound + badge for back-compat with 0.1.3 and
/// earlier, which hardcoded this behavior.
private var configuredForegroundPresentation: UNNotificationPresentationOptions =
    [.banner, .list, .sound, .badge]

/// UNUserNotificationCenter delegate for foreground notification handling.
/// `willPresent` fires only when the app is in the foreground; backgrounded
/// and locked states bypass this delegate entirely and iOS shows the system
/// banner natively.
private class PushNotificationHandler: NSObject, UNUserNotificationCenterDelegate {
    static let shared = PushNotificationHandler()

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        IphoneNotificationsPlugin.instance?.handleNotification(notification.request.content.userInfo)
        completionHandler(configuredForegroundPresentation)
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        keepTappedAddress(response.notification.request.content.userInfo)
        completionHandler()
    }
}

// MARK: - The tapped notification's page

/// The page a tapped notification is about, kept until the page takes it. A file-level variable, not the plugin
/// instance's, since a tap that launches the app can arrive before the window, and so the instance, exists.
private var tappedAddress: String?
private let tappedLock = NSLock()

/// The event that tells an open page to take the address now (`TAPPED_EVENT` in tauri/iphone-notifications/names.ts).
/// It carries nothing: the page asks for the address, so nothing from the notification is written into a script.
private let tappedEvent = "app-kit-notification-tapped"

/// The page's web view, once the window has loaded.
private weak var pageWebview: WKWebView?

private func keepTappedAddress(_ userInfo: [AnyHashable: Any]) {
    guard let address = userInfo["url"] as? String, !address.isEmpty else {
        NSLog("[iphone-notifications] tap on a notification with no url: the app opens where it was")
        return
    }
    tappedLock.lock()
    tappedAddress = address
    tappedLock.unlock()
    NSLog("[iphone-notifications] tap kept %@ for the page", address)
    DispatchQueue.main.async {
        guard let webview = pageWebview else {
            NSLog("[iphone-notifications] no window yet: the page takes the tap when it starts")
            return
        }
        webview.evaluateJavaScript("window.dispatchEvent(new Event('\(tappedEvent)'))")
        NSLog("[iphone-notifications] told the page a tap came in")
    }
}

/// Make this plugin the notification center's delegate. Only one object can be, and tauri-plugin-notification takes
/// it when it starts and drops push taps, so this runs when the plugin starts (before launch finishes, as Apple
/// requires for a tap that launches the app) and again once the window loads, after every plugin has started.
private func takeNotificationDelegate(_ when: String) {
    let center = UNUserNotificationCenter.current()
    if center.delegate === PushNotificationHandler.shared { return }
    if let other = center.delegate {
        NSLog("[iphone-notifications] %@: took the notification delegate from %@, whose taps on local notifications now do nothing", when, NSStringFromClass(type(of: other)))
    }
    center.delegate = PushNotificationHandler.shared
}

/// Copy the kept address into the buffer and clear it, in one locked step, so each tap opens its page once.
/// Returns its length, 0 when no tap is waiting, -1 when it did not fit (it is dropped, never cut short).
@_cdecl("iphone_notifications_take_tapped_address")
func takeTappedAddress(_ buffer: UnsafeMutablePointer<CChar>, _ bufferLen: Int32) -> Int32 {
    tappedLock.lock()
    let address = tappedAddress
    tappedAddress = nil
    tappedLock.unlock()
    guard let address = address else { return 0 }
    let bytes = Array(address.utf8)
    guard bytes.count < Int(bufferLen) else {
        NSLog("[iphone-notifications] dropped a tapped address of %d bytes, longer than %d", bytes.count, bufferLen)
        return -1
    }
    for (i, b) in bytes.enumerated() {
        buffer[i] = CChar(bitPattern: b)
    }
    buffer[bytes.count] = 0
    NSLog("[iphone-notifications] the page took %@", address)
    return Int32(bytes.count)
}

/// Injects APNs callback methods into the Tao-generated dynamic AppDelegate class
/// and makes sure this plugin is still the notification center's delegate.
/// Must be called on the main thread.
private func setupApnsDelegateInternal() {
    guard !apnsDelegateSetUp else { return }

    guard let delegate = UIApplication.shared.delegate else {
        NSLog("[iphone-notifications] setupApnsDelegate: no UIApplication.delegate found")
        return
    }

    let cls: AnyClass = type(of: delegate)
    NSLog("[iphone-notifications] Injecting APNs methods into %@", NSStringFromClass(cls))

    // application:didRegisterForRemoteNotificationsWithDeviceToken:
    let didRegisterSel = sel_registerName("application:didRegisterForRemoteNotificationsWithDeviceToken:")
    let didRegisterBlock: @convention(block) (AnyObject, UIApplication, NSData) -> Void = { _, _, tokenNSData in
        let tokenData = tokenNSData as Data
        let tokenString = tokenData.map { String(format: "%02.2hhx", $0) }.joined()
        NSLog("[iphone-notifications] APNs token received: %@...", String(tokenString.prefix(16)))
        activeTokenFetcher?.resolve(tokenString)
        IphoneNotificationsPlugin.instance?.handleToken(tokenData)
    }
    let didRegisterImp = imp_implementationWithBlock(didRegisterBlock as Any)
    if class_addMethod(cls, didRegisterSel, didRegisterImp, "v@:@@") {
        NSLog("[iphone-notifications] Added didRegisterForRemoteNotifications to AppDelegate")
    } else {
        NSLog("[iphone-notifications] didRegisterForRemoteNotifications already exists on AppDelegate")
    }

    // application:didFailToRegisterForRemoteNotificationsWithError:
    let didFailSel = sel_registerName("application:didFailToRegisterForRemoteNotificationsWithError:")
    let didFailBlock: @convention(block) (AnyObject, UIApplication, NSError) -> Void = { _, _, error in
        NSLog("[iphone-notifications] APNs registration failed: %@", error.localizedDescription)
        activeTokenFetcher?.reject(error.localizedDescription)
        IphoneNotificationsPlugin.instance?.handleTokenError(error as Error)
    }
    let didFailImp = imp_implementationWithBlock(didFailBlock as Any)
    if class_addMethod(cls, didFailSel, didFailImp, "v@:@@") {
        NSLog("[iphone-notifications] Added didFailToRegisterForRemoteNotifications to AppDelegate")
    } else {
        NSLog("[iphone-notifications] didFailToRegisterForRemoteNotifications already exists on AppDelegate")
    }

    takeNotificationDelegate("first token request")

    apnsDelegateSetUp = true
}

// MARK: - Direct FFI functions (bypass PluginManager dispatch)

/// Configure what iOS shows when a notification arrives while the app is
/// foreground. `options` is the `UNNotificationPresentationOptions` bitmask
/// assembled on the Rust side from `ForegroundPresentationOptions`.
/// Called once from the Rust plugin setup after `register_ios_plugin`.
@_cdecl("iphone_notifications_set_foreground_presentation")
func setForegroundPresentation(_ options: UInt32) {
    configuredForegroundPresentation =
        UNNotificationPresentationOptions(rawValue: UInt(options))
    NSLog("[iphone-notifications] Foreground presentation set: %u", options)
}

/// Request notification permission. Blocks until the user responds (30s timeout).
/// Returns 1 if granted, 0 if denied or error.
@_cdecl("iphone_notifications_request_permission")
func requestPermissionDirect() -> Int32 {
    let sem = DispatchSemaphore(value: 0)
    var granted = false

    UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { result, error in
        if let error = error {
            NSLog("[iphone-notifications] requestAuthorization error: %@", error.localizedDescription)
        }
        granted = result
        sem.signal()
    }

    let result = sem.wait(timeout: .now() + 30)
    if result == .timedOut {
        NSLog("[iphone-notifications] requestAuthorization timed out")
        return 0
    }

    NSLog("[iphone-notifications] Permission %@", granted ? "granted" : "denied")
    return granted ? 1 : 0
}

/// Get the APNs device token. Blocks until the token is received or timeout.
/// Writes the hex token string (null-terminated) to buffer.
/// Returns: >0 = token length, -1 = error, -2 = timeout.
@_cdecl("iphone_notifications_get_device_token")
func getDeviceTokenDirect(_ buffer: UnsafeMutablePointer<CChar>, _ bufferLen: Int32, _ timeoutSecs: Int32) -> Int32 {
    // Serialize concurrent calls
    tokenLock.lock()
    defer { tokenLock.unlock() }

    // Ensure APNs delegate is set up
    if !apnsDelegateSetUp {
        if Thread.isMainThread {
            setupApnsDelegateInternal()
        } else {
            DispatchQueue.main.sync {
                setupApnsDelegateInternal()
            }
        }
    }

    let fetcher = TokenFetcher()
    activeTokenFetcher = fetcher

    // Register for remote notifications (must be on main thread)
    DispatchQueue.main.async {
        NSLog("[iphone-notifications] Calling registerForRemoteNotifications...")
        UIApplication.shared.registerForRemoteNotifications()
    }

    // Wait for the token
    let timeout = max(Int(timeoutSecs), 5)
    let result = fetcher.semaphore.wait(timeout: .now() + .seconds(timeout))
    activeTokenFetcher = nil

    if result == .timedOut {
        NSLog("[iphone-notifications] Token request timed out after %ds", timeout)
        return -2
    }

    if let error = fetcher.error {
        NSLog("[iphone-notifications] Token error: %@", error)
        return -1
    }

    guard let token = fetcher.token else {
        NSLog("[iphone-notifications] Token is nil after semaphore signal")
        return -1
    }

    // Write token to buffer
    let bytes = Array(token.utf8)
    guard bytes.count < Int(bufferLen) else {
        NSLog("[iphone-notifications] Token too long for buffer: %d >= %d", bytes.count, bufferLen)
        return -1
    }
    for (i, b) in bytes.enumerated() {
        buffer[i] = CChar(bitPattern: b)
    }
    buffer[bytes.count] = 0

    NSLog("[iphone-notifications] Token (%d chars) written to buffer", bytes.count)
    return Int32(bytes.count)
}

// MARK: - Plugin class (kept for event system + lifecycle)

@objc(IphoneNotificationsPlugin)
public class IphoneNotificationsPlugin: Plugin {
    public static var instance: IphoneNotificationsPlugin?

    override public func load(webview: WKWebView) {
        IphoneNotificationsPlugin.instance = self
        pageWebview = webview
        takeNotificationDelegate("window loaded")
        NSLog("[iphone-notifications] Plugin loaded (webview ready)")
    }

    // MARK: - PluginManager command handlers (kept as fallback)
    // These handle commands routed through run_mobile_plugin / PluginManager.
    // Currently bypassed by the direct FFI functions above.

    @objc override public func requestPermissions(_ invoke: Invoke) {
        NSLog("[iphone-notifications] requestPermissions via PluginManager")
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, error in
            if let error = error {
                invoke.reject(error.localizedDescription)
                return
            }
            invoke.resolve(["granted": granted])
        }
    }

    @objc public func getToken(_ invoke: Invoke) {
        NSLog("[iphone-notifications] getToken via PluginManager")
        DispatchQueue.main.async {
            UIApplication.shared.registerForRemoteNotifications()
        }
        // Token arrives via handleToken() callback from AppDelegate
    }

    // MARK: - Callbacks from AppDelegate injection

    public func handleToken(_ token: Data) {
        let tokenString = token.map { String(format: "%02.2hhx", $0) }.joined()
        NSLog("[iphone-notifications] handleToken: %@...", String(tokenString.prefix(16)))
        self.trigger("token-received", data: ["token": tokenString])
    }

    public func handleTokenError(_ error: Error) {
        NSLog("[iphone-notifications] handleTokenError: %@", error.localizedDescription)
    }

    public func handleNotification(_ userInfo: [AnyHashable: Any]) {
        var data: JSObject = [:]
        for (key, value) in userInfo {
            guard let stringKey = key as? String else { continue }
            if let stringValue = value as? String {
                data[stringKey] = stringValue
            } else if let numberValue = value as? NSNumber {
                data[stringKey] = numberValue.intValue
            }
        }
        self.trigger("notification-received", data: data)
    }
}

// MARK: - Plugin entry point

@_cdecl("init_plugin_iphone_notifications")
func initPlugin() -> Plugin {
    // The AppDelegate's token methods wait for the first getDeviceToken call, since during plugin init
    // UIApplication.shared.delegate may not be set yet (Tao creates it dynamically, and this runs before
    // didFinishLaunchingWithOptions completes). The notification center's delegate needs no AppDelegate, and must be
    // set before launch finishes for iOS to hand over a tap that launched the app.
    takeNotificationDelegate("plugin start")
    return IphoneNotificationsPlugin()
}
