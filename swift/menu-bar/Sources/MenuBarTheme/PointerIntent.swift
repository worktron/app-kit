import Foundation

/// Whether the pointer means a row yet: it must move 16 points in a straight line from where it rested, then hold within
/// 6 points for 100ms, before the selection follows it. A key press, or the panel losing the keyboard, makes the next
/// report the new resting point, so a bump never undoes the arrows. Pure: the panel feeds it moves and ticks.
public struct PointerIntent: Sendable {
    public static let travel: CGFloat = 16
    public static let hold: CGFloat = 6
    public static let wait: TimeInterval = 0.1

    /// Where the pointer last rested; nil until the next report, which becomes it.
    private var rest: CGPoint?
    /// Where it has held since `since`, once it has travelled far enough from `rest`.
    private var holding: CGPoint?
    private var since: TimeInterval = 0

    public init() {}

    public mutating func moved(to point: CGPoint, at time: TimeInterval) {
        guard let rest else {
            self.rest = point
            return
        }
        if let holding {
            if distance(point, holding) > Self.hold { self.holding = point; since = time }
        } else if distance(point, rest) >= Self.travel {
            holding = point
            since = time
        }
    }

    /// True once, when the pointer has travelled and then held long enough: the selection follows it now, and it rests there.
    public mutating func tick(at time: TimeInterval) -> Bool {
        guard let holding, time - since >= Self.wait else { return false }
        rest = holding
        self.holding = nil
        return true
    }

    /// A key press or the panel losing the keyboard: the next report is where the pointer rests.
    public mutating func reset() {
        rest = nil
        holding = nil
    }

    private func distance(_ a: CGPoint, _ b: CGPoint) -> CGFloat { hypot(a.x - b.x, a.y - b.y) }
}
