//! Reading Apple Messages on the Mac. macOS keeps every text in
//! ~/Library/Messages/chat.db, which it opens only to an app the person has
//! added to Full Disk Access; Messages offers no other way to read a text
//! (its scripting dictionary has no message class). The page asks for new
//! texts through the plugin's `since` command (../../index.ts, catchUp) and
//! hands them to the app.
//!
//! What this reads, and what it leaves:
//! - texts from `message`, ordered by ROWID (AUTOINCREMENT, never reused),
//!   with their chat (`chat_message_join`, `chat`) and its people
//!   (`chat_handle_join`, `handle`);
//! - the text from `message.text`, or decoded from `attributedBody`, the
//!   typedstream Messages has written since macOS 13 (see `decode_body`);
//! - reactions (associated_message_type 1000 and up) and empty system rows
//!   are skipped; an attachment with no words becomes "[photo]" or
//!   "[attachment]";
//! - names from the Mac's Contacts database files, read under the same
//!   Full Disk Access (see `Contacts`).
//!
//! The database is opened read-only while Messages writes to it; that is
//! right for a database in write-ahead-log mode (sqlite.org/wal.html), and
//! no read transaction is held between calls.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use serde::Serialize;

/// Messages' dates are nanoseconds since 2001-01-01 UTC.
const APPLE_EPOCH_UNIX_MS: i64 = 978_307_200_000;

/// A row seen before its chat link is held back this many reads, then
/// skipped with a log line, so one broken row never stalls the reader.
pub const HOLD_READS: u32 = 20;

/// What the setup page shows about access.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Access {
    Granted,
    /// macOS refused: the app is not in Full Disk Access (or not yet
    /// reopened since it was added).
    Denied,
    /// No Messages database on this Mac.
    NoDatabase,
}

/// Bundled SQLite reports a refusal and a missing file alike ("unable to
/// open database file"), so a plain file open tells them apart first.
pub fn access(db: &Path) -> Access {
    match std::fs::File::open(db) {
        Ok(_) => Access::Granted,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Access::NoDatabase,
        Err(_) => Access::Denied,
    }
}

/// The Mac's Messages database.
pub fn messages_db() -> Option<PathBuf> {
    Some(dirs_home()?.join("Library/Messages/chat.db"))
}

/// The Mac's Contacts folder.
pub fn address_book_root() -> Option<PathBuf> {
    Some(dirs_home()?.join("Library/Application Support/AddressBook"))
}

fn dirs_home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

// ── The message body ────────────────────────────────────────────────

/// The text of an `attributedBody`: the first NSString's bytes, found
/// after its `01 2B` marker, then its length (under 0x80 the byte itself,
/// 0x81 then two bytes, 0x82 then four, in the archive's byte order).
/// After imsg's Sources/IMsgCore/TypedStreamParser.swift (github.com/openclaw/imsg,
/// commit 5af52a0), MIT, whose license is ../LICENSE-imsg. None for anything
/// that does not parse.
pub fn decode_body(bytes: &[u8]) -> Option<String> {
    if bytes.len() < 13 || bytes[0] != 4 || bytes[1] != 11 {
        return None;
    }
    let little_endian = match &bytes[2..13] {
        b"streamtyped" => true,
        b"typedstream" => false,
        _ => return None,
    };
    let mut i = 13;
    while i + 1 < bytes.len() {
        if bytes[i] == 0x01 && bytes[i + 1] == 0x2b {
            return decode_string(bytes, i + 2, little_endian);
        }
        i += 1;
    }
    None
}

fn decode_string(bytes: &[u8], at: usize, little_endian: bool) -> Option<String> {
    let head = *bytes.get(at)?;
    let mut start = at + 1;
    let len = match head {
        0x81 | 0x82 => {
            let width = if head == 0x81 { 2 } else { 4 };
            let raw = bytes.get(start..start + width)?;
            start += width;
            raw.iter().enumerate().fold(0usize, |n, (k, b)| {
                let shift = if little_endian { k } else { width - 1 - k } * 8;
                n | (usize::from(*b) << shift)
            })
        }
        0x80..=0x91 => return None,
        n => usize::from(n),
    };
    let body = bytes.get(start..start.checked_add(len)?)?;
    String::from_utf8(body.to_vec()).ok()
}

/// A text as a person reads it: the object-replacement marks Messages puts
/// in place of attachments (U+FFFC) and app payloads (U+FFFD) removed.
fn readable(text: &str) -> String {
    text.chars().filter(|c| *c != '\u{FFFC}' && *c != '\u{FFFD}').collect::<String>().trim().to_string()
}

// ── Contacts ────────────────────────────────────────────────────────

/// The Mac's contacts, by the last 10 digits of a phone and by email.
/// All or nothing: a partial read must not pass for a whole one, since a
/// sender missing from it would look unknown (and, later, be offered STOP).
#[derive(Debug, Default)]
pub struct Contacts {
    by_key: HashMap<String, Option<String>>,
}

