import CoreGraphics
import Testing
@testable import MenuBarTheme

@Suite struct PointerIntentTests {
    /// Whether the selection follows the pointer at `time`, as the panel's timer asks.
    func follows(_ intent: inout PointerIntent, at time: Double) -> Bool { intent.tick(at: time) }

    @Test func aStillPointerSelectsNothing() {
        var intent = PointerIntent()
        intent.moved(to: CGPoint(x: 100, y: 100), at: 0)
        intent.moved(to: CGPoint(x: 101, y: 100), at: 0.05)
        #expect(!follows(&intent, at: 1))
    }

    @Test func aBumpUnder16PointsSelectsNothing() {
        var intent = PointerIntent()
        intent.moved(to: CGPoint(x: 100, y: 100), at: 0)
        intent.moved(to: CGPoint(x: 110, y: 110), at: 0.01)
        #expect(!follows(&intent, at: 1))
    }

    @Test func aMoveThenAHoldSelects() {
        var intent = PointerIntent()
        intent.moved(to: CGPoint(x: 100, y: 100), at: 0)
        intent.moved(to: CGPoint(x: 100, y: 120), at: 0.01)
        intent.moved(to: CGPoint(x: 102, y: 122), at: 0.05)
        #expect(!follows(&intent, at: 0.09))
        #expect(follows(&intent, at: 0.12))
        // It rests there now: the same spot selects nothing more.
        #expect(!follows(&intent, at: 0.5))
    }

    @Test func movingOnRestartsTheHold() {
        var intent = PointerIntent()
        intent.moved(to: CGPoint(x: 100, y: 100), at: 0)
        intent.moved(to: CGPoint(x: 100, y: 120), at: 0.01)
        intent.moved(to: CGPoint(x: 100, y: 140), at: 0.08)
        #expect(!follows(&intent, at: 0.12))
        #expect(follows(&intent, at: 0.19))
    }

    @Test func aKeyPressMakesTheNextReportTheRestingPoint() {
        var intent = PointerIntent()
        intent.moved(to: CGPoint(x: 100, y: 100), at: 0)
        intent.moved(to: CGPoint(x: 100, y: 130), at: 0.01)
        intent.reset()
        // The arrows moved the selection; a bump after them does not undo it.
        intent.moved(to: CGPoint(x: 100, y: 131), at: 0.02)
        intent.moved(to: CGPoint(x: 100, y: 140), at: 0.03)
        #expect(!follows(&intent, at: 1))
    }
}
