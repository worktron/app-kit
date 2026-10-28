import Foundation

/// Runs work after a delay. `Refresh` and `Program` take one so their tests move time themselves instead of waiting
/// for it; apps use the default, a dispatch queue.
public protocol Later: Sendable {
    func after(_ seconds: TimeInterval, _ work: @escaping @Sendable () -> Void)
}

/// `Later` on a dispatch queue.
public struct QueueLater: Later {
    public let queue: DispatchQueue

    public init(_ queue: DispatchQueue) {
        self.queue = queue
    }

    public func after(_ seconds: TimeInterval, _ work: @escaping @Sendable () -> Void) {
        queue.asyncAfter(deadline: .now() + seconds, execute: work)
    }
}
