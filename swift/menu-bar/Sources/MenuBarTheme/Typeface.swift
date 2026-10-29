import AppKit
import CoreText
import SwiftUI

/// JetBrains Mono, bundled at 2.304 in its Regular, SemiBold and Bold faces under the SIL Open Font License (Fonts/OFL.txt).
public enum Typeface {
    public static let family = "JetBrains Mono"
    static let files = ["JetBrainsMono-Regular", "JetBrainsMono-SemiBold", "JetBrainsMono-Bold"]

    /// Registers the bundled faces for this process. A Swift package build finds them in its own resources; a bare swiftc
    /// build, in a `Fonts` folder in `bundle`'s resources, where the app's build copies them. False, with the reason in
    /// `problem`, when they could not be found or registered: the theme then draws in SF Mono.
    @discardableResult
    public static func register(from bundle: Bundle = .main) -> Bool {
        if loaded { return true }
        #if SWIFT_PACKAGE
        let source = Bundle.module
        #else
        let source = bundle
        #endif
        var missing: [String] = []
        for name in files {
            guard let url = source.url(forResource: name, withExtension: "ttf", subdirectory: "Fonts") else {
                missing.append(name)
                continue
            }
            var error: Unmanaged<CFError>?
            // Already registered, by an earlier call in this process, is as good as registered.
            if !CTFontManagerRegisterFontsForURL(url as CFURL, .process, &error), NSFont(name: name, size: Metrics.body) == nil {
                let reason = error?.takeRetainedValue().localizedDescription ?? "unknown"
                problem = "\(name) did not register: \(reason)"
                return false
            }
        }
        if !missing.isEmpty {
            problem = "no \(missing.joined(separator: ", ")).ttf in \(source.resourceURL?.appendingPathComponent("Fonts").path ?? source.bundlePath)"
            return false
        }
        problem = nil
        return loaded
    }

    /// Whether every bundled face resolves by name now.
    public static var loaded: Bool { files.allSatisfy { NSFont(name: $0, size: Metrics.body) != nil } }

    /// Why the last `register` failed, for the app's log.
    public nonisolated(unsafe) private(set) static var problem: String?

    /// The face for a weight: Bold for 700, SemiBold for 600, Regular otherwise, or SF Mono at that weight when the
    /// bundled faces are not registered.
    public static func nsFont(size: CGFloat, weight: NSFont.Weight = .regular) -> NSFont {
        let name = weight >= .bold ? files[2] : weight >= .semibold ? files[1] : files[0]
        return NSFont(name: name, size: size) ?? .monospacedSystemFont(ofSize: size, weight: weight)
    }

    /// The face `look` draws text in: the bundled faces in console; in plain, the system font, and its monospaced
    /// face for `code`, a command to copy.
    public static func nsFont(size: CGFloat, weight: NSFont.Weight = .regular, in look: Look, code: Bool = false) -> NSFont {
        switch look {
        case .console: nsFont(size: size, weight: weight)
        case .plain: code ? .monospacedSystemFont(ofSize: size, weight: weight) : .systemFont(ofSize: size, weight: weight)
        }
    }

    /// How tall SwiftUI makes one line in `font`: the layout manager's height, which rounds the ascender and
    /// descender each to whole points.
    @MainActor static func lineHeight(of font: NSFont) -> CGFloat {
        if let known = lineHeights[font.fontName + " \(font.pointSize)"] { return known }
        let height = NSLayoutManager().defaultLineHeight(for: font)
        lineHeights[font.fontName + " \(font.pointSize)"] = height
        return height
    }

    @MainActor private static var lineHeights: [String: CGFloat] = [:]

    /// The app's look's face for SwiftUI.
    public static func font(size: CGFloat, weight: NSFont.Weight = .regular) -> Font {
        Font(nsFont(size: size, weight: weight, in: Look.app) as CTFont)
    }
}

extension View {
    /// Text in the app's look's face (`code` for a command to copy, monospaced in either look), with lines `lineHeight`
    /// times its size apart, 1.5 unless asked, and the same room above the first and below the last, as the web's
    /// line-height gives, so a block of text is as tall here as in the mockups.
    public func console(_ size: CGFloat, weight: NSFont.Weight = .regular, tone: Tone? = nil, code: Bool = false,
                        lineHeight: CGFloat = Metrics.lineHeight) -> some View {
        modifier(Console(size: size, weight: weight, tone: tone, code: code, lineHeight: lineHeight))
    }
}

struct Console: ViewModifier {
    let size: CGFloat
    let weight: NSFont.Weight
    let tone: Tone?
    let code: Bool
    let lineHeight: CGFloat

    func body(content: Content) -> some View {
        let font = Typeface.nsFont(size: size, weight: weight, in: Look.app, code: code)
        let natural = Typeface.lineHeight(of: font)
        let extra = max(0, size * lineHeight - natural)
        let text = content.font(Font(font as CTFont)).lineSpacing(extra).padding(.vertical, extra / 2)
        if let tone {
            text.foregroundStyle(tone.palette.color)
        } else {
            text
        }
    }
}
