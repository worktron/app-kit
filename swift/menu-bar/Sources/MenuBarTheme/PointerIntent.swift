import Foundation

/// When the pointer may act without a click, the same rule as the kit's web half (`web/hover-intent.ts`), whose
/// numbers `test/hover-intent-swift.test.ts` holds this file to:
///
/// 1. A pointer that has not moved does nothing. Its first report after the panel opens, a key press or the panel
///    losing the keyboard only marks where it rests, so a bump never undoes the arrows.
/// 2. Once it has travelled 16 points in a straight line from there, it has `reached`: the line under it lights at once
///    and follows it from line to line, as a menu's highlight does.
/// 3. What it opens waits until it holds within 6 points for 100ms, so a sweep across rows on the way to a side page
///    opens nothing on the way. A click acts at once.
///
/// Pure: the panel feeds it moves and ticks.
public struct PointerIntent: Sendable {
    public static let travel: CGFloat = 16
    public static let hold: CGFloat = 6
    public static let wait: TimeInterval = 0.1

    /// Where the pointer last rested; nil until the next report, which becomes it.
    private var rest: CGPoint?
    /// Whether it has travelled from `rest`: the line under it lights, until a key press or the keyboard leaving.
    public private(set) var reached = false
    /// Where it has held since `since`, and whether that hold has already been answered.
    private var still: CGPoint?
    private var since: TimeInterval = 0
    private var answered = false

    public init() {}

    public mutating func moved(to point: CGPoint, at time: TimeInterval) {
        guard let rest else {
            self.rest = point
            return
        }
        if !reached {
            guard distance(point, rest) >= Self.travel else { return }
            reached = true
        }
        // A drift within the hold being timed, or the one already answered, is the same pause, never a second one.
        if let still, distance(point, still) <= Self.hold { return }
        still = point
        since = time
        answered = false
    }

    /// True once per hold, when the pointer has reached and then held long enough: what it rests on opens now.
    public mutating func tick(at time: TimeInterval) -> Bool {
        guard reached, still != nil, !answered, time - since >= Self.wait else { return false }
        answered = true
        return true
    }

    /// A key press or the panel losing the keyboard: the next report is where the pointer rests.
    public mutating func reset() {
        rest = nil
        reached = false
        still = nil
        answered = false
    }

    private func distance(_ a: CGPoint, _ b: CGPoint) -> CGFloat { hypot(a.x - b.x, a.y - b.y) }
}
