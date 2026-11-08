// A display with no screen behind it, made for the length of a run and gone when the program ends, so the window it
// records is drawn somewhere the owner never sees. Placed past the corner of the owner's displays (Plan.swift).
import CoreGraphics
import Foundation
import VirtualDisplay

public struct DisplayError: Error, CustomStringConvertible {
    public let description: String
}

public final class HiddenDisplay {
    /** Held for as long as the display should exist; macOS removes the display when this goes. */
    private var display: CGVirtualDisplay?
    public let id: CGDirectDisplayID
    /** The display's bounds in global points, once placed. */
    public private(set) var bounds: CGRect

    public init(window: CGSize, scale: Int) throws {
        let size = displaySize(window: window)
        let others = Self.activeDisplays().map(CGDisplayBounds)
        let descriptor = CGVirtualDisplayDescriptor()
        descriptor.queue = DispatchQueue.global(qos: .userInitiated)
        descriptor.name = "app-kit window recording"
        descriptor.maxPixelsWide = UInt32(size.width) * UInt32(scale)
        descriptor.maxPixelsHigh = UInt32(size.height) * UInt32(scale)
        // 110 points to the inch, a laptop's density, so the display reads as an ordinary one.
        descriptor.sizeInMillimeters = CGSize(width: 25.4 * size.width / 110, height: 25.4 * size.height / 110)
        // A serial of its own for each run, so two runs at once make two displays, and a nonzero vendor (macOS 14).
        let serial = UInt32(truncatingIfNeeded: getpid())
        descriptor.serialNum = serial
        descriptor.serialNumber = serial
        descriptor.vendorID = 0xA11C
        descriptor.productID = 1
        // sRGB's primaries.
        descriptor.redPrimary = CGPoint(x: 0.64, y: 0.33)
        descriptor.greenPrimary = CGPoint(x: 0.30, y: 0.60)
        descriptor.bluePrimary = CGPoint(x: 0.15, y: 0.06)
        descriptor.whitePoint = CGPoint(x: 0.3127, y: 0.3290)
        guard let display = CGVirtualDisplay(descriptor: descriptor) else {
            throw DisplayError(description: "macOS refused to make the hidden display")
        }
        let settings = CGVirtualDisplaySettings()
        settings.hiDPI = scale == 2 ? 1 : 0
        settings.modes = [CGVirtualDisplayMode(width: UInt32(size.width), height: UInt32(size.height), refreshRate: 30)]
        guard display.apply(settings) else { throw DisplayError(description: "macOS refused the hidden display's size") }
        self.display = display
        id = display.displayID
        // macOS first slots a new display beside the main one, moving the owner's other displays aside; it goes to the
        // far corner at once, for this program's life only, so their arrangement is back as it was when it ends.
        let origin = displayOrigin(beside: others)
        var configuration: CGDisplayConfigRef?
        CGBeginDisplayConfiguration(&configuration)
        CGConfigureDisplayOrigin(configuration, id, Int32(origin.x), Int32(origin.y))
        let placed = CGCompleteDisplayConfiguration(configuration, .forAppOnly)
        guard placed == .success else { throw DisplayError(description: "macOS refused to place the hidden display (\(placed.rawValue))") }
        bounds = CGDisplayBounds(id)
        // The new arrangement reaches the window server a moment later; read it until it holds.
        for _ in 0..<40 where !fits(bounds, size) || bounds.origin != origin {
            Thread.sleep(forTimeInterval: 0.05)
            bounds = CGDisplayBounds(id)
        }
        // macOS may give a size of its own choosing near the one asked for; any that holds the window will do.
        guard fits(bounds, size) else {
            throw DisplayError(description: "the hidden display came up \(bounds.size), too small for \(size)")
        }
    }

    /**
     * Removes the display while it is still past the corner, and returns once macOS no longer lists it. Left to the
     * program's end, macOS first moves it back beside the main display, shifting the owner's other displays again, and
     * any window still on it lands on the owner's screen; so the recorded program is closed before this.
     */
    public func remove() {
        display = nil
        for _ in 0..<100 where Self.activeDisplays().contains(id) {
            Thread.sleep(forTimeInterval: 0.02)
        }
    }

    static func activeDisplays() -> [CGDirectDisplayID] {
        var ids = [CGDirectDisplayID](repeating: 0, count: 32)
        var count: UInt32 = 0
        CGGetActiveDisplayList(32, &ids, &count)
        return Array(ids.prefix(Int(count)))
    }
}
