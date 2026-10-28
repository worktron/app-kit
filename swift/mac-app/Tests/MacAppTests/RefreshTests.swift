import AppKit
import Testing
@testable import MacApp

@MainActor
final class Count {
    var runs = 0
}

@MainActor
@Suite struct RefreshTests {
    @Test func runsOnItsClockAndAfterEachWake() {
        let later = HandLater()
        let center = NotificationCenter()
        let count = Count()
        let refresh = Refresh(every: 300, afterWake: 5, center: center, later: later) { count.runs += 1 }
        #expect(count.runs == 0)
        #expect(later.delays == [300])
        later.runNext()
        #expect(count.runs == 1)
        #expect(later.delays == [300])
        center.post(name: NSWorkspace.didWakeNotification, object: nil)
        #expect(later.delays == [300, 5])
        later.runNext()
        later.runNext()
        #expect(count.runs == 3)
        refresh.stop()
        later.runNext()
        center.post(name: NSWorkspace.didWakeNotification, object: nil)
        later.runNext()
        #expect(count.runs == 3)
    }

    /// macOS posts the wake only on NSWorkspace's center; one listening on the default center never hears it.
    @Test func listensWhereMacOSPostsTheWake() {
        let refresh = Refresh(every: 300, later: HandLater()) {}
        #expect(refresh.center === NSWorkspace.shared.notificationCenter)
        refresh.stop()
    }
}
