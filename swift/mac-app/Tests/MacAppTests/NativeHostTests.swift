import Foundation
import Testing
@testable import MacApp

@Suite struct NativeHostTests {
    let folder = TestFolder.make()
    static let id = "anhanhbcgcbkmkplbafdhdhcllhecmfg"

    /// The same key and ID the TypeScript kit's test holds (extension/test/install.test.ts), so both sides agree.
    @Test func theExtensionIDIsChromesForTheKey() {
        let key = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAjhCgiHc5+4kh0/UYgWEKVV2p4Yaz1MWyGb8xGO03q0cBeNUvbo1TCSszsm5kiQPms7HG5dpcLUALy+EYQFEBd1dh4jM9H0/5lOxJU3/PFsJfr4pUQPLNhib/oN5FLxU8kozrmdQFx6KuWzBDGYjN0NZDlGrAXzdEHfHJrS3oHYkW+0GcEhh0Dg15NEQ5eOTiC1+RYVVDRaWxAyQR2bqRxqynxECtuA0qZUHnw2HqoyVOvkT43oR4KswrmvGcBM4jyh1WGEojXBVsRhqJ4qZcYW0HN3gZeJ3wvW3wKCTIzJdA78H/I3TSORFxQf6gRhrc4algt/noaUGNDWpMrngxRwIDAQAB"
        #expect(NativeHost.extensionID(key: key) == Self.id)
        #expect(NativeHost.extensionID(key: "not base64!") == nil)
    }

    @Test func theNameAndIDsAreChromes() {
        #expect(throws: NativeHost.Problem.badName("com.Example")) { try NativeHost(name: "com.Example", description: "", extensionIDs: []) }
        #expect(throws: NativeHost.Problem.badName("com..example")) { try NativeHost(name: "com..example", description: "", extensionIDs: []) }
        #expect(throws: NativeHost.Problem.badExtensionID("abc")) { try NativeHost(name: "com.example.app", description: "", extensionIDs: ["abc"]) }
    }

    @Test func theManifestIsWrittenOnceAndOnlyWhenItChanges() throws {
        let host = try NativeHost(name: "com.example.app", description: "Example: the app's host", extensionIDs: [Self.id])
        let hosts = folder.appendingPathComponent("NativeMessagingHosts")
        #expect(try host.install(executable: "/Applications/Example.app/Contents/MacOS/Example", in: hosts))
        let file = hosts.appendingPathComponent("com.example.app.json")
        let written = try JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any]
        #expect(written?["path"] as? String == "/Applications/Example.app/Contents/MacOS/Example")
        #expect(written?["type"] as? String == "stdio")
        #expect(written?["allowed_origins"] as? [String] == ["chrome-extension://\(Self.id)/"])
        #expect(try !host.install(executable: "/Applications/Example.app/Contents/MacOS/Example", in: hosts))
        #expect(try host.install(executable: "/Applications/Other.app/Contents/MacOS/Example", in: hosts))
        #expect(try FileManager.default.contentsOfDirectory(atPath: hosts.path) == ["com.example.app.json"])
    }

    @Test func onlyTheExtensionsItNamesMayStartIt() throws {
        let host = try NativeHost(name: "com.example.app", description: "", extensionIDs: [Self.id])
        #expect(host.allows(origin: "chrome-extension://\(Self.id)/"))
        #expect(!host.allows(origin: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"))
    }

    @Test func onlyTheInstalledCopyClaimsTheHostWhenThereIsOne() {
        let installed = URL(fileURLWithPath: "/Applications/Example.app/Contents/MacOS/Example")
        let debug = "/private/var/folders/x/DerivedData/Example.app/Contents/MacOS/Example"
        #expect(NativeHost.claims(executable: installed.path, installed: installed) { _ in true })
        #expect(!NativeHost.claims(executable: debug, installed: installed) { _ in true })
        #expect(NativeHost.claims(executable: debug, installed: installed) { _ in false })
        #expect(NativeHost.claims(executable: debug, installed: installed, testFolder: true) { _ in true })
    }

    @Test func messagesAreFramedAsChromeFramesThem() {
        let payload = Data(#"{"ok":true}"#.utf8)
        var input = NativeHost.frame(payload) + NativeHost.frame(Data("{}".utf8)) + Data([1, 0])
        #expect(NativeHost.frame(payload).prefix(4) == Data([11, 0, 0, 0]))
        let read = { (count: Int) -> Data in
            let chunk = input.prefix(count)
            input = input.dropFirst(chunk.count)
            return Data(chunk)
        }
        #expect(NativeHost.readMessage(read) == payload)
        #expect(NativeHost.readMessage(read) == Data("{}".utf8))
        #expect(NativeHost.readMessage(read) == nil)
        input = NativeHost.frame(Data(count: 20))
        #expect(NativeHost.readMessage(maxSize: 10, read) == nil)
    }
}
