import Foundation

// The record of what each keep list did, apart from iOS so `Tests/main.swift` runs it on the Mac with bare swiftc. The
// plugin saves it on the phone and the page reads it with `keep_record`, since the phone's own log is out of reach.

/// The UserDefaults key the records are saved under (`KEEP_RECORD_KEY` in tauri/iphone-notifications/names.ts).
let keepRecordKey = "app-kit.iphone-notifications.keep-record"

/// How many records the phone keeps. The oldest goes first.
let keepRecordLimit = 50

/// How many of the delivered notifications a list kept, by the reason it kept each.
struct KeptCounts: Codable, Equatable {
    var onList = 0
    var sentAfter = 0
    var notFromPush = 0
}

/// What one removal decided and did, as `removeHandled` reports it.
struct KeepOutcome: Equatable {
    /// How many notifications iOS listed as delivered.
    var delivered = 0
    /// The identifiers removed.
    var removed: [String] = []
    var kept = KeptCounts()
    /// How many of the removed iOS still listed after five seconds.
    var left = 0

    mutating func count(_ decision: KeepDecision, id: String) {
        switch decision {
        case .remove: removed.append(id)
        case .keepOnList: kept.onList += 1
        case .keepSentAfter: kept.sentAfter += 1
        case .keepNotFromPush: kept.notFromPush += 1
        }
    }
}

/// One keep list or page keep call, as the page reads it.
struct KeepRecord: Codable, Equatable {
    /// When the record was saved, in milliseconds since 1970 on the phone's clock, and always later than the record
    /// before it, so clearing through a record the page read never clears one saved after the read.
    var at: Double
    /// `keep list` for a silent push, `page` for the page's own keep call.
    let source: String
    /// The app's state then: `in front`, `coming to the front` or `in the background`.
    let state: String
    /// When the server sent the list, in milliseconds since 1970 on the server's clock; none for a push without one.
    let sent: Double?
    /// How many tags the list kept; none for a push without a list.
    let keep: Int?
    /// Why nothing was removed without looking, for a push with no list or a list with no send time.
    let skipped: String?
    let delivered: Int
    let removed: [String]
    let kept: KeptCounts
    let left: Int

    init(at: Double = 0, source: String, state: String, sent: Double?, keep: Int?, skipped: String? = nil, outcome: KeepOutcome = KeepOutcome()) {
        self.at = at
        self.source = source
        self.state = state
        self.sent = sent
        self.keep = keep
        self.skipped = skipped
        delivered = outcome.delivered
        removed = outcome.removed
        kept = outcome.kept
        left = outcome.left
    }
}

/// The saved records, oldest first. Data that does not parse reads as none, so one bad write cannot stop new records.
func decodeKeepRecords(_ data: Data?) -> [KeepRecord] {
    guard let data = data else { return [] }
    return (try? JSONDecoder().decode([KeepRecord].self, from: data)) ?? []
}

func encodeKeepRecords(_ records: [KeepRecord]) -> Data {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    return (try? encoder.encode(records)) ?? Data("[]".utf8)
}

/// The records with `record` added last, stamped `now` or just after the last record when the clock reads earlier
/// (a removal that took seconds, or the phone's clock set back), the oldest dropped past the limit.
func appendingKeepRecord(_ records: [KeepRecord], _ record: KeepRecord, now: Double) -> [KeepRecord] {
    var stamped = record
    stamped.at = max(now, (records.last?.at ?? 0) + 1)
    return Array((records + [stamped]).suffix(keepRecordLimit))
}

/// The records left once those handled at or before `through` are cleared. 0 clears none.
func clearingKeepRecords(_ records: [KeepRecord], through: Double) -> [KeepRecord] {
    through > 0 ? records.filter { $0.at > through } : records
}

/// The answer to the page: the records as JSON with a closing zero byte when they fit in `capacity` bytes, else how many
/// bytes they need, so the caller asks again with room and nothing is lost or cut short.
enum KeepRecordCopy: Equatable {
    case fits([UInt8])
    case needs(Int)
}

func copyKeepRecords(_ json: Data, capacity: Int) -> KeepRecordCopy {
    let bytes = [UInt8](json) + [0]
    return bytes.count <= capacity ? .fits(bytes) : .needs(bytes.count)
}
