import AppKit

/// Work that runs on a clock (a poll, a status read) and catches up when the Mac wakes, since a timer does not fire
/// while it sleeps. It runs `work` every `interval` seconds and `afterWake` seconds after each wake, which gives the
/// network a moment to come back (perf-buddy waits five). It does not run at once: the app runs its first read itself.
@MainActor
public final class Refresh {
    /// Where macOS posts the wake: NSWorkspace's own center, never the default one, which never hears it.
    public let center: NotificationCenter
    let later: any Later
    let work: @MainActor () -> Void
    private var observer: NSObjectProtocol?
    private var stopped = false

    public init(every interval: TimeInterval, afterWake: TimeInterval = 0,
                center: NotificationCenter = NSWorkspace.shared.notificationCenter,
                later: any Later = QueueLater(.main), work: @escaping @MainActor () -> Void) {
        self.center = center
        self.later = later
        self.work = work
        tick(every: interval)
        observer = center.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.wake(after: afterWake) }
        }
    }

    /// Stops the clock and the wake: nothing runs after this.
    public func stop() {
        stopped = true
        if let observer { center.removeObserver(observer) }
        observer = nil
    }

    private func tick(every interval: TimeInterval) {
        later.after(interval) { [weak self] in
            MainActor.assumeIsolated {
                guard let self, !self.stopped else { return }
                self.work()
                self.tick(every: interval)
            }
        }
    }

    private func wake(after delay: TimeInterval) {
        later.after(delay) { [weak self] in
            MainActor.assumeIsolated {
                guard let self, !self.stopped else { return }
                self.work()
            }
        }
    }
}
