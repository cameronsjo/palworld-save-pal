//! The /ws/{client_id} endpoint: one connection loop per client.

use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use axum::response::{IntoResponse, Response};
use futures::{SinkExt, StreamExt};

use uuid::Uuid;

use psp_core::session::Session;

use crate::dispatcher::{dispatch, HandlerCtx, SessionAttachment};
use crate::emitter::Emitter;
use crate::envelope::Envelope;
use crate::messages::MessageType;
use crate::AppState;

/// 1 GiB, applied to both the message and frame limit. It has to be this large
/// because payloads carry whole parsed saves, and `load_zip_file` sends an
/// entire zip as a JSON int array.
pub const MAX_WS_MESSAGE_BYTES: usize = 1 << 30;

/// Strips the scheme and any trailing path from an `Origin` header, leaving the
/// authority (`host[:port]`), and drops the port when it is the scheme's default
/// so `https://example.com:443` compares equal to a `Host` of `example.com`.
/// `None` for anything that is not a plain `scheme://authority` — notably the
/// opaque `Origin: null` a sandboxed iframe or a `file://` page sends, which
/// must never match a host.
fn origin_authority(origin: &str) -> Option<String> {
    let (scheme, rest) = origin.split_once("://")?;
    if rest.is_empty() || rest.contains('/') {
        return None;
    }
    let default_port = match scheme.to_ascii_lowercase().as_str() {
        "http" | "ws" => ":80",
        "https" | "wss" => ":443",
        _ => return None,
    };
    let authority = rest.to_ascii_lowercase();
    Some(match authority.strip_suffix(default_port) {
        // An IPv6 literal ends in `]`, so `[::1]:443` strips to `[::1]` and a
        // bare `[::1]` is left alone — neither can be confused for a port.
        Some(without_default_port) if !without_default_port.is_empty() => {
            without_default_port.to_owned()
        }
        _ => authority,
    })
}

/// Fails closed: a missing `Origin`, an unparseable one, or a missing `Host`
/// with no explicit allowlist all return `false`. Browsers always send `Origin`
/// on a websocket handshake and CORS never applies to one, so this header is the
/// only thing standing between a drive-by page and the whole message set.
pub fn origin_is_allowed(origin: Option<&str>, host: Option<&str>, allowed: &[String]) -> bool {
    let Some(origin) = origin else {
        return false;
    };
    if !allowed.is_empty() {
        // An explicit allowlist is compared verbatim against the full origin —
        // the operator wrote the scheme deliberately, and matching on authority
        // alone would let `http://` in where only `https://` was configured.
        return allowed.iter().any(|candidate| candidate == origin);
    }
    // Same-origin fallback. Note what this can and cannot do: both headers come
    // from the same request, so this comparison is self-referential — what
    // actually rejects a rebound hostname is the reverse proxy's own Host-based
    // routing rule. It closes the cross-origin drive-by (a page on evil.example
    // sends its own Origin and gets a 403) and nothing more. Configure
    // PSP_ALLOWED_ORIGINS to make the check stand on its own and to pin the
    // scheme, which this branch cannot.
    let (Some(origin_authority), Some(host)) = (origin_authority(origin), host) else {
        return false;
    };
    // Normalize BOTH sides the same way: stripping the default port from the
    // origin but not the host would fail closed on a `Host: example.com:443`.
    origin_authority == normalize_authority(host)
}

/// Lowercases and drops a default HTTP/HTTPS port, so `Host: example.com:443`
/// and `Host: example.com` compare equal.
fn normalize_authority(host: &str) -> String {
    let host = host.trim().to_ascii_lowercase();
    for default_port in [":443", ":80"] {
        if let Some(stripped) = host.strip_suffix(default_port) {
            if !stripped.is_empty() {
                return stripped.to_owned();
            }
        }
    }
    host
}

pub async fn ws_upgrade(
    upgrade: WebSocketUpgrade,
    Path(client_id): Path<String>,
    headers: axum::http::HeaderMap,
    State(app): State<Arc<AppState>>,
) -> Response {
    // Desktop serves over loopback to its own webview, whose origin varies by
    // platform and packaging; there is no cross-origin attacker on that surface.
    if !app.config.desktop_mode {
        let header = |name| headers.get(name).and_then(|value| value.to_str().ok());
        let origin = header(axum::http::header::ORIGIN);
        if !origin_is_allowed(
            origin,
            header(axum::http::header::HOST),
            &app.config.allowed_ws_origins,
        ) {
            tracing::warn!(
                origin = origin.unwrap_or("<absent>"),
                "rejecting websocket upgrade from a disallowed origin"
            );
            return (
                axum::http::StatusCode::FORBIDDEN,
                "websocket origin not allowed",
            )
                .into_response();
        }
    }
    upgrade
        .max_message_size(MAX_WS_MESSAGE_BYTES)
        .max_frame_size(MAX_WS_MESSAGE_BYTES)
        .on_upgrade(move |socket| connection_loop(socket, client_id, app))
}

