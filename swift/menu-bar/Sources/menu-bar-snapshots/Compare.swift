import AppKit
import Foundation

/// What a hidden Chromium measured in a mockup (e2e/compare-mockups.ts), in CSS pixels from the panel's top left.
struct Measured: Decodable {
    struct Box: Decodable {
        let x, y, w, h: Double
        let background: String?
        let borderBottom: String?
        let name: String
    }

    struct Run: Decodable {
        let x, y, w, h: Double
        let color: String
        let text: String
    }

    let scale: Double
    let boxes: [Box]
    let texts: [Run]
}

/// An image's pixels as sRGB bytes, four to a pixel, with the top row first.
struct Pixels {
    let width: Int
    let height: Int
    var bytes: [UInt8]

    init(png url: URL) throws {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil), let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
            throw CocoaError(.fileReadCorruptFile, userInfo: [NSFilePathErrorKey: url.path])
        }
        self.init(width: image.width, height: image.height)
        draw(image, at: 0)
    }

    init(width: Int, height: Int, fill: UInt32 = 0x08080a) {
        self.width = width
        self.height = height
        bytes = [UInt8](repeating: 255, count: width * height * 4)
        for i in 0..<(width * height) {
            bytes[i * 4] = UInt8((fill >> 16) & 0xff)
            bytes[i * 4 + 1] = UInt8((fill >> 8) & 0xff)
            bytes[i * 4 + 2] = UInt8(fill & 0xff)
        }
    }

    /// Draws `image` with its left edge at `x`, top aligned.
    mutating func draw(_ image: CGImage, at x: Int) {
        let (w, h) = (width, height)
        bytes.withUnsafeMutableBytes { buffer in
            let context = CGContext(data: buffer.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                                    space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
            context.draw(image, in: CGRect(x: x, y: h - image.height, width: image.width, height: image.height))
        }
    }

    func color(_ x: Int, _ y: Int) -> (Int, Int, Int) {
        let i = (min(max(y, 0), height - 1) * width + min(max(x, 0), width - 1)) * 4
        return (Int(bytes[i]), Int(bytes[i + 1]), Int(bytes[i + 2]))
    }

    var image: CGImage {
        let provider = CGDataProvider(data: Data(bytes) as CFData)!
        return CGImage(width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: width * 4,
                       space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
                       provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)!
    }
}

