import CryptoKit
import Foundation

/// An app that is its own Chrome native messaging host: the manifest Chrome reads to start it, which names the
/// extensions allowed to, written beside Chrome's other hosts and only when it changed; the framing of the messages;
/// and the check of the extension Chrome started it for. The kit's TypeScript host (extension/host) serves a command
/// line tool through a launcher script instead.
public struct NativeHost: Sendable, Equatable {
    public let name: String
    public let description: String
    public let allowedOrigins: [String]

    public enum Problem: Error, Equatable {
        /// Chrome takes lowercase letters, digits and underscores, in parts joined by single dots.
        case badName(String)
        /// An extension's ID is 32 letters from a to p.
        case badExtensionID(String)
    }

    /// The host `name`, which the extension connects to, for the extensions with `extensionIDs`.
    public init(name: String, description: String, extensionIDs: [String]) throws {
        guard Self.isHostName(name) else { throw Problem.badName(name) }
        if let bad = extensionIDs.first(where: { !Self.isExtensionID($0) }) { throw Problem.badExtensionID(bad) }
        self.name = name
        self.description = description
        allowedOrigins = extensionIDs.map { "chrome-extension://\($0)/" }
    }

    static func isHostName(_ name: String) -> Bool {
        name.split(separator: ".", omittingEmptySubsequences: false).allSatisfy { part in
            !part.isEmpty && part.allSatisfy { ("a"..."z").contains($0) || ("0"..."9").contains($0) || $0 == "_" }
        }
    }

    static func isExtensionID(_ id: String) -> Bool {
        id.count == 32 && id.allSatisfy { ("a"..."p").contains($0) }
    }

    /// Where Chrome looks for hosts, for every profile of the signed-in user. macOS leaves this one folder inside
    /// Chrome's data folder readable and writable.
    public static func chromeHostsFolder(home: URL = FileManager.default.homeDirectoryForCurrentUser) -> URL {
        home.appendingPathComponent("Library/Application Support/Google/Chrome/NativeMessagingHosts", isDirectory: true)
    }

    /// The manifest for the host at `executable`.
    public func manifest(executable: String) -> Data {
        let manifest: [String: Any] = [
            "name": name,
            "description": description,
            "path": executable,
            "type": "stdio",
            "allowed_origins": allowedOrigins,
        ]
        return (try? JSONSerialization.data(withJSONObject: manifest, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])) ?? Data()
    }

    /// Writes the manifest into `folder`, under another name and renamed into place so Chrome never reads half of it,
    /// unless it already says the same. Answers whether it wrote.
    @discardableResult
    public func install(executable: String, in folder: URL) throws -> Bool {
        let file = folder.appendingPathComponent("\(name).json")
        let manifest = manifest(executable: executable)
        if (try? Data(contentsOf: file)) == manifest { return false }
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try manifest.write(to: file, options: .atomic)
        return true
    }

    /// Whether Chrome started this host for an extension the manifest names. Chrome passes the caller's origin as the
    /// host's first argument; a host answers anything else with a refusal and a line in its log.
    public func allows(origin: String) -> Bool {
        allowedOrigins.contains(origin)
    }

    /// Whether the build at `executable` writes the manifest. The copy installed at `installed` (the app's executable
    /// in Applications) always does; any other build does only when no copy is installed, or when `testFolder` is
    /// true because a test moved the manifest's folder out of Chrome's, so a Debug build in a folder macOS clears
    /// never takes Chrome's host from the installed app.
    public static func claims(executable: String, installed: URL, testFolder: Bool = false,
                              fileExists: (String) -> Bool = FileManager.default.fileExists(atPath:)) -> Bool {
        if testFolder { return true }
        let installedPath = installed.resolvingSymlinksInPath().path
        if URL(fileURLWithPath: executable).resolvingSymlinksInPath().path == installedPath { return true }
        return !fileExists(installedPath)
    }

    /// The ID Chrome gives an extension whose manifest carries `key` (the base64 of its public key): the first 32 hex
    /// digits of the key's SHA-256, each written as a letter from a to p. Nil when `key` is not base64.
    public static func extensionID(key: String) -> String? {
        guard let der = Data(base64Encoded: key) else { return nil }
        let letters = Array("abcdefghijklmnop")
        return SHA256.hash(data: der).prefix(16).map { "\(letters[Int($0 >> 4)])\(letters[Int($0 & 0xF)])" }.joined()
    }

    /// The most a host reads in one message. Chrome caps a host's replies at 1 MB; a host holds what it reads to the
    /// same.
    public static let maxMessageSize = 1024 * 1024

    /// One message as Chrome frames it: UTF-8 JSON preceded by its length as a 32-bit little-endian integer.
    public static func frame(_ payload: Data) -> Data {
        var length = UInt32(payload.count).littleEndian
        return Data(bytes: &length, count: 4) + payload
    }

    /// Reads one message with `read(n)`, which returns up to n bytes, fewer only at the end of input. Nil at the end
    /// of input, on a cut-off frame, or past `maxSize`.
    public static func readMessage(maxSize: Int = maxMessageSize, _ read: (Int) -> Data) -> Data? {
        let header = read(4)
        guard header.count == 4 else { return nil }
        let length = header.withUnsafeBytes { Int(UInt32(littleEndian: $0.loadUnaligned(as: UInt32.self))) }
        guard length <= maxSize else { return nil }
        let payload = read(length)
        return payload.count == length ? payload : nil
    }

    /// Reads `count` bytes of standard input, fewer only at its end: the `read` a host passes to `readMessage`.
    public static func readInput(_ count: Int) -> Data {
        var data = Data()
        while data.count < count {
            guard let chunk = try? FileHandle.standardInput.read(upToCount: count - data.count), !chunk.isEmpty else { break }
            data.append(chunk)
        }
        return data
    }
}
