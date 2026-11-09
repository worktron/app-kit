import AppKit
import MenuBarTheme
import SwiftUI

/// The theme's window made for real and never shown, as an app makes it, in each case a saved place can leave it. A window
/// named for its place saves that place in the running program's own preferences, which a scratch home folder does not
/// move (cfprefsd reads the user, not the program's environment), so the check runs only as this program, never inside an
/// app, gives each case its saved place through the arguments' volatile domain, and saves under a name of its own run, so
/// two runs at once never read each other's place; it removes that one key after each case and fails if it is left at
/// the end. Prints one line a case; true when every case is right.
@MainActor
func windowCheck() -> Bool {
    let defaults = UserDefaults.standard
    let domain = ProcessInfo.processInfo.processName
    guard Bundle.main.bundleIdentifier == nil else {
        print("FAIL the window check runs only as menu-bar-snapshots, never inside an app, whose saved places it would change")
        return false
    }
    NSApplication.shared.setActivationPolicy(.prohibited)
    guard let main = NSScreen.screens.first else {
        print("FAIL no display to place a window on")
        return false
    }
    let size = CGSize(width: 880, height: 640), minimum = CGSize(width: 720, height: 480)
    let name = "MenuBarThemeCheck.\(ProcessInfo.processInfo.processIdentifier).main", key = "NSWindow Frame \(name)"
    let visible = main.visibleFrame, full = main.frame
    // AppKit's own form of a saved place: the frame, then the display's frame it was saved on.
    func saved(_ r: NSRect) -> String {
        "\(Int(r.minX)) \(Int(r.minY)) \(Int(r.width)) \(Int(r.height)) \(Int(full.minX)) \(Int(full.minY)) \(Int(full.width)) \(Int(full.height)) "
    }
    let make = { AppWindow(size: size, minimum: minimum, name: name, title: "check") { Color.clear } }
    let onDisplay = { (w: NSWindow) in NSScreen.screens.contains { $0.frame.contains(w.frame) } }
    let sameSize = { (w: NSWindow, r: NSRect) in abs(w.frame.width - r.width) <= 1 && abs(w.frame.height - r.height) <= 1 }
    let unnamed = AppWindow(size: size, minimum: minimum, name: nil, title: "check") { Color.clear }
    let defaultFrame = unnamed.frame
    unnamed.close()
    let fits = NSRect(x: visible.minX + 40, y: visible.minY + 40, width: minimum.width + 30, height: minimum.height + 20)
    let defaultWords = "at \(Int(size.width))×\(Int(size.height))"
    let cases: [(String, String?, (AppWindow) -> Bool)] = [
        ("nothing saved", nil, { $0.opening == "\(defaultWords) (default, nothing saved)" }),
        // Its size is kept; AppKit may put it on another display of the same size, so only being wholly on one is asked.
        ("a saved place that fits", saved(fits), { $0.opening.hasSuffix("(saved place)") && sameSize($0, fits) && onDisplay($0) }),
        ("a saved place equal to the default", saved(defaultFrame), { $0.opening == "\(defaultWords) (saved place)" }),
        // AppKit shrinks this one onto a display as it restores it, so it opens there as a saved place, wholly on one.
        ("a saved place larger than every display",
         saved(NSRect(x: visible.minX, y: visible.minY, width: visible.width + 900, height: visible.height + 700)), onDisplay),
    ]
    var right = true
    func report(_ what: String, _ pass: Bool, _ w: NSWindow, _ opening: String) {
        print("\(pass ? "ok" : "FAIL") \(what): opens \(opening), frame \(Int(w.frame.width))×\(Int(w.frame.height)) at \(Int(w.frame.minX)),\(Int(w.frame.minY))")
        right = right && pass
    }
    func done(_ w: NSWindow) {
        w.setFrameAutosaveName("")
        w.close()
        // A place AppKit saved under the check's name would be read as the next case's: each starts from nothing of its own.
        defaults.removeObject(forKey: key)
    }
    for (what, frame, ok) in cases {
        defaults.setVolatileDomain(frame.map { [key: $0] } ?? [:], forName: UserDefaults.argumentDomain)
        let w = make()
        report(what, ok(w), w, w.opening)
        done(w)
    }
    defaults.setVolatileDomain([:], forName: UserDefaults.argumentDomain)
    // A name one open window holds cannot be given to a second: that one opens at the default and says why.
    let first = make()
    let second = make()
    report("a second window under a name in use", second.opening == "\(defaultWords) (default, another window has this name)", second, second.opening)
    done(second)
    done(first)
    let clean = defaults.persistentDomain(forName: domain)?[key] == nil
    print("\(clean ? "ok" : "FAIL") nothing this run saved is left in \(domain)'s preferences\(clean ? "" : ": \(key)")")
    return right && clean
}