impl Contacts {
    /// Every `AddressBook-v22.abcddb` under the Contacts folder: the
    /// folder's own ("On My Mac") and each account's under Sources.
    pub fn load(root: &Path) -> Result<Contacts, String> {
        // All or nothing: an account's folder that cannot be listed would
        // leave its people unnamed and called unknown, so it fails the load.
        let mut files = vec![root.join("AddressBook-v22.abcddb")];
        match std::fs::read_dir(root.join("Sources")) {
            Ok(entries) => {
                for entry in entries {
                    let entry = entry.map_err(|e| format!("Sources: {e}"))?;
                    files.push(entry.path().join("AddressBook-v22.abcddb"));
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(format!("Sources: {e}")),
        }
        // A file whose presence cannot be checked fails the load too:
        // `exists()` would call it absent.
        let mut present = Vec::new();
        for file in files {
            match file.try_exists() {
                Ok(true) => present.push(file),
                Ok(false) => {}
                Err(e) => return Err(format!("{}: {e}", file.display())),
            }
        }
        let files = present;
        if files.is_empty() {
            return Err("no AddressBook-v22 database".into());
        }
        let mut contacts = Contacts::default();
        for file in &files {
            contacts.read(file).map_err(|e| format!("{}: {e}", file.display()))?;
        }
        if contacts.by_key.is_empty() {
            return Err("no cards with a phone or email".into());
        }
        Ok(contacts)
    }

    fn read(&mut self, file: &Path) -> rusqlite::Result<()> {
        let conn = Connection::open_with_flags(file, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)?;
        // The me card is the reader, not a contact.
        let mut stmt = conn.prepare(
            "SELECT r.ZNICKNAME, r.ZFIRSTNAME, r.ZLASTNAME, p.ZFULLNUMBER, NULL
               FROM ZABCDRECORD r JOIN ZABCDPHONENUMBER p ON p.ZOWNER = r.Z_PK
              WHERE r.ZCONTAINERWHERECONTACTISME IS NULL
             UNION ALL
             SELECT r.ZNICKNAME, r.ZFIRSTNAME, r.ZLASTNAME, NULL, e.ZADDRESSNORMALIZED
               FROM ZABCDRECORD r JOIN ZABCDEMAILADDRESS e ON e.ZOWNER = r.Z_PK
              WHERE r.ZCONTAINERWHERECONTACTISME IS NULL",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, Option<String>>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
            ))
        })?;
        for row in rows {
            let (nickname, first, last, phone, email) = row?;
            let name = card_name(nickname, first, last);
            let key = match (phone, email) {
                (Some(p), _) => phone_key(&p),
                (_, Some(e)) => email_key(&e),
                _ => None,
            };
            if let Some(key) = key {
                // A card with no name still makes the handle a contact.
                let slot = self.by_key.entry(key).or_insert(None);
                if slot.is_none() {
                    *slot = name;
                }
            }
        }
        Ok(())
    }

    /// Some(name or None) when the handle is on a card; None when not.
    pub fn lookup(&self, handle: &str) -> Option<Option<String>> {
        let key = if handle.contains('@') { email_key(handle) } else { phone_key(handle) }?;
        self.by_key.get(&key).cloned()
    }
}

fn card_name(nickname: Option<String>, first: Option<String>, last: Option<String>) -> Option<String> {
    let nonempty = |s: Option<String>| s.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    if let Some(n) = nonempty(nickname) {
        return Some(n);
    }
    let parts: Vec<String> = [nonempty(first), nonempty(last)].into_iter().flatten().collect();
    (!parts.is_empty()).then(|| parts.join(" "))
}

/// The last 10 digits, so "+1 (201) 555-0134" and "2015550134" match.
fn phone_key(phone: &str) -> Option<String> {
    let digits: String = phone.chars().filter(char::is_ascii_digit).collect();
    if digits.len() < 3 {
        return None;
    }
    Some(digits[digits.len().saturating_sub(10)..].to_string())
}

fn email_key(email: &str) -> Option<String> {
    let e = email.trim().trim_start_matches('<').trim_end_matches('>').trim().to_lowercase();
    e.contains('@').then_some(e)
}

/// A 5- or 6-digit sender: the short codes campaigns and services text from.
fn is_short_code(handle: &str) -> bool {
    (5..=6).contains(&handle.len()) && handle.chars().all(|c| c.is_ascii_digit())
}

// ── Reading texts ───────────────────────────────────────────────────

/// The upload's limits, which an app's server checks an upload against
/// (../../names.ts, the one owner; test/tauri-apple-messages.test.ts holds
/// these to it), in the units JavaScript counts a string's length in
/// (UTF-16). A text past them would refuse its whole batch, and every later
/// one, so it is cut; a guid, which keys the text, is skipped instead.
pub const MAX_TEXT_UNITS: usize = 20_000;
pub const MAX_FIELD_UNITS: usize = 300;
pub const MAX_PARTICIPANTS: usize = 100;
pub const MAX_GUID_UNITS: usize = 200;
pub const MAX_SERVICE_UNITS: usize = 40;

