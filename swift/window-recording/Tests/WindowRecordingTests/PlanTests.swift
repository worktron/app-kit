import CoreGraphics
import Testing
@testable import WindowRecording

// Only what the recording decides without the screen: nothing here makes a display or records, so nothing opens on the
// owner's screen and no Screen Recording permission is needed.

@Test func argumentsGiveTheWindowSizeTheFileAndTwoPixelsPerPointByDefault() throws {
    let options = try parseOptions(["--width", "1280", "--height", "800", "--out", "/videos/take.mp4"])
    #expect(options == Options(width: 1280, height: 800, out: "/videos/take.mp4", scale: 2))
    #expect(try parseOptions(["--width", "1280", "--height", "800", "--out", "/v.mp4", "--scale", "1"]).scale == 1)
}

@Test func argumentsRefuseAMissingSizeAFileThatIsNotAnMp4AndAnUnknownFlag() {
    #expect(throws: UsageError.self) { try parseOptions(["--height", "800", "--out", "/v.mp4"]) }
    #expect(throws: UsageError.self) { try parseOptions(["--width", "1280", "--height", "800", "--out", "/v.mov"]) }
    #expect(throws: UsageError.self) { try parseOptions(["--width", "1280", "--height", "800", "--out", "/v.mp4", "--fps", "60"]) }
    #expect(throws: UsageError.self) { try parseOptions(["--width", "50", "--height", "800", "--out", "/v.mp4"]) }
}

@Test func linesAreRecordWithAProcessAndStop() {
    #expect(parseCommand("record 4242") == .record(pid: 4242))
    #expect(parseCommand("stop") == .stop)
    #expect(parseCommand("record") == nil)
    #expect(parseCommand("record -1") == nil)
    #expect(parseCommand("quit") == nil)
}

@Test func theDisplayGoesPastTheFarCornerOfEveryOtherDisplay() {
    let main = CGRect(x: 0, y: 0, width: 2560, height: 1440)
    let left = CGRect(x: -2560, y: 0, width: 2560, height: 1440)
    #expect(displayOrigin(beside: [main, left]) == CGPoint(x: 2560, y: 1440))
    let above = CGRect(x: 0, y: -1080, width: 1920, height: 1080)
    #expect(displayOrigin(beside: [main, above]) == CGPoint(x: 2560, y: 1440))
}

@Test func theWindowSitsInsideTheDisplayWithRoomForItsMenuBar() {
    let size = displaySize(window: CGSize(width: 1280, height: 800))
    let display = CGRect(origin: CGPoint(x: 2560, y: 1440), size: size)
    let place = windowPlace(display: display)
    let window = CGRect(origin: place, size: CGSize(width: 1280, height: 800))
    #expect(display.contains(window))
    #expect(place.y - display.minY >= 40)
}

@Test func theWindowRecordedIsTheProcesssLargestOrdinaryWindowOnTheHiddenDisplay() {
    let display = CGRect(x: 2560, y: 1440, width: 1400, height: 920)
    let candidates = [
        Candidate(id: 1, pid: 7, frame: CGRect(x: 2620, y: 1500, width: 1280, height: 800), layer: 0),
        Candidate(id: 2, pid: 7, frame: CGRect(x: 2620, y: 1500, width: 300, height: 400), layer: 101),
        Candidate(id: 3, pid: 7, frame: CGRect(x: 0, y: 0, width: 1800, height: 1000), layer: 0),
        Candidate(id: 4, pid: 8, frame: CGRect(x: 2620, y: 1500, width: 1300, height: 820), layer: 0),
    ]
    #expect(chooseWindow(candidates, pid: 7, display: display) == 1)
    #expect(chooseWindow(candidates, pid: 9, display: display) == nil)
}