func rgb(_ hex: String) -> (Int, Int, Int) {
    let value = Int(hex.dropFirst(), radix: 16) ?? 0
    return ((value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff)
}

func apart(_ a: (Int, Int, Int), _ b: (Int, Int, Int)) -> Int { max(abs(a.0 - b.0), abs(a.1 - b.1), abs(a.2 - b.2)) }

/// How far, in points, a run of text may start or end from where the mockup draws it; how far a background or line's
/// color may be from the token, in bytes; how far a run's strongest pixel may be from its color.
let textLimit = 2.0
let fillLimit = 3
let inkLimit = 24

/// The box around a run's ink inside `region` (pixels), where ink is anything at least a third of the way from the
/// region's most common color, its background, to the run's color.
func ink(in pixels: Pixels, region: (x0: Int, y0: Int, x1: Int, y1: Int), color: (Int, Int, Int)) -> (x0: Int, y0: Int, x1: Int, y1: Int, strongest: (Int, Int, Int))? {
    var counts: [Int: Int] = [:]
    for y in region.y0..<region.y1 { for x in region.x0..<region.x1 { let c = pixels.color(x, y); counts[c.0 << 16 | c.1 << 8 | c.2, default: 0] += 1 } }
    guard let common = counts.max(by: { $0.value < $1.value })?.key else { return nil }
    let background = ((common >> 16) & 0xff, (common >> 8) & 0xff, common & 0xff)
    let threshold = max(8, apart(color, background) / 3)
    var found: (x0: Int, y0: Int, x1: Int, y1: Int, strongest: (Int, Int, Int))?
    var strongest = 0
    for y in region.y0..<region.y1 {
        for x in region.x0..<region.x1 {
            let c = pixels.color(x, y)
            let distance = apart(c, background)
            guard distance >= threshold else { continue }
            if var box = found {
                box.x0 = min(box.x0, x); box.y0 = min(box.y0, y); box.x1 = max(box.x1, x); box.y1 = max(box.y1, y)
                if distance > strongest { box.strongest = c; strongest = distance }
                found = box
            } else {
                found = (x, y, x, y, c)
                strongest = distance
            }
        }
    }
    return found
}

/// Checks the theme's render of `screen` against the mockup's, and writes the two side by side. Each problem found, in words.
func compare(screen: String, mockups: URL, theme: URL, out: URL) throws -> [String] {
    let mock = try Pixels(png: mockups.appendingPathComponent("\(screen).png"))
    let drawn = try Pixels(png: theme.appendingPathComponent("\(screen).png"))
    let measured = try JSONDecoder().decode(Measured.self, from: Data(contentsOf: mockups.appendingPathComponent("\(screen).json")))
    let scale = measured.scale
    var problems: [String] = []

    var side = Pixels(width: mock.width + drawn.width + 32, height: max(mock.height, drawn.height))
    side.draw(mock.image, at: 0)
    side.draw(drawn.image, at: mock.width + 32)
    try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
    let rep = NSBitmapImageRep(cgImage: side.image)
    try rep.representation(using: .png, properties: [:])!.write(to: out.appendingPathComponent("\(screen).png"))

    if abs(mock.width - drawn.width) > 1 || abs(mock.height - drawn.height) > Int(scale) {
        problems.append("the theme draws \(drawn.width)×\(drawn.height) pixels where the mockup is \(mock.width)×\(mock.height)")
        // Where each draws its lines, down the left padding, so the line that moved can be found.
        let lines = { (pixels: Pixels) in (0..<pixels.height).filter { apart(pixels.color(Int(8 * scale), $0), rgb("#1c1c1c")) <= fillLimit }.map { Double($0) / scale } }
        problems.append("lines at \(lines(drawn)) where the mockup has them at \(lines(mock))")
        return problems
    }
    let px = { (v: Double) in Int((v * scale).rounded(.down)) }
    for box in measured.boxes {
        // The left padding, halfway down, is the box's own background.
        if let background = box.background {
            let (x, y) = (px(box.x + 4), px(box.y + box.h / 2))
            let got = drawn.color(x, y)
            if apart(got, rgb(background)) > fillLimit { problems.append("\(box.name)'s background is \(got) where the mockup's is \(background)") }
        }
        if let border = box.borderBottom {
            let (x, y) = (px(box.x + 4), px(box.y + box.h) - 1)
            let got = drawn.color(x, y)
            if apart(got, rgb(border)) > fillLimit { problems.append("\(box.name)'s bottom line is \(got) at y \(box.y + box.h) where the mockup's is \(border)") }
        }
    }
    for run in measured.texts {
        let region = (x0: max(0, px(run.x - 3)), y0: max(0, px(run.y - 2)), x1: min(mock.width, px(run.x + run.w + 3)), y1: min(mock.height, px(run.y + run.h + 2)))
        let color = rgb(run.color)
        guard let want = ink(in: mock, region: region, color: color) else { continue }
        guard let got = ink(in: drawn, region: region, color: color) else {
            problems.append("\"\(run.text)\" is not drawn where the mockup draws it")
            continue
        }
        let edges = [("left", want.x0, got.x0), ("right", want.x1, got.x1), ("top", want.y0, got.y0), ("bottom", want.y1, got.y1)]
        for (edge, a, b) in edges where Double(abs(a - b)) / scale > textLimit {
            problems.append("\"\(run.text)\"'s \(edge) edge is \(Double(b - a) / scale) points from the mockup's")
        }
        if apart(got.strongest, color) > inkLimit { problems.append("\"\(run.text)\" is drawn in \(got.strongest) where the mockup's color is \(run.color)") }
    }
    return problems
}
