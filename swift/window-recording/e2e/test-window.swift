// A window for the live recording test: an app with no Dock icon (accessory) that shows one window at the global point
// its arguments give, without ever becoming active, and changes its color ten times a second, so the recording's frames
// must differ. It prints `shown` once the window is up and ends when its standard input closes.
//
// The window is made on the hidden display's own screen. A titled window made at a global frame with no screen named is
// put on the main display instead (seen on macOS 27, 2026-11-08, with a diagnostic of invisible windows), and when the
// hidden display is not among the screens it makes no window at all, so a fault never puts one on the owner's screen.
import AppKit

let left = CGFloat(Double(CommandLine.arguments[1])!)
let top = CGFloat(Double(CommandLine.arguments[2])!)
let width = CGFloat(Double(CommandLine.arguments[3])!)
let height = CGFloat(Double(CommandLine.arguments[4])!)

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
// Global points have their origin at the main display's top left; AppKit's at its bottom left.
let mainHeight = NSScreen.screens[0].frame.height
let wanted = NSRect(x: left, y: mainHeight - top - height, width: width, height: height)
guard let hidden = NSScreen.screens.first(where: { $0.frame.contains(wanted) }) else {
    print("error: no screen holds \(wanted); screens: \(NSScreen.screens.map(\.frame))")
    exit(1)
}
let relative = NSRect(x: wanted.minX - hidden.frame.minX, y: wanted.minY - hidden.frame.minY, width: width, height: height)
let window = NSWindow(contentRect: relative, styleMask: [.titled], backing: .buffered, defer: false, screen: hidden)
window.title = "app-kit window recording test"
window.contentView?.wantsLayer = true
var step = 0
Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { _ in
    step += 1
    window.contentView?.layer?.backgroundColor = NSColor(hue: CGFloat(step % 20) / 20, saturation: 0.8, brightness: 0.9, alpha: 1).cgColor
}
window.orderFrontRegardless()
print("shown \(getpid())")
fflush(stdout)
FileHandle.standardInput.readabilityHandler = { handle in
    if handle.availableData.isEmpty { exit(0) }
}
app.run()
