use psp_core::dto::settings::{SettingsDto, SettingsUpdateDto};
use psp_db::settings::{get_settings, update_settings, SettingsRow, SettingsUpdate};

use crate::dispatcher::HandlerCtx;
use crate::handler_error::HandlerError;
use crate::messages::MessageType;

/// `server_managed` is passed in rather than read from the row: it is computed
/// from `AppConfig` on every emit, so no client round-trip can set it. Every
/// caller passes `ctx.app.config.server_managed()`.
pub fn settings_dto_from_row(row: SettingsRow, server_managed: bool) -> SettingsDto {
    SettingsDto {
        language: row.language,
        save_dir: row.save_dir,
        clone_prefix: row.clone_prefix,
        new_pal_prefix: row.new_pal_prefix,
        debug_mode: row.debug_mode,
        cheat_mode: row.cheat_mode,
        server_managed,
    }
}

pub async fn handle_get_settings(ctx: &mut HandlerCtx<'_>) -> Result<(), HandlerError> {
    let row = get_settings(&*ctx.app.driver).await?;
    let server_managed = ctx.app.config.server_managed();
    ctx.emitter
        .emit(MessageType::GetSettings, &settings_dto_from_row(row, server_managed));
    Ok(())
}

/// Answers under `get_settings`, NOT `update_settings` — the frontend refreshes
/// its settings store off that message type.
pub async fn handle_update_settings(
    update: SettingsUpdateDto,
    ctx: &mut HandlerCtx<'_>,
) -> Result<(), HandlerError> {
    let row = update_settings(
        &*ctx.app.driver,
        &SettingsUpdate {
            language: update.language,
            clone_prefix: update.clone_prefix,
            new_pal_prefix: update.new_pal_prefix,
            debug_mode: update.debug_mode,
            cheat_mode: update.cheat_mode,
        },
    )
    .await?;
    let server_managed = ctx.app.config.server_managed();
    ctx.emitter
        .emit(MessageType::GetSettings, &settings_dto_from_row(row, server_managed));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dispatcher::HandlerCtx;
    use crate::test_support::TestContext;

    #[tokio::test]
    async fn get_settings_emits_defaults() {
        let mut test = TestContext::new(|_| {}).await;
        let mut ctx = HandlerCtx {
            session: &mut test.session,
            app: &test.app,
            emitter: &test.emitter,
            blueprints: &mut test.blueprints,
            attachment: None,
        };
        handle_get_settings(&mut ctx).await.unwrap();

        let frame = test.next_frame_json();
        assert_eq!(frame["type"], "get_settings");
        assert_eq!(frame["data"]["language"], "en");
        assert_eq!(frame["data"]["clone_prefix"], "©️");
        assert_eq!(frame["data"]["new_pal_prefix"], "🆕");
        assert_eq!(frame["data"]["debug_mode"], false);
        assert_eq!(frame["data"]["cheat_mode"], false);
        assert!(frame["data"]["save_dir"].is_string());
        test.assert_no_more_frames();
    }

    #[tokio::test]
    async fn update_settings_responds_with_get_settings_type() {
        let mut test = TestContext::new(|_| {}).await;
        let mut ctx = HandlerCtx {
            session: &mut test.session,
            app: &test.app,
            emitter: &test.emitter,
            blueprints: &mut test.blueprints,
            attachment: None,
        };
        let update: psp_core::dto::settings::SettingsUpdateDto =
            serde_json::from_value(serde_json::json!({
                "language": "fr", "clone_prefix": "©️", "new_pal_prefix": "🆕",
                "debug_mode": true, "cheat_mode": false,
                "save_dir": "ignored-extra-key"
            }))
            .unwrap();
        handle_update_settings(update, &mut ctx).await.unwrap();

        let frame = test.next_frame_json();
        assert_eq!(frame["type"], "get_settings");
        assert_eq!(frame["data"]["language"], "fr");
        assert_eq!(frame["data"]["debug_mode"], true);
        // `save_dir` is not a settable field: the response must carry the row's
        // persisted default, never the extra key the request smuggled in.
        assert_eq!(
            frame["data"]["save_dir"],
            psp_db::settings::default_steam_save_dir()
        );
        test.assert_no_more_frames();
    }

    /// The NavBar echoes the whole settings object back through
    /// `update_settings`, so a client can put `server_managed: true` on the
    /// wire. The response must still carry the value computed from AppConfig —
    /// `false` for the default test app — not the one the request asserted.
    #[tokio::test]
    async fn server_managed_is_computed_and_not_client_assertable() {
        let mut test = TestContext::new(|_| {}).await;
        let mut ctx = HandlerCtx {
            session: &mut test.session,
            app: &test.app,
            emitter: &test.emitter,
            blueprints: &mut test.blueprints,
            attachment: None,
        };
        let update: psp_core::dto::settings::SettingsUpdateDto =
            serde_json::from_value(serde_json::json!({
                "language": "en", "clone_prefix": "©️", "new_pal_prefix": "🆕",
                "debug_mode": false, "cheat_mode": false,
                "server_managed": true
            }))
            .unwrap();
        handle_update_settings(update, &mut ctx).await.unwrap();

        assert_eq!(test.next_frame_json()["data"]["server_managed"], false);
        test.assert_no_more_frames();
    }
}
