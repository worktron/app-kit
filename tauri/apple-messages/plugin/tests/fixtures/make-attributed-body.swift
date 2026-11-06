// Makes the message bodies the Messages reader's tests decode
// (../src/reader.rs), in the format Messages writes to
// chat.db's attributedBody: an NSMutableAttributedString carrying
// Messages' part attribute, archived by NSArchiver (typedstream). The
// output matches a real body byte for byte through the string and its
// first attribute. Run from this folder, then commit the .bin files:
//
//   swift make-attributed-body.swift
import Foundation

func write(_ name: String, _ text: String) {
  let body = NSMutableAttributedString(
    string: text, attributes: [NSAttributedString.Key("__kIMMessagePartAttributeName"): 0])
  let data = NSArchiver.archivedData(withRootObject: body)
  FileManager.default.createFile(atPath: "attributed-body/\(name).bin", contents: data)
}

write("hello", "Hello")
// Length heads: under 0x80 a single byte, 0x81 then two bytes, 0x82 then four.
write("len127", String(repeating: "a", count: 127))
write("len128", String(repeating: "b", count: 128))
write("len200", String(repeating: "c", count: 200))
write("len256", String(repeating: "d", count: 256))
write("len70000", String(repeating: "e", count: 70000))
// A photo is U+FFFC in the text, one per attachment; a caption follows it.
write("photo", "\u{FFFC}")
write("photo-caption", "\u{FFFC}Look at this 👋")