/// Increments `AppState::live_connections` on construction and decrements it on
/// drop, so the gauge also unwinds on an early `return` or a panic inside
/// `connection_loop`. The increment lives in `new` so the pairing is structural:
/// no edit can slip a fallible call between "increment" and "build the guard".
struct LiveConnectionGuard(tokio::sync::watch::Sender<usize>);

impl LiveConnectionGuard {
    fn new(sender: tokio::sync::watch::Sender<usize>) -> Self {
        sender.send_modify(|count| *count += 1);
        Self(sender)
    }
}

impl Drop for LiveConnectionGuard {
    fn drop(&mut self) {
        self.0.send_modify(|count| *count = count.saturating_sub(1));
    }
}

/// Receives text frames until the client disconnects. Each connection owns its
/// own `Session`, so two browser tabs never clobber each other.
async fn connection_loop(socket: WebSocket, client_id: String, app: Arc<AppState>) {
    tracing::info!(%client_id, "client connected");
    let _live_connection_guard = LiveConnectionGuard::new(app.live_connections.clone());

    let (mut outgoing_sink, mut incoming_stream) = socket.split();
    let (frame_sender, mut frame_receiver) = tokio::sync::mpsc::unbounded_channel::<String>();

    // Drains the mpsc channel onto the socket so handlers never block on I/O.
    // Exits when the channel closes (all Emitters dropped) or the send fails
    // (client gone) — either way `frame_receiver.recv()` eventually returns
    // `None` or the loop `break`s, so this task always terminates.
    let writer_task = tokio::spawn(async move {
        while let Some(frame) = frame_receiver.recv().await {
            if outgoing_sink.send(Message::Text(frame.into())).await.is_err() {
                break;
            }
        }
    });

    let emitter = Emitter::new(frame_sender);

    // The connection owns ONE session `Arc` slot, reused for every message so
    // per-connection state (a loaded save, gamepass scan results, a transfer
    // source) persists across messages. A load registers this `Arc` in
    // `AppState::sessions` under a fresh id; `reattach_session` can REPLACE the
    // slot with the store's arc for another id, so it is `mut`.
    let mut current_session: Arc<tokio::sync::Mutex<Session>> =
        Arc::new(tokio::sync::Mutex::new(Session::new()));
    let mut current_session_id: Option<Uuid> = None;
    // Owned per-connection, dropped when the socket closes; lives across every
    // message the connection dispatches.
    let mut blueprints = crate::blueprint_registry::BlueprintRegistry::default();

    // `incoming_stream.next()` returns `None` on a clean disconnect and
    // `Some(Err(_))` on a protocol error (e.g. the client vanishing mid-frame
    // without a Close handshake); handlers run serially, each awaited before the
    // next frame is read. So the loop always terminates via one of the arms below.
    loop {
        match incoming_stream.next().await {
            Some(Ok(Message::Text(text))) => {
                process_text_frame(
                    text.as_str(),
                    &mut current_session,
                    &mut current_session_id,
                    &app,
                    &emitter,
                    &mut blueprints,
                )
                .await;
            }
            Some(Ok(Message::Close(_))) => break,
            // Ping/pong handled by axum; binary frames are not part of the protocol.
            Some(Ok(_)) => {}
            Some(Err(protocol_error)) => {
                tracing::warn!(%client_id, %protocol_error, "websocket protocol error; closing connection");
                break;
            }
            None => break,
        }
    }

    drop(emitter); // closes the channel → writer task exits
    let _ = writer_task.await;
    tracing::warn!(%client_id, "client disconnected");
}

