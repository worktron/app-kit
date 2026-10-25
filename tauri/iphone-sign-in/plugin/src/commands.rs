use tauri::{command, AppHandle, Runtime};

use crate::models::*;
use crate::WebAuthExt;

#[command]
pub async fn authenticate<R: Runtime>(
    app: AppHandle<R>,
    payload: AuthenticateRequest,
) -> crate::Result<AuthenticateResponse> {
    app.web_auth().authenticate(payload)
}
