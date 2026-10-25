use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct PermissionResponse {
    pub granted: bool,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct TokenResponse {
    pub token: String,
    /// Which of Apple's push services the token belongs to: "development" for a debug build, which is installed
    /// from Xcode and signed for development, "production" for a release build, which goes out through TestFlight
    /// or the App Store.
    pub environment: String,
}
