//! Which addresses the window shows itself and which go out to the Mac's or the phone's own apps. The window shows the
//! site and nothing else, so a link to another site never replaces the app's own page; WebKit asks about every frame
//! as well as the page, so a frame from another site the page embeds goes out too, unless the app keeps its host.

use crate::sign_in::SIGN_IN_PATH;
use tauri::Url;

/// What the window does with an address.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Link {
    /// Shows it in the window.
    Keep,
    /// Hands it to the default browser, or to the app for mail, phone and text links.
    SendOut,
    /// Does nothing with it: a file, a script, another app's scheme.
    Refuse,
}

/// The hosts the window always keeps, beside the site: Cloudflare's bot check, which Clerk's sign-up shows in a frame.
pub(crate) const ALWAYS_KEPT: &[&str] = &["challenges.cloudflare.com"];

/// Whether `host` is `site` or under it, as clerk.app.example.com is under app.example.com.
fn under(host: &str, site: &str) -> bool {
    host == site || host.strip_suffix(site).is_some_and(|rest| rest.ends_with('.'))
}

/// What the window does with an address it is asked to show: the site and its subdomains, any host the app keeps, the
/// app's bundled start page, and pages made in the window stay; other web pages and mail, phone and text links go out;
/// desktop sign-in's browser page always goes out, since Google refuses to sign in inside the window.
pub(crate) fn link_decision(url: &Url, site: &Url, kept: &[String]) -> Link {
    match url.scheme() {
        "about" | "blob" | "data" => Link::Keep,
        "tauri" if url.host_str() == Some("localhost") => Link::Keep,
        "http" | "https" => {
            let host = url.host_str().unwrap_or_default();
            let ours = site.host_str().is_some_and(|site| under(host, site));
            let kept = kept.iter().map(String::as_str).chain(ALWAYS_KEPT.iter().copied()).any(|kept| under(host, kept));
            if ours && url.path() == SIGN_IN_PATH {
                Link::SendOut
            } else if ours || kept {
                Link::Keep
            } else {
                Link::SendOut
            }
        }
        "mailto" | "tel" | "sms" => Link::SendOut,
        _ => Link::Refuse,
    }
}

/// What the window does with a page's request for a new window, as a link with target=_blank or window.open: it opens
/// no second window, so a web page goes to the browser, the site's own included, and mail, phone and text links to
/// their apps.
pub(crate) fn new_window_decision(url: &Url) -> Link {
    match url.scheme() {
        "http" | "https" | "mailto" | "tel" | "sms" => Link::SendOut,
        _ => Link::Refuse,
    }
}

/// An address as a log line names it: its scheme and host only. A path, query or fragment can hold a sign-in ticket
/// (the fallback address carries one in its fragment), an email address or a phone number.
pub(crate) fn loggable(url: &Url) -> String {
    match url.host_str() {
        Some(host) => format!("{}://{host}", url.scheme()),
        None => format!("{}:", url.scheme()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        s.parse().unwrap()
    }

    fn decide(link: &str) -> Link {
        link_decision(&url(link), &url("https://app.example.com"), &["www.youtube-nocookie.com".to_string()])
    }

    #[test]
    fn the_site_its_subdomains_and_pages_made_in_the_window_stay() {
        for link in [
            "https://app.example.com/",
            "https://app.example.com/#desktop_sign_in_ticket=abc&desktop_sign_in_nonce=0b6e",
            "https://clerk.app.example.com/v1/client",
            "http://app.example.com/",
            "about:blank",
            "about:srcdoc",
            "blob:https://app.example.com/0b6e",
            "data:text/html,hi",
            "tauri://localhost/index.html",
        ] {
            assert_eq!(decide(link), Link::Keep, "{link}");
        }
    }

    #[test]
    fn a_host_the_app_keeps_and_cloudflares_bot_check_stay() {
        assert_eq!(decide("https://www.youtube-nocookie.com/embed/1"), Link::Keep);
        assert_eq!(decide("https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/if/ov2"), Link::Keep);
        assert_eq!(decide("https://youtube-nocookie.com/embed/1"), Link::SendOut);
    }

    #[test]
    fn other_sites_and_desktop_sign_in_go_out_and_mail_phone_and_text_go_to_their_apps() {
        for link in [
            "https://accounts.google.com/o/oauth2/v2/auth",
            "https://app.example.com/desktop-sign-in?nonce=0b6e&account=choose",
            "https://app.example.com.elsewhere.example.com/",
            "https://example.com/",
            "https://otherapp.example.com/",
            "mailto:someone@example.com",
            "tel:+18006624357",
            "sms:988",
        ] {
            assert_eq!(decide(link), Link::SendOut, "{link}");
        }
    }

    #[test]
    fn files_scripts_and_other_apps_links_do_nothing() {
        for link in ["file:///etc/passwd", "javascript:alert(1)", "com.example.app://restart", "tauri://elsewhere/index.html", "ftp://example.com/"] {
            assert_eq!(decide(link), Link::Refuse, "{link}");
        }
    }

    #[test]
    fn a_new_window_opens_web_mail_phone_and_text_links_outside_and_nothing_else() {
        for link in ["https://maps.apple.com/?q=1", "http://example.com/", "https://app.example.com/", "mailto:someone@example.com", "tel:+1", "sms:988"] {
            assert_eq!(new_window_decision(&url(link)), Link::SendOut, "{link}");
        }
        for link in ["file:///etc/passwd", "javascript:alert(1)", "com.example.app://restart", "about:blank"] {
            assert_eq!(new_window_decision(&url(link)), Link::Refuse, "{link}");
        }
    }

    #[test]
    fn a_log_line_names_only_the_scheme_and_host() {
        let ticket = "tkt_secret.abc";
        let fallback = url(&format!("https://app.example.com/#desktop_sign_in_ticket={ticket}&desktop_sign_in_nonce=0b6e"));
        assert_eq!(loggable(&fallback), "https://app.example.com");
        let refused = url(&format!("com.example.app://sign-in?ticket={ticket}&nonce=%27"));
        assert_eq!(loggable(&refused), "com.example.app://sign-in");
        for line in [loggable(&fallback), loggable(&refused)] {
            assert!(!line.contains(ticket), "{line}");
        }
        assert_eq!(loggable(&url("mailto:someone@example.com")), "mailto:");
        assert_eq!(loggable(&url("tel:+18006624357")), "tel:");
    }
}
