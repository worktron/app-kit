import AppKit
import SwiftUI

public enum SnapshotError: Error, CustomStringConvertible {
    case font(String)
    case draw

    public var description: String {
        switch self {
        case .font(let why): "the bundled font is not loaded, so a snapshot would show another font: \(why)"
        case .draw: "the view could not be drawn into an image"
        }
    }
}

/// Draws `content` in the panel's frame, `width` points wide and as tall as it is, into a PNG at `scale` pixels a point,
/// in sRGB, with nothing on the screen: through the same hosting view the panel uses, which draws a scroll view's
/// contents where SwiftUI's ImageRenderer leaves them blank. It draws in `appearance`, dark unless asked, never the
/// machine's own setting, so a render is the same at any hour. Throws when the bundled font is not loaded.
@MainActor
public func snapshot<Content: View>(width: CGFloat, scale: CGFloat = 2, appearance: NSAppearance = NSAppearance(named: .darkAqua)!,
                                    state: PanelState? = nil, @ViewBuilder _ content: () -> Content) throws -> Data {
    let state = state ?? PanelState()
    guard Typeface.register() else { throw SnapshotError.font(Typeface.problem ?? "unknown") }
    // Laid out at the scale it is drawn at, as on a Retina screen; outside a window it would round to whole points.
    let scheme: ColorScheme = appearance.bestMatch(from: [.darkAqua, .aqua]) == .aqua ? .light : .dark
    let view = NSHostingView(rootView: PanelRoot(width: width, state: state, content: content())
        .environment(\.displayScale, scale).environment(\.colorScheme, scheme))
    view.appearance = appearance
    view.sizingOptions = []
    // The content reports its height on its first layout, which the frame then takes.
    view.frame = NSRect(x: 0, y: 0, width: width, height: 1)
    view.layoutSubtreeIfNeeded()
    let size = NSSize(width: width, height: state.panelHeight)
    view.frame = NSRect(origin: .zero, size: size)
    view.layoutSubtreeIfNeeded()
    guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size.width * scale), pixelsHigh: Int(size.height * scale),
                                     bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                                     colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)?.retagging(with: .sRGB)
    else { throw SnapshotError.draw }
    rep.size = size
    view.cacheDisplay(in: view.bounds, to: rep)
    guard let png = rep.representation(using: .png, properties: [:]) else { throw SnapshotError.draw }
    return png
}
