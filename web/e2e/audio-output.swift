// Records which processes play sound, for offline-audio.e2e.ts: macOS's audio service keeps one object for each process
// that uses it, and says of each whether it is running output, which is a process with an output device open. Reading
// it needs no permission. Prints "ready" once it has read the list, then one line of JSON the first time each process
// is seen running output: its pid, its executable and the pids of its parents, read while it is still running, so a
// test can tell its own browser from any other. Polls every 20ms, and exits when its input closes. A line "mark" on its
// input is answered with "mark" once a whole poll that began after it has been printed, so every process that was
// running output before the mark was sent is in the lines before the answer.
import CoreAudio
import Foundation

func address(_ selector: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
  AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
}

func processObjects() -> [AudioObjectID]? {
  var list = address(kAudioHardwarePropertyProcessObjectList)
  let system = AudioObjectID(kAudioObjectSystemObject)
  var size: UInt32 = 0
  guard AudioObjectGetPropertyDataSize(system, &list, 0, nil, &size) == noErr else { return nil }
  var ids = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
  guard AudioObjectGetPropertyData(system, &list, 0, nil, &size, &ids) == noErr else { return nil }
  return ids
}

func number(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> Int32? {
  var property = address(selector)
  var value: Int32 = 0
  var size = UInt32(MemoryLayout<Int32>.size)
  return AudioObjectGetPropertyData(object, &property, 0, nil, &size, &value) == noErr ? value : nil
}

func executable(_ pid: pid_t) -> String {
  var path = [CChar](repeating: 0, count: 4096)
  return proc_pidpath(pid, &path, UInt32(path.count)) > 0 ? String(cString: path) : ""
}

func parents(_ pid: pid_t) -> [pid_t] {
  var chain: [pid_t] = []
  var current = pid
  while current > 1, chain.count < 64 {
    var info = kinfo_proc()
    var size = MemoryLayout<kinfo_proc>.stride
    var name: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, current]
    guard sysctl(&name, 4, &info, &size, nil, 0) == 0, size > 0 else { break }
    current = info.kp_eproc.e_ppid
    chain.append(current)
  }
  return chain
}

guard processObjects() != nil else {
  FileHandle.standardError.write("audio-output: macOS's audio service gave no list of processes\n".data(using: .utf8)!)
  exit(1)
}
let marks = NSLock()
var marksAsked = 0
DispatchQueue.global().async {
  while let line = readLine() {
    if line == "mark" {
      marks.lock()
      marksAsked += 1
      marks.unlock()
    }
  }
  exit(0)
}
print("ready")
fflush(stdout)
var seen = Set<pid_t>()
while true {
  marks.lock()
  let answering = marksAsked
  marksAsked = 0
  marks.unlock()
  for object in processObjects() ?? [] {
    guard number(object, kAudioProcessPropertyIsRunningOutput) == 1, let pid = number(object, kAudioProcessPropertyPID), !seen.contains(pid) else { continue }
    seen.insert(pid)
    let line: [String: Any] = ["pid": pid, "executable": executable(pid), "parents": parents(pid)]
    print(String(data: try! JSONSerialization.data(withJSONObject: line), encoding: .utf8)!)
    fflush(stdout)
  }
  for _ in 0..<answering { print("mark") }
  fflush(stdout)
  usleep(20_000)
}
