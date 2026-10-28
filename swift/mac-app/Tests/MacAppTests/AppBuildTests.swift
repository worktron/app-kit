import Testing
@testable import MacApp

@Suite struct AppBuildTests {
    @Test func theVersionAndTheStampedCommit() {
        let build = AppBuild(info: ["CFBundleShortVersionString": "1.2.0", "MyCommit": " 683f92e with uncommitted changes "], commitKey: "MyCommit")
        #expect(build == AppBuild(version: "1.2.0", commit: "683f92e with uncommitted changes"))
        #expect(build.description == "1.2.0, 683f92e with uncommitted changes")
    }

    @Test func aBuildNothingStampedIsADevelopmentBuild() {
        #expect(AppBuild(info: ["CFBundleShortVersionString": "1.2.0", "MyCommit": "$(MY_COMMIT)"], commitKey: "MyCommit").description == "1.2.0, development build")
        #expect(AppBuild(info: [:], commitKey: "MyCommit").description == "unknown, development build")
    }
}
