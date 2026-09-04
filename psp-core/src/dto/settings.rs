use serde::{Deserialize, Serialize};

/// Full settings object as sent to the frontend (response to `get_settings`,
/// `update_settings`, and the `sync_app_state` settings emission).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettingsDto {
    pub language: String,
    pub save_dir: String,
    pub clone_prefix: String,
    pub new_pal_prefix: String,
    pub debug_mode: bool,
    pub cheat_mode: bool,
    /// True when the deployment mounts the save it edits, computed from
    /// `AppConfig` at emit time. Deliberately NOT a `settings` table column and
    /// not in `SettingsUpdateDto`: the NavBar echoes the whole settings object
    /// back through `update_settings`, so a persisted field here would be
    /// client-assertable. It is a RENDERING HINT — nothing may authorize on it.
    #[serde(default)]
    pub server_managed: bool,
}

/// `update_settings` request payload. Deliberately has no `save_dir`: that
/// setting is never updated through this message.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettingsUpdateDto {
    pub language: String,
    pub clone_prefix: String,
    pub new_pal_prefix: String,
    pub debug_mode: bool,
    pub cheat_mode: bool,
}

#[cfg(test)]
mod tests {
    use super::{SettingsDto, SettingsUpdateDto};

    #[test]
    fn settings_dto_serializes_every_field_in_python_order() {
        let dto = SettingsDto {
            language: "en".into(),
            save_dir: "C:\\Saves".into(),
            clone_prefix: "©️".into(),
            new_pal_prefix: "🆕".into(),
            debug_mode: false,
            cheat_mode: true,
            server_managed: true,
        };
        let json_text = serde_json::to_string(&dto).unwrap();
        assert_eq!(
            json_text,
            r#"{"language":"en","save_dir":"C:\\Saves","clone_prefix":"©️","new_pal_prefix":"🆕","debug_mode":false,"cheat_mode":true,"server_managed":true}"#
        );
    }

    #[test]
    fn update_dto_ignores_extra_keys_like_save_dir() {
        // The NavBar sends {...appState.settings}, which includes save_dir.
        let payload = r#"{"language":"fr","clone_prefix":"c","new_pal_prefix":"n",
                          "debug_mode":true,"cheat_mode":false,"save_dir":"/tmp"}"#;
        let update: SettingsUpdateDto = serde_json::from_str(payload).unwrap();

        assert_eq!(update.language, "fr");
        assert_eq!(update.clone_prefix, "c");
        assert_eq!(update.new_pal_prefix, "n");
        assert!(update.debug_mode);
        assert!(!update.cheat_mode);

        let reserialized = serde_json::to_value(&update).unwrap();
        let obj = reserialized.as_object().unwrap();
        assert_eq!(
            obj.len(),
            5,
            "SettingsUpdateDto should have exactly 5 fields"
        );
        assert!(
            !obj.contains_key("save_dir"),
            "save_dir should not be present in serialized output"
        );
    }
}
