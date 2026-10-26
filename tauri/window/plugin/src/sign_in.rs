//! Desktop sign-in's shell half. The browser, signed in, opens the app's own link with a one-time ticket and the nonce
//! the window asked with; this moves both from the link into the page, which signs in only when the nonce is its own
//! (app-kit/tauri/sign-in). Any app on the Mac can open such a link, so the shell takes only what could be a ticket and
//! a nonce, and puts them in the page's script as JSON.

use tauri::Url;

/// The browser page that signs the app in, which never loads in the window. The names here are desktop sign-in's
/// (tauri/sign-in/names.ts: DESKTOP_SIGN_IN_PATH, LINK_HOST, DESKTOP_SIGN_IN_EVENT, DESKTOP_SIGN_IN_LISTENING,
/// TICKET_PARAM and NONCE_PARAM), and test/tauri-window.test.ts holds them to it.
pub(crate) const SIGN_IN_PATH: &str = "/desktop-sign-in";
/// The host of the link the browser opens: `<scheme>://sign-in?ticket=…&nonce=…`.
const LINK_HOST: &str = "sign-in";
/// The window event that hands the page a sign-in where it is, and the flag the page sets once it listens for it.
const SIGN_IN_EVENT: &str = "app-kit-desktop-sign-in";
const SIGN_IN_LISTENING: &str = "__APP_KIT_TAKES_DESKTOP_SIGN_IN__";
/// The fragment parameters a page that does not listen is loaded with instead.
const TICKET_PARAM: &str = "desktop_sign_in_ticket";
const NONCE_PARAM: &str = "desktop_sign_in_nonce";

/// A sign-in the browser hands back: the one-time ticket, and the nonce the page asked with.
#[derive(Debug, PartialEq)]
pub(crate) struct SignIn {
    pub(crate) ticket: String,
    pub(crate) nonce: String,
}

/// The sign-in a `<scheme>://sign-in` link carries, or None for any other link. A ticket is taken only in the
/// characters a Clerk ticket is written in, a nonce only in a UUID's, and each only so long.
pub(crate) fn sign_in_link(link: &Url, scheme: &str) -> Option<SignIn> {
    if link.scheme() != scheme || link.host_str() != Some(LINK_HOST) {
        return None;
    }
    let param = |name: &str, allowed: fn(char) -> bool| {
        let value = link.query_pairs().find(|(key, _)| key == name)?.1.into_owned();
        (!value.is_empty() && value.len() <= 4096 && value.chars().all(allowed)).then_some(value)
    };
    Some(SignIn {
        ticket: param("ticket", |c| c.is_ascii_alphanumeric() || "._-+/=~".contains(c))?,
        nonce: param("nonce", |c| c.is_ascii_hexdigit() || c == '-')?,
    })
}

/// The site loaded with a sign-in, on its own origin, for a window whose page cannot take it where it is. The sign-in
/// goes in the address's fragment, which WebKit never sends, so the ticket is in no request the server could log.
pub(crate) fn sign_in_page(site: &Url, sign_in: &SignIn) -> Url {
    let mut fields = Url::parse("fields://sign-in").expect("a link");
    fields.query_pairs_mut().append_pair(TICKET_PARAM, &sign_in.ticket).append_pair(NONCE_PARAM, &sign_in.nonce);
    let mut page = site.join("/").expect("the site's address has a root");
    page.set_fragment(fields.query());
    page
}

/// The script that hands the page a sign-in. A page that listens takes it where it is, so signing in loads no new
/// page; one that does not, still loading or from an older build, is loaded again with it. Every string goes in as
/// JSON, so nothing in them is read as script.
pub(crate) fn sign_in_script(site: &Url, sign_in: &SignIn) -> String {
    let json = |value: &str| serde_json::to_string(value).expect("a string is JSON");
    let (ticket, nonce) = (json(&sign_in.ticket), json(&sign_in.nonce));
    let page = json(sign_in_page(site, sign_in).as_str());
    format!(
        "if (window.{SIGN_IN_LISTENING}) window.dispatchEvent(new CustomEvent({SIGN_IN_EVENT:?}, {{ detail: {{ ticket: {ticket}, nonce: {nonce} }} }})); \
         else location.replace({page});"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCHEME: &str = "com.example.app";
    const NONCE: &str = "0b6e2f5c-8d1a-4c3e-9f70-2a4b6c8d0e1f";

    fn url(s: &str) -> Url {
        s.parse().unwrap()
    }

    fn sign_in(ticket: &str) -> SignIn {
        SignIn { ticket: ticket.to_string(), nonce: NONCE.to_string() }
    }

    #[test]
    fn a_sign_in_link_carries_its_ticket_and_nonce_and_any_other_link_carries_none() {
        let link = |link: &str| sign_in_link(&url(link), SCHEME);
        assert_eq!(
            link(&format!("com.example.app://sign-in?ticket=eyJ0.abc_def-1%2B2%2F3%3D&nonce={NONCE}&extra=x")),
            Some(sign_in("eyJ0.abc_def-1+2/3="))
        );
        for other in [
            "com.example.app://sign-in?ticket=abc".to_string(),
            format!("com.example.app://sign-in?nonce={NONCE}"),
            format!("com.example.app://sign-in?ticket=&nonce={NONCE}"),
            "com.example.app://sign-in?ticket=abc&nonce=".to_string(),
            "com.example.app://sign-in".to_string(),
            format!("com.example.app://elsewhere?ticket=abc&nonce={NONCE}"),
            format!("other.app://sign-in?ticket=abc&nonce={NONCE}"),
            format!("https://sign-in/?ticket=abc&nonce={NONCE}"),
        ] {
            assert_eq!(link(&other), None, "{other}");
        }
    }

    #[test]
    fn a_ticket_or_nonce_that_could_be_read_as_script_is_never_taken() {
        let link = |ticket: &str, nonce: &str| sign_in_link(&url(&format!("com.example.app://sign-in?ticket={ticket}&nonce={nonce}")), SCHEME);
        for bad in ["a%22%29%3Balert(1)%2F%2F", "a%27b", "a%3Cb", "a%0Ab", &"a".repeat(4097)] {
            assert_eq!(link(bad, NONCE), None, "ticket {bad}");
        }
        for bad in ["a%22%29%3Balert(1)%2F%2F", "0b6e%27", "0b6e+2f5c", "zz"] {
            assert_eq!(link("abc", bad), None, "nonce {bad}");
        }
    }

    #[test]
    fn the_page_takes_a_sign_in_where_it_is_and_is_loaded_with_it_on_its_own_origin_when_it_cannot() {
        let site = url("https://app.example.com/start?x=1");
        assert_eq!(
            sign_in_script(&site, &sign_in("abc+def")),
            format!(
                r#"if (window.__APP_KIT_TAKES_DESKTOP_SIGN_IN__) window.dispatchEvent(new CustomEvent("app-kit-desktop-sign-in", {{ detail: {{ ticket: "abc+def", nonce: "{NONCE}" }} }})); else location.replace("https://app.example.com/#desktop_sign_in_ticket=abc%2Bdef&desktop_sign_in_nonce={NONCE}");"#
            )
        );
        let page = sign_in_page(&site, &sign_in("//elsewhere.example.com"));
        assert_eq!(page.host_str(), Some("app.example.com"));
        assert_eq!(page.path(), "/");
        assert_eq!(page.query(), None);
    }
}