async fn process_text_frame(
    text: &str,
    current_session: &mut Arc<tokio::sync::Mutex<Session>>,
    current_session_id: &mut Option<Uuid>,
    app: &Arc<AppState>,
    emitter: &Emitter,
    blueprints: &mut crate::blueprint_registry::BlueprintRegistry,
) {
    // A JSON decode failure sends an `error` message whose `data` is a plain
    // STRING, not the usual {message, trace} object.
    let raw_value: serde_json::Value = match serde_json::from_str(text) {
        Ok(value) => value,
        Err(parse_error) => {
            tracing::error!(%parse_error, "invalid JSON received");
            emitter.emit(
                MessageType::Error,
                &format!("Invalid JSON received:\n{parse_error}"),
            );
            return;
        }
    };

    // A malformed envelope (valid JSON, missing/odd "type") instead sends the
    // OBJECT shape: {"message": ..., "trace": ...}.
    let envelope: Envelope = match serde_json::from_value(raw_value) {
        Ok(envelope) => envelope,
        Err(shape_error) => {
            tracing::error!(%shape_error, "message missing envelope fields");
            emitter.emit_error(&shape_error.to_string(), &format!("{shape_error:?}"));
            return;
        }
    };

    tracing::debug!(message_type = %envelope.message_type, "processing message");

    // reattach_session / eject_session must NOT run under the connection's own
    // per-session guard: they lock a DIFFERENT arc (the target), and holding two
    // per-session guards on one task lets two mutually-reattaching connections
    // deadlock. They get a scratch session and lock at most the single arc they
    // need via `attachment.arc`.
    let holds_own_session_lock = !matches!(
        MessageType::from_wire(&envelope.message_type),
        Some(MessageType::ReattachSession | MessageType::EjectSession)
    );

    if holds_own_session_lock {
        // Lock a CLONE of the connection's current arc, not the slot itself, so
        // the slot stays mutably free for a reattach swap. The guard is held
        // across the handler's `.await`s (a `tokio::Mutex`), so the map lock
        // never is.
        let session_arc = Arc::clone(current_session);
        let mut session_guard = session_arc.lock().await;
        dispatch(
            envelope,
            HandlerCtx {
                session: &mut session_guard,
                app,
                emitter,
                blueprints,
                attachment: Some(SessionAttachment {
                    current_id: current_session_id,
                    arc: current_session,
                }),
            },
        )
        .await;
    } else {
        let mut scratch_session = Session::new();
        dispatch(
            envelope,
            HandlerCtx {
                session: &mut scratch_session,
                app,
                emitter,
                blueprints,
                attachment: Some(SessionAttachment {
                    current_id: current_session_id,
                    arc: current_session,
                }),
            },
        )
        .await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn allowlist(origins: &[&str]) -> Vec<String> {
        origins.iter().map(|origin| origin.to_string()).collect()
    }

    #[test]
    fn same_origin_default_accepts_the_deployments_own_page() {
        assert!(origin_is_allowed(
            Some("https://palworld-editor.sjo.lol"),
            Some("palworld-editor.sjo.lol"),
            &[],
        ));
    }

    #[test]
    fn same_origin_default_rejects_another_page_on_the_lan() {
        assert!(!origin_is_allowed(
            Some("http://192.168.1.50:8080"),
            Some("palworld-editor.sjo.lol"),
            &[],
        ));
    }

    #[test]
    fn a_missing_origin_is_refused() {
        // A non-browser client can simply omit the header; if that passed, the
        // check would stop nothing that matters.
        assert!(!origin_is_allowed(None, Some("palworld-editor.sjo.lol"), &[]));
        assert!(!origin_is_allowed(
            None,
            Some("palworld-editor.sjo.lol"),
            &allowlist(&["https://palworld-editor.sjo.lol"]),
        ));
    }

    #[test]
    fn opaque_and_malformed_origins_are_refused() {
        for origin in ["null", "https://evil.example/path", "https://", "sjo.lol"] {
            assert!(
                !origin_is_allowed(Some(origin), Some("sjo.lol"), &[]),
                "{origin} must not be accepted"
            );
        }
    }

    #[test]
    fn a_missing_host_is_refused_when_no_allowlist_is_configured() {
        assert!(!origin_is_allowed(Some("https://sjo.lol"), None, &[]));
    }

    #[test]
    fn default_ports_compare_equal_to_a_bare_host() {
        assert!(origin_is_allowed(Some("https://sjo.lol:443"), Some("sjo.lol"), &[]));
        assert!(origin_is_allowed(Some("http://sjo.lol:80"), Some("sjo.lol"), &[]));
        // …and symmetrically, with the default port on the HOST side instead.
        assert!(origin_is_allowed(Some("https://sjo.lol"), Some("sjo.lol:443"), &[]));
        assert!(origin_is_allowed(Some("HTTPS://SJO.LOL"), Some("Sjo.Lol"), &[]));
        // A NON-default port is part of the origin and must still be matched.
        assert!(!origin_is_allowed(Some("https://sjo.lol:8443"), Some("sjo.lol"), &[]));
    }

    #[test]
    fn an_explicit_allowlist_matches_the_whole_origin_including_scheme() {
        let allowed = allowlist(&["https://editor.sjo.lol", "http://localhost:5173"]);
        assert!(origin_is_allowed(
            Some("http://localhost:5173"),
            Some("anything"),
            &allowed
        ));
        // Same host, wrong scheme: the operator configured https, so http loses.
        assert!(!origin_is_allowed(
            Some("http://editor.sjo.lol"),
            Some("editor.sjo.lol"),
            &allowed
        ));
    }

    #[test]
    fn an_unset_allowlist_env_var_never_means_allow_all() {
        assert!(crate::parse_allowed_ws_origins(None).is_empty());
        assert!(crate::parse_allowed_ws_origins(Some("  , ,")).is_empty());
        assert_eq!(
            crate::parse_allowed_ws_origins(Some("https://a.example, https://b.example,")),
            allowlist(&["https://a.example", "https://b.example"]),
        );
    }

    #[test]
    fn max_ws_message_bytes_is_one_gibibyte() {
        // Sending a >1GiB frame in a test is not affordable, so this pins the
        // value `ws_upgrade` feeds to max_message_size/max_frame_size instead of
        // exercising the limit end-to-end.
        assert_eq!(MAX_WS_MESSAGE_BYTES, 1 << 30);
    }
}
