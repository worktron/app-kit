use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthenticateRequest {
    pub url: String,
    pub callback_scheme: String,
    /// The site and path to wait for over https instead of the scheme, where iOS allows it. A page from before it
    /// sends neither.
    #[serde(default)]
    pub callback_host: Option<String>,
    #[serde(default)]
    pub callback_path: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthenticateResponse {
    pub callback_url: String,
}
