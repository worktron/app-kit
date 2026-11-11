import Foundation

// The rules a keep list removes by, apart from iOS so `Tests/main.swift` runs them on the Mac with bare swiftc.

/// What the rules read of one delivered notification.
struct DeliveredNotification {
    let id: String
    /// Whether a push brought it. One the app made on the phone itself is never the server's to remove.
    let fromPush: Bool
    /// When the server sent it, in milliseconds since 1970; none for one sent before the plugin read send times.
    let sent: Double?
    /// The tags a summary stands for; none for a notification that is only its own tag.
    let covers: [String]?
}

enum KeepDecision: Equatable {
    case remove
    case keepNotFromPush
    case keepSentAfter
    case keepOnList(String)
}

/// iOS cuts a collapse id, which becomes the notification's identifier, at 64 bytes, so a tag on a list is cut the same way.
func identifierOf(_ tag: String) -> String {
    var bytes = 0
    var cut = ""
    for character in tag {
        bytes += character.utf8.count
        if bytes > 64 { break }
        cut.append(character)
    }
    return cut
}

/// A notification stays when the app made it, when it was sent at or after the list (`before`), or while any tag it
/// stands for is on the list (`kept`, already cut by `identifierOf`). One with no send time counts as older.
func keepDecision(for notification: DeliveredNotification, kept: Set<String>, before: Double) -> KeepDecision {
    if !notification.fromPush { return .keepNotFromPush }
    if let sent = notification.sent, sent >= before { return .keepSentAfter }
    let tags = notification.covers?.map(identifierOf) ?? [notification.id]
    if let waiting = tags.first(where: kept.contains) { return .keepOnList(waiting) }
    return .remove
}