/// `s` cut to at most `max` UTF-16 units, on a character boundary, ending
/// in "…" when cut.
fn fit(s: String, max: usize) -> String {
    if s.encode_utf16().count() <= max {
        return s;
    }
    // Room for the "…", itself one unit.
    let (mut units, mut end) = (0, 0);
    for (i, c) in s.char_indices() {
        if units + c.len_utf16() > max - 1 {
            break;
        }
        units += c.len_utf16();
        end = i + c.len_utf8();
    }
    let mut cut = s[..end].to_string();
    cut.push('…');
    cut
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Person {
    pub handle: String,
    pub name: Option<String>,
}

/// One text, as the page hands it to the app (../../index.ts MacText).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Text {
    pub guid: String,
    pub rowid: i64,
    pub chat_guid: String,
    pub chat_name: Option<String>,
    pub participants: Vec<Person>,
    pub sender_handle: String,
    pub sender_name: Option<String>,
    /// "me", "contact", "short_code" or "unknown".
    pub sender_kind: &'static str,
    pub service: String,
    pub sent_at_ms: i64,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Batch {
    pub texts: Vec<Text>,
    /// The highest ROWID examined, skipped rows included: the next read
    /// starts after it. Equal to the start when nothing was examined.
    pub scanned_to: i64,
    /// The database's highest ROWID. Below the stored mark means Messages
    /// rebuilt its database, and the page starts over (catchUp).
    pub max_rowid: i64,
    /// False when Contacts could not be read: then nobody is unknown.
    pub contacts_read: bool,
}

struct Row {
    rowid: i64,
    guid: String,
    text: Option<String>,
    body: Option<Vec<u8>>,
    from_me: bool,
    date: i64,
    service: Option<String>,
    reaction_type: i64,
    sender: Option<String>,
    chat_id: Option<i64>,
    chat_guid: Option<String>,
    chat_name: Option<String>,
}

/// Up to `limit` texts after `after_rowid` (or, when None, from the first
/// sent at or after `since_ms`). `held` counts the reads each row has been
/// seen without its chat link; it lives across calls.
pub fn read_since(
    db: &Path,
    contacts: Result<&Contacts, &str>,
    after_rowid: Option<i64>,
    since_ms: i64,
    limit: usize,
    held: &mut HashMap<i64, u32>,
) -> rusqlite::Result<Batch> {
    let conn = Connection::open_with_flags(db, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)?;
    let max_rowid: i64 = conn.query_row("SELECT COALESCE(MAX(ROWID), 0) FROM message", [], |r| r.get(0))?;
    let since_apple_ns = (since_ms - APPLE_EPOCH_UNIX_MS).saturating_mul(1_000_000);
    let start = match after_rowid {
        Some(r) => r,
        None => {
            let first: Option<i64> = conn
                .query_row("SELECT MIN(ROWID) FROM message WHERE date >= ?1", params![since_apple_ns], |r| r.get(0))
                .optional()?
                .flatten();
            first.map_or(max_rowid, |f| f - 1)
        }
    };

    let mut stmt = conn.prepare(
        "SELECT m.ROWID, m.guid, m.text, m.attributedBody, m.is_from_me, m.date, m.service,
                COALESCE(m.associated_message_type, 0), h.id, c.ROWID, c.guid, c.display_name
           FROM message m
           LEFT JOIN handle h ON h.ROWID = m.handle_id
           LEFT JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
           LEFT JOIN chat c ON c.ROWID = cmj.chat_id
          WHERE m.ROWID > ?1
          ORDER BY m.ROWID
          LIMIT ?2",
    )?;
    let rows: Vec<Row> = stmt
        .query_map(params![start, limit as i64], |r| {
            Ok(Row {
                rowid: r.get(0)?,
                guid: r.get(1)?,
                text: r.get(2)?,
                body: r.get(3)?,
                from_me: r.get::<_, i64>(4)? != 0,
                date: r.get(5)?,
                service: r.get(6)?,
                reaction_type: r.get(7)?,
                sender: r.get(8)?,
                chat_id: r.get(9)?,
                chat_guid: r.get(10)?,
                chat_name: r.get(11)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;

    let mut texts = Vec::new();
    let mut scanned_to = start;
    let mut seen = std::collections::HashSet::new();
    let mut people_of: HashMap<i64, Vec<Person>> = HashMap::new();
    for row in rows {
        // A text in two chats appears twice in the join: the first wins.
        if !seen.insert(row.rowid) {
            continue;
        }
        let (Some(chat_id), Some(chat_guid)) = (row.chat_id, row.chat_guid.clone()) else {
            let ticks = held.entry(row.rowid).or_insert(0);
            *ticks += 1;
            if *ticks < HOLD_READS {
                // Its chat link may not be written yet: stop below it.
                break;
            }
            log::warn!("[apple-messages] skipped row {}: no chat after {HOLD_READS} reads", row.rowid);
            held.remove(&row.rowid);
            scanned_to = row.rowid;
            continue;
        };
        held.remove(&row.rowid);
        scanned_to = row.rowid;
        if row.reaction_type >= 1000 {
            continue;
        }
        // Only the days asked for (the page asks, on every read, from the
        // same day): an older text that syncs in late takes a higher ROWID
        // than newer ones, and is still outside.
        if row.date < since_apple_ns {
            continue;
        }
        if row.guid.encode_utf16().count() > MAX_GUID_UNITS {
            // The server keys a text by it, so it cannot be cut; sent as
            // is it would refuse the batch, and every later one.
            log::warn!("[apple-messages] skipped row {}: its guid is longer than {MAX_GUID_UNITS}", row.rowid);
            continue;
        }
        let mut words = row.text.as_deref().map(readable).filter(|t| !t.is_empty()).unwrap_or_default();
        if words.is_empty() {
            if let Some(body) = row.body.as_deref().filter(|b| !b.is_empty()) {
                match decode_body(body) {
                    Some(t) => words = readable(&t),
                    // Apple's format changed, or this row is one the decoder
                    // does not know: said, never dropped in silence.
                    None => log::warn!("[apple-messages] row {}: its body did not decode", row.rowid),
                }
            }
        }
        if words.is_empty() {
            match attachment_kind(&conn, row.rowid)? {
                Some(kind) => words = kind.to_string(),
                None => continue,
            }
        }
        let participants = match people_of.get(&chat_id) {
            Some(p) => p.clone(),
            None => {
                let p = chat_people(&conn, chat_id, contacts)?;
                people_of.insert(chat_id, p.clone());
                p
            }
        };
        let (sender_handle, sender_name, sender_kind) = if row.from_me {
            ("me".to_string(), None, "me")
        } else {
            let handle = row.sender.clone().unwrap_or_else(|| participants.first().map_or_else(String::new, |p| p.handle.clone()));
            let (name, kind) = sender_of(&handle, contacts);
            (handle, name, kind)
        };
        if sender_handle.is_empty() {
            continue;
        }
        let field = |v: String| fit(v, MAX_FIELD_UNITS);
        texts.push(Text {
            guid: row.guid,
            rowid: row.rowid,
            chat_guid: field(chat_guid),
            chat_name: row.chat_name.filter(|n| !n.trim().is_empty()).map(field),
            participants: participants
                .into_iter()
                .filter(|p| !p.handle.is_empty())
                .take(MAX_PARTICIPANTS)
                .map(|p| Person { handle: field(p.handle), name: p.name.map(field) })
                .collect(),
            sender_handle: field(sender_handle),
            sender_name: sender_name.map(field),
            sender_kind,
            service: fit(row.service.unwrap_or_else(|| "iMessage".into()), MAX_SERVICE_UNITS),
            sent_at_ms: row.date / 1_000_000 + APPLE_EPOCH_UNIX_MS,
            text: fit(words, MAX_TEXT_UNITS),
        });
    }
    Ok(Batch { texts, scanned_to, max_rowid, contacts_read: contacts.is_ok() })
}

fn sender_of(handle: &str, contacts: Result<&Contacts, &str>) -> (Option<String>, &'static str) {
    match contacts {
        // Contacts unread: nobody is unknown, so nothing is offered STOP on a guess.
        Err(_) => (None, "contact"),
        Ok(c) => match c.lookup(handle) {
            Some(name) => (name, "contact"),
            None if is_short_code(handle) => (None, "short_code"),
            None => (None, "unknown"),
        },
    }
}

fn chat_people(conn: &Connection, chat_id: i64, contacts: Result<&Contacts, &str>) -> rusqlite::Result<Vec<Person>> {
    let mut stmt = conn.prepare(
        "SELECT h.id FROM chat_handle_join chj JOIN handle h ON h.ROWID = chj.handle_id
          WHERE chj.chat_id = ?1 ORDER BY h.ROWID",
    )?;
    let handles = stmt.query_map(params![chat_id], |r| r.get::<_, String>(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(handles
        .into_iter()
        .map(|handle| {
            let name = contacts.ok().and_then(|c| c.lookup(&handle)).flatten();
            Person { handle, name }
        })
        .collect())
}

fn attachment_kind(conn: &Connection, rowid: i64) -> rusqlite::Result<Option<&'static str>> {
    let mime: Option<Option<String>> = conn
        .query_row(
            "SELECT a.mime_type FROM message_attachment_join maj JOIN attachment a ON a.ROWID = maj.attachment_id
              WHERE maj.message_id = ?1 LIMIT 1",
            params![rowid],
            |r| r.get(0),
        )
        .optional()?;
    Ok(mime.map(|m| match m {
        Some(t) if t.starts_with("image/") => "[photo]",
        _ => "[attachment]",
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> Vec<u8> {
        std::fs::read(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/attributed-body").join(format!("{name}.bin")))
            .expect("fixture made by make-attributed-body.swift")
    }

    #[test]
    fn a_body_decodes_at_every_length_head() {
        assert_eq!(decode_body(&fixture("hello")).as_deref(), Some("Hello"));
        for (name, ch, n) in [("len127", 'a', 127), ("len128", 'b', 128), ("len200", 'c', 200), ("len256", 'd', 256), ("len70000", 'e', 70000)] {
            assert_eq!(decode_body(&fixture(name)), Some(ch.to_string().repeat(n)), "{name}");
        }
    }

    #[test]
    fn a_photo_is_no_words_and_a_caption_keeps_its_words() {
        assert_eq!(readable(&decode_body(&fixture("photo")).unwrap()), "");
        assert_eq!(readable(&decode_body(&fixture("photo-caption")).unwrap()), "Look at this 👋");
    }

    #[test]
    fn anything_else_does_not_decode() {
        assert_eq!(decode_body(b""), None);
        assert_eq!(decode_body(b"plain text, not an archive"), None);
        let mut cut = fixture("len200");
        cut.truncate(cut.len() - 150);
        assert_eq!(decode_body(&cut), None);
    }

    #[test]
    fn denied_and_missing_are_told_apart() {
        let dir = tempdir("access");
        let file = dir.join("chat.db");
        assert_eq!(access(&file), Access::NoDatabase);
        std::fs::write(&file, b"").unwrap();
        assert_eq!(access(&file), Access::Granted);
        // A file this process may not read stands in for macOS's refusal.
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o000)).unwrap();
        assert_eq!(access(&file), Access::Denied);
    }

    // ── A made-up Messages database and Contacts ─────────────────────

    /// A test's own folder, removed when the test ends, passed or panicked
    /// (Drop runs as a failed assertion unwinds). Under one folder of this
    /// user's outside the system temporary folder, never shared with
    /// another user.
    struct TestDir(PathBuf);
    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    impl std::ops::Deref for TestDir {
        type Target = Path;
        fn deref(&self) -> &Path {
            &self.0
        }
    }

    fn tempdir(label: &str) -> TestDir {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        let root = Path::new("/tmp/app-kit-tests");
        if std::fs::create_dir(root).is_ok() {
            std::fs::set_permissions(root, std::fs::Permissions::from_mode(0o700)).unwrap();
        }
        // Folders of test processes that were killed, and so never ran
        // their Drop, go once per process.
        static SWEEP: std::sync::Once = std::sync::Once::new();
        SWEEP.call_once(|| {
            let me = std::process::id().to_string();
            for entry in std::fs::read_dir(root).into_iter().flatten().flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                let Some(pid) = name.split('-').rev().nth(1).filter(|p| p.chars().all(|c| c.is_ascii_digit())) else { continue };
                let alive = pid == me
                    || std::process::Command::new("kill").args(["-0", pid]).stderr(std::process::Stdio::null()).status().is_ok_and(|s| s.success());
                if !alive {
                    let _ = std::fs::remove_dir_all(entry.path());
                }
            }
        });
        let dir = root.join(format!("messages-{label}-{}-{:?}", std::process::id(), std::thread::current().id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir(&dir).unwrap();
        let (root_meta, dir_meta) = (std::fs::metadata(root).unwrap(), std::fs::metadata(&dir).unwrap());
        assert!(
            root_meta.uid() == dir_meta.uid() && root_meta.mode() & 0o022 == 0,
            "{} must be this user's and writable by no one else",
            root.display()
        );
        TestDir(dir)
    }

    /// The columns the reader uses, from Messages' own tables.
    fn messages_fixture(dir: &Path) -> (PathBuf, Connection) {
        let path = dir.join("chat.db");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "CREATE TABLE handle (ROWID INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL);
             CREATE TABLE chat (ROWID INTEGER PRIMARY KEY AUTOINCREMENT, guid TEXT NOT NULL, display_name TEXT);
             CREATE TABLE message (ROWID INTEGER PRIMARY KEY AUTOINCREMENT, guid TEXT NOT NULL, text TEXT,
               attributedBody BLOB, handle_id INTEGER DEFAULT 0, is_from_me INTEGER DEFAULT 0, date INTEGER,
               service TEXT, associated_message_type INTEGER DEFAULT 0);
             CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER);
             CREATE TABLE chat_handle_join (chat_id INTEGER, handle_id INTEGER);
             CREATE TABLE attachment (ROWID INTEGER PRIMARY KEY AUTOINCREMENT, mime_type TEXT);
             CREATE TABLE message_attachment_join (message_id INTEGER, attachment_id INTEGER);
             INSERT INTO handle (id) VALUES ('+12015550134'), ('88022'), ('dana@example.com'), ('+12015550199');
             INSERT INTO chat (guid, display_name) VALUES ('any;-;+12015550134', ''), ('any;-;88022', NULL), ('any;+;chat42', 'Soccer parents');
             INSERT INTO chat_handle_join VALUES (1, 1), (2, 2), (3, 3), (3, 4);",
        )
        .unwrap();
        (path, conn)
    }

    const NOV_2_9AM_MS: i64 = 1_793_610_000_000;

    fn add(conn: &Connection, guid: &str, text: Option<&str>, body: Option<Vec<u8>>, handle: i64, from_me: bool, chat: Option<i64>, kind: i64, at_ms: i64) -> i64 {
        conn.execute(
            "INSERT INTO message (guid, text, attributedBody, handle_id, is_from_me, date, service, associated_message_type)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![guid, text, body, handle, from_me as i64, (at_ms - APPLE_EPOCH_UNIX_MS) * 1_000_000, if handle == 2 { "SMS" } else { "iMessage" }, kind],
        )
        .unwrap();
        let rowid = conn.last_insert_rowid();
        if let Some(chat) = chat {
            conn.execute("INSERT INTO chat_message_join VALUES (?1, ?2)", params![chat, rowid]).unwrap();
        }
        rowid
    }

    fn contacts_fixture(root: &Path, in_sources: bool) {
        let dir = if in_sources { root.join("Sources/ABC-123") } else { root.to_path_buf() };
        std::fs::create_dir_all(&dir).unwrap();
        let conn = Connection::open(dir.join("AddressBook-v22.abcddb")).unwrap();
        conn.execute_batch(
            "CREATE TABLE ZABCDRECORD (Z_PK INTEGER PRIMARY KEY, ZNICKNAME TEXT, ZFIRSTNAME TEXT, ZLASTNAME TEXT, ZCONTAINERWHERECONTACTISME INTEGER);
             CREATE TABLE ZABCDPHONENUMBER (Z_PK INTEGER PRIMARY KEY, ZOWNER INTEGER, ZFULLNUMBER TEXT);
             CREATE TABLE ZABCDEMAILADDRESS (Z_PK INTEGER PRIMARY KEY, ZOWNER INTEGER, ZADDRESSNORMALIZED TEXT);",
        )
        .unwrap();
        if in_sources {
            conn.execute_batch(
                "INSERT INTO ZABCDRECORD VALUES (1, NULL, 'Priya', 'Raman', NULL), (2, NULL, NULL, NULL, NULL), (3, NULL, 'Me', 'Myself', 7);
                 INSERT INTO ZABCDPHONENUMBER VALUES (1, 1, '+1 (201) 555-0134'), (2, 2, '201-555-0199'), (3, 3, '+1 201 555 0100');",
            )
            .unwrap();
        } else {
            // "On My Mac": a card found only by email.
            conn.execute_batch(
                "INSERT INTO ZABCDRECORD VALUES (1, 'Dana', 'Dana', 'Lee', NULL);
                 INSERT INTO ZABCDEMAILADDRESS VALUES (1, 1, 'dana@example.com');",
            )
            .unwrap();
        }
    }

    #[test]
    fn contacts_come_from_every_database_and_any_card_counts() {
        let root = tempdir("contacts");
        assert!(Contacts::load(&root).is_err(), "no database is unavailable, never empty");
        contacts_fixture(&root, true);
        contacts_fixture(&root, false);
        let c = Contacts::load(&root).unwrap();
        assert_eq!(c.lookup("+12015550134"), Some(Some("Priya Raman".into())));
        assert_eq!(c.lookup("2015550134"), Some(Some("Priya Raman".into())));
        assert_eq!(c.lookup("DANA@example.com"), Some(Some("Dana".into())), "the root database, by email");
        assert_eq!(c.lookup("+12015550199"), Some(None), "a card with no name is still a contact");
        assert_eq!(c.lookup("+12015550100"), None, "the me card is not a contact");
        assert_eq!(c.lookup("88022"), None);

        // An account's folder that cannot be listed fails the whole load,
        // so its people are never called unknown.
        use std::os::unix::fs::PermissionsExt;
        let sources = root.join("Sources");
        std::fs::set_permissions(&sources, std::fs::Permissions::from_mode(0o000)).unwrap();
        let partial = Contacts::load(&root);
        std::fs::set_permissions(&sources, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert!(partial.is_err(), "a partial read is no read");

        // So does an account whose database cannot even be checked for.
        let account = sources.join("ABC-123");
        std::fs::set_permissions(&account, std::fs::Permissions::from_mode(0o000)).unwrap();
        let unchecked = Contacts::load(&root);
        std::fs::set_permissions(&account, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert!(unchecked.is_err(), "a database that cannot be checked is not absent");
    }

    #[test]
    fn a_killed_test_process_leaves_no_folder_for_long() {
        // A folder named for a process that has ended, as a killed run leaves.
        let root = Path::new("/tmp/app-kit-tests");
        let _ = tempdir("sweep-setup");
        let left = root.join("messages-left-999999999-ThreadId(1)");
        std::fs::create_dir_all(&left).unwrap();
        // The sweep runs once per process; run it here as a fresh process would.
        let mine = tempdir("sweep");
        assert!(mine.exists());
        let out = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "reader::tests::sweep_probe", "--include-ignored"])
            .output()
            .unwrap();
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stdout));
        assert!(!left.exists(), "the ended process's folder is gone");
        assert!(mine.exists(), "a live process's folder stays");
    }

    #[test]
    #[ignore = "run by a_killed_test_process_leaves_no_folder_for_long in a process of its own"]
    fn sweep_probe() {
        let _ = tempdir("probe");
    }

    #[test]
    fn texts_are_read_in_order_with_their_people_and_kinds() {
        let dir = tempdir("read");
        let (db, conn) = messages_fixture(&dir);
        let root = dir.join("AddressBook");
        contacts_fixture(&root, true);
        contacts_fixture(&root, false);
        let contacts = Contacts::load(&root).unwrap();
        let t = NOV_2_9AM_MS;
        add(&conn, "g1", Some("can you sign the form tonight?"), None, 1, false, Some(1), 0, t);
        add(&conn, "g2", None, Some(fixture("hello")), 0, true, Some(1), 0, t + 60_000);
        add(&conn, "g3", None, None, 1, false, Some(1), 2000, t + 120_000); // a reaction
        add(&conn, "g4", Some("Chip in $1 before midnight"), None, 2, false, Some(2), 0, t + 180_000);
        let photo = add(&conn, "g5", None, Some(fixture("photo")), 3, false, Some(3), 0, t + 240_000);
        conn.execute_batch("INSERT INTO attachment (mime_type) VALUES ('image/heic');").unwrap();
        conn.execute("INSERT INTO message_attachment_join VALUES (?1, 1)", params![photo]).unwrap();
        add(&conn, "g6", None, Some(fixture("photo-caption")), 3, false, Some(3), 3, t + 300_000); // type 3 is a normal text
        add(&conn, "g7", Some(""), None, 1, false, Some(1), 0, t + 360_000); // an empty system row

        let batch = read_since(&db, Ok(&contacts), Some(0), 0, 500, &mut HashMap::new()).unwrap();
        let rows: Vec<(&str, &str, &str, &str)> =
            batch.texts.iter().map(|x| (x.guid.as_str(), x.sender_handle.as_str(), x.sender_kind, x.text.as_str())).collect();
        assert_eq!(
            rows,
            vec![
                ("g1", "+12015550134", "contact", "can you sign the form tonight?"),
                ("g2", "me", "me", "Hello"),
                ("g4", "88022", "short_code", "Chip in $1 before midnight"),
                ("g5", "dana@example.com", "contact", "[photo]"),
                ("g6", "dana@example.com", "contact", "Look at this 👋"),
            ]
        );
        assert_eq!(batch.scanned_to, 7, "skipped rows still move the mark");
        assert_eq!(batch.max_rowid, 7);
        let first = &batch.texts[0];
        assert_eq!(first.sender_name.as_deref(), Some("Priya Raman"));
        assert_eq!(first.sent_at_ms, t);
        assert_eq!(first.chat_name, None, "an empty display name is no name");
        assert_eq!(batch.texts[2].service, "SMS");
        let group = &batch.texts[3];
        assert_eq!(group.chat_name.as_deref(), Some("Soccer parents"));
        assert_eq!(
            group.participants,
            vec![
                Person { handle: "dana@example.com".into(), name: Some("Dana".into()) },
                Person { handle: "+12015550199".into(), name: None },
            ]
        );

        // The next read starts after the mark; an all-reaction batch still moves it.
        add(&conn, "g8", None, None, 1, false, Some(1), 2001, t + 420_000);
        let next = read_since(&db, Ok(&contacts), Some(batch.scanned_to), 0, 500, &mut HashMap::new()).unwrap();
        assert!(next.texts.is_empty());
        assert_eq!(next.scanned_to, 8);
    }

    #[test]
    fn the_first_read_starts_at_the_first_text_since_the_day_asked() {
        let dir = tempdir("since");
        let (db, conn) = messages_fixture(&dir);
        let day = 24 * 60 * 60 * 1000;
        add(&conn, "old", Some("a month ago"), None, 1, false, Some(1), 0, NOV_2_9AM_MS - 30 * day);
        add(&conn, "new", Some("yesterday"), None, 1, false, Some(1), 0, NOV_2_9AM_MS - day);
        let batch = read_since(&db, Err("none"), None, NOV_2_9AM_MS - 14 * day, 500, &mut HashMap::new()).unwrap();
        assert_eq!(batch.texts.iter().map(|x| x.guid.as_str()).collect::<Vec<_>>(), vec!["new"]);
        // With Contacts unread, nobody is unknown.
        assert_eq!(batch.texts[0].sender_kind, "contact");
        assert!(!batch.contacts_read);
    }

    #[test]
    fn a_text_past_the_upload_limits_is_cut_to_fit_them() {
        assert_eq!(fit("short".into(), 300), "short");
        // 👋 is two UTF-16 units, as JavaScript counts it: never split.
        assert_eq!(fit("ab👋cd".into(), 4), "ab…");
        assert_eq!(fit("ab👋cd".into(), 5), "ab👋…");
        assert_eq!(fit("ab👋cd".into(), 6), "ab👋cd");

        let dir = tempdir("limits");
        let (db, conn) = messages_fixture(&dir);
        let pasted = "👋".repeat(15_000); // 30,000 units
        add(&conn, "long", Some(&pasted), None, 1, false, Some(1), 0, NOV_2_9AM_MS);
        for i in 0..150 {
            conn.execute("INSERT INTO handle (id) VALUES (?1)", params![format!("+1201555{i:04}")]).unwrap();
            conn.execute("INSERT INTO chat_handle_join VALUES (3, last_insert_rowid())", []).unwrap();
        }
        add(&conn, "crowd", Some("who is bringing snacks?"), None, 3, false, Some(3), 0, NOV_2_9AM_MS + 1);
        let batch = read_since(&db, Err("none"), Some(0), 0, 500, &mut HashMap::new()).unwrap();
        let long = &batch.texts[0];
        assert_eq!(long.text.encode_utf16().count(), MAX_TEXT_UNITS - 1, "19,998 units of 👋 and the one-unit …");
        assert!(long.text.ends_with('…'));
        assert_eq!(batch.texts[1].participants.len(), MAX_PARTICIPANTS);

        // A guid the server cannot key a text by is skipped, and the mark
        // still moves past it.
        let odd = add(&conn, &"g".repeat(201), Some("odd"), None, 1, false, Some(1), 0, NOV_2_9AM_MS + 2);
        let next = read_since(&db, Err("none"), Some(batch.scanned_to), 0, 500, &mut HashMap::new()).unwrap();
        assert!(next.texts.is_empty());
        assert_eq!(next.scanned_to, odd);
    }

    #[test]
    fn a_text_older_than_the_days_asked_is_not_read_even_when_it_syncs_in_late() {
        let dir = tempdir("late");
        let (db, conn) = messages_fixture(&dir);
        let day = 86_400_000;
        add(&conn, "new", Some("today"), None, 1, false, Some(1), 0, NOV_2_9AM_MS);
        add(&conn, "old", Some("from a month ago, synced just now"), None, 1, false, Some(1), 0, NOV_2_9AM_MS - 30 * day);
        let since = NOV_2_9AM_MS - 14 * day;
        let first = read_since(&db, Err("none"), None, since, 500, &mut HashMap::new()).unwrap();
        assert_eq!(first.texts.iter().map(|x| x.guid.as_str()).collect::<Vec<_>>(), vec!["new"]);
        assert_eq!(first.scanned_to, 2, "the mark moves past the old one");
        let again = read_since(&db, Err("none"), Some(1), since, 500, &mut HashMap::new()).unwrap();
        assert!(again.texts.is_empty(), "nor on a later read");
    }

    #[test]
    fn a_row_seen_before_its_chat_is_held_then_skipped() {
        let dir = tempdir("held");
        let (db, conn) = messages_fixture(&dir);
        add(&conn, "a", Some("first"), None, 1, false, Some(1), 0, NOV_2_9AM_MS);
        let orphan = add(&conn, "b", Some("no chat yet"), None, 1, false, None, 0, NOV_2_9AM_MS + 1);
        add(&conn, "c", Some("after it"), None, 1, false, Some(1), 0, NOV_2_9AM_MS + 2);
        let mut held = HashMap::new();
        let first = read_since(&db, Err("none"), Some(0), 0, 500, &mut held).unwrap();
        assert_eq!(first.texts.iter().map(|x| x.guid.as_str()).collect::<Vec<_>>(), vec!["a"]);
        assert_eq!(first.scanned_to, 1, "the mark stays below the row with no chat");

        // Its link arrives: the next read takes it and what follows.
        conn.execute("INSERT INTO chat_message_join VALUES (1, ?1)", params![orphan]).unwrap();
        let second = read_since(&db, Err("none"), Some(first.scanned_to), 0, 500, &mut held).unwrap();
        assert_eq!(second.texts.iter().map(|x| x.guid.as_str()).collect::<Vec<_>>(), vec!["b", "c"]);
        assert!(held.is_empty());

        // A row that never gets one is skipped after HOLD_READS reads.
        let never = add(&conn, "d", Some("lost"), None, 1, false, None, 0, NOV_2_9AM_MS + 3);
        let mut mark = second.scanned_to;
        for _ in 1..HOLD_READS {
            mark = read_since(&db, Err("none"), Some(mark), 0, 500, &mut held).unwrap().scanned_to;
            assert_eq!(mark, never - 1);
        }
        let last = read_since(&db, Err("none"), Some(mark), 0, 500, &mut held).unwrap();
        assert_eq!(last.scanned_to, never);
        assert!(last.texts.is_empty());
    }

    /// The log lines this test process writes, for a test that a decision is logged.
    struct Capture;
    static LINES: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());
    impl log::Log for Capture {
        fn enabled(&self, _: &log::Metadata) -> bool {
            true
        }
        fn log(&self, record: &log::Record) {
            LINES.lock().unwrap().push(record.args().to_string());
        }
        fn flush(&self) {}
    }
    static CAPTURE: Capture = Capture;

    #[test]
    fn a_body_that_does_not_decode_is_logged_with_its_row() {
        let _ = log::set_logger(&CAPTURE);
        log::set_max_level(log::LevelFilter::Info);
        let dir = tempdir("undecoded");
        let (db, conn) = messages_fixture(&dir);
        let odd = add(&conn, "odd", None, Some(b"a body in a format Apple has not used yet".to_vec()), 1, false, Some(1), 0, NOV_2_9AM_MS);
        add(&conn, "next", Some("after it"), None, 1, false, Some(1), 0, NOV_2_9AM_MS + 1);
        let batch = read_since(&db, Err("none"), Some(0), 0, 500, &mut HashMap::new()).unwrap();
        assert_eq!(batch.texts.iter().map(|x| x.guid.as_str()).collect::<Vec<_>>(), vec!["next"]);
        let wanted = format!("[apple-messages] row {odd}: its body did not decode");
        assert!(LINES.lock().unwrap().contains(&wanted), "{wanted} is logged");
    }
}
