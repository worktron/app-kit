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
/// machine's own setting, so a render is the same at any hour, and in `look`, the app's unless asked, which it sets for
/// the draw and puts back after. With a side page open in `state`, the page is drawn beside the panel, its first line
/// level with its row, as the side panel shows it. Throws, in the console look, when the bundled font is not loaded.
@MainActor
public func snapshot<Content: View>(width: CGFloat, scale: CGFloat = 2, appearance: NSAppearance = NSAppearance(named: .darkAqua)!,
                                    look: Look = Look.app, state: PanelState? = nil, @ViewBuilder _ content: () -> Content) throws -> Data {
    let state = state ?? PanelState()
    let before = Look.app
    Look.app = look
    defer { Look.app = before }
    if look == .console, !Typeface.register() { throw SnapshotError.font(Typeface.problem ?? "unknown") }
    let list = try draw(PanelRoot(width: width, state: state, surface: state.list, content: content()), width: width, scale: scale,
                        appearance: appearance, surface: state.list)
    guard let page = state.sidePages.first(where: { $0.id == state.sidePage }) else { return try png(list) }
    guard let list = list.cgImage, let side = try draw(PanelRoot(width: width, state: state, surface: state.side, content: SideContent(state: state)), width: width,
                        scale: scale, appearance: appearance, surface: state.side).cgImage else { throw SnapshotError.draw }
    // Both on one canvas, the side page `gap` to the right, its frame's top line just above its row's top.
    let sideTop = max(0, page.row.minY - Metrics.line) * scale
    let gap = MenuBarPanel.gap * scale
    let canvasWidth = CGFloat(list.width) + gap + CGFloat(side.width)
    let canvasHeight = max(CGFloat(list.height), sideTop + CGFloat(side.height))
    guard let canvas = CGContext(data: nil, width: Int(canvasWidth), height: Int(canvasHeight), bitsPerComponent: 8, bytesPerRow: 0,
                                 space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { throw SnapshotError.draw }
    // Core Graphics counts up from the bottom.
    canvas.draw(list, in: CGRect(x: 0, y: canvasHeight - CGFloat(list.height), width: CGFloat(list.width), height: CGFloat(list.height)))
    canvas.draw(side, in: CGRect(x: CGFloat(list.width) + gap, y: canvasHeight - sideTop - CGFloat(side.height),
                                 width: CGFloat(side.width), height: CGFloat(side.height)))
    guard let both = canvas.makeImage() else { throw SnapshotError.draw }
    return try png(NSBitmapImageRep(cgImage: both))
}

/// One panel's root drawn at its own height, which its first layout reports into `surface`.
@MainActor
private func draw(_ root: some View, width: CGFloat, scale: CGFloat, appearance: NSAppearance, surface: Surface) throws -> NSBitmapImageRep {
    // Laid out at the scale it is drawn at, as on a Retina screen; outside a window it would round to whole points.
    let scheme: ColorScheme = appearance.bestMatch(from: [.darkAqua, .aqua]) == .aqua ? .light : .dark
    let view = NSHostingView(rootView: root.environment(\.displayScale, scale).environment(\.colorScheme, scheme))
    view.appearance = appearance
    view.sizingOptions = []
    // The content reports its height on its first layout, which the frame then takes.
    view.frame = NSRect(x: 0, y: 0, width: width, height: 1)
    view.layoutSubtreeIfNeeded()
    let size = NSSize(width: width, height: surface.panelHeight)
    view.frame = NSRect(origin: .zero, size: size)
    view.layoutSubtreeIfNeeded()
    guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size.width * scale), pixelsHigh: Int(size.height * scale),
                                     bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                                     colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)?.retagging(with: .sRGB)
    else { throw SnapshotError.draw }
    rep.size = size
    view.cacheDisplay(in: view.bounds, to: rep)
    return rep
}

private func png(_ rep: NSBitmapImageRep) throws -> Data {
    guard let png = rep.representation(using: .png, properties: [:]) else { throw SnapshotError.draw }
    return png
}
