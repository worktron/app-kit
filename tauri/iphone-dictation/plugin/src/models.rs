use serde::{Deserialize, Serialize};

/// What `start_dictation` answers: the token the page passes to the other commands.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct Started {
    pub token: i64,
}

/// What `dictation_heard` answers: everything heard so far, punctuated, whether the dictation has ended, and why it
/// ended when it failed, in the web's words (`not-allowed`, `service-not-allowed`, `audio-capture`,
/// `language-not-supported`) or the system's.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct Heard {
    pub words: String,
    pub ended: bool,
    pub error: Option<String>,
}
