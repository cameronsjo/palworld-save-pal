pub mod api_convert;
pub mod lsp_service;
#[cfg(feature = "desktop")]
pub mod rfd_dialogs;
pub mod router;
pub mod server_ext;
pub mod servers_handlers;
pub mod services;
pub mod static_files;
pub mod system_native;
pub mod ws;

pub use psp_app::{
    blueprint_registry, desktop_dialogs, dispatcher, emitter, envelope, handler_error, handlers,
    messages, AppConfig, AppState, SessionStore, SharedSession,
};

use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;
use std::sync::Arc;

use psp_core::gamedata::GameData;

#[derive(Debug, Clone)]
pub struct ServerConfig {
    /// Web default 0.0.0.0; desktop 127.0.0.1.
    pub host: IpAddr,
    pub port: u16,
    pub ui_dir: PathBuf,
    /// Directory holding "json/" with the game data.
    pub data_dir: PathBuf,
    pub db_path: PathBuf,
    /// Enables native file dialogs and the local folder/browser handlers.
    pub desktop_mode: bool,
}

pub struct ServerHandle {
    pub addr: SocketAddr,
    pub app: Arc<AppState>,
    /// Subscriber on `AppState::live_connections`, seeded at 0 before any
    /// connection is accepted, so tests can await connection teardown instead
    /// of sleeping.
    pub live_connections: tokio::sync::watch::Receiver<usize>,
    shutdown_sender: tokio::sync::oneshot::Sender<()>,
    serve_task: tokio::task::JoinHandle<std::io::Result<()>>,
}

impl ServerHandle {
    pub async fn shutdown(self) {
        let _ = self.shutdown_sender.send(());
        let _ = self.serve_task.await;
    }

    pub async fn wait(self) {
        let _ = self.serve_task.await;
    }
}

/// Registers a `native` server row pointed at `saves_path` if one doesn't
/// already exist, so a save that's already bind-mounted into the pod shows
/// up in the UI without an operator filling out the "Add Server" form.
///
/// Existence-only probe: the matched world-directory name is never read into
/// the created row or logged — only the fixed `saves_path` from the env var
/// is persisted. Idempotent by construction (checked-then-create, gated on
/// an exact `saves_path` match), so it's safe to run on every startup.
async fn auto_register_mounted_save(state: &AppState, saves_path: &str) -> anyhow::Result<()> {
    let save_games = PathBuf::from(saves_path).join("SaveGames").join("0");
    let has_level_sav = std::fs::read_dir(&save_games)
        .into_iter()
        .flatten()
        .flatten()
        .any(|world_dir| world_dir.path().join("Level.sav").is_file());
    if !has_level_sav {
        tracing::info!(saves_path, "AUTO_LOAD_SAVES_PATH set but no Level.sav found under it");
        return Ok(());
    }

    let existing = psp_db::servers::list_servers(&*state.driver).await?;
    if existing.iter().any(|record| record.saves_path == saves_path) {
        return Ok(());
    }

    psp_db::servers::create_server(
        &*state.driver,
        psp_db::servers::NewServer {
            name: "Auto-detected save".to_string(),
            server_type: "native".to_string(),
            saves_path: saves_path.to_string(),
            install_path: saves_path.to_string(),
            server_name: "Auto-detected save".to_string(),
            ..Default::default()
        },
    )
    .await?;
    tracing::info!(saves_path, "auto-registered mounted save");
    Ok(())
}

pub async fn start_server(config: ServerConfig) -> anyhow::Result<ServerHandle> {
    // rfd only exists under the `desktop` feature; the headless server/Docker
    // build always uses the inert NullDialogProvider.
    #[cfg(feature = "desktop")]
    let dialogs: Arc<dyn crate::desktop_dialogs::FileDialogProvider> = if config.desktop_mode {
        Arc::new(crate::rfd_dialogs::RfdDialogProvider)
    } else {
        Arc::new(crate::desktop_dialogs::NullDialogProvider)
    };
    #[cfg(not(feature = "desktop"))]
    let dialogs: Arc<dyn crate::desktop_dialogs::FileDialogProvider> =
        Arc::new(crate::desktop_dialogs::NullDialogProvider);
    start_server_with(config, dialogs).await
}

/// Binds the listener before returning, so the port is already accepting
/// connections by the time the caller sees a `ServerHandle`.
pub async fn start_server_with(
    config: ServerConfig,
    dialogs: Arc<dyn crate::desktop_dialogs::FileDialogProvider>,
) -> anyhow::Result<ServerHandle> {
    let game_data = Arc::new(GameData::load(&config.data_dir.join("json"))?);
    let db = psp_db::open(&config.db_path).await?;
    let legacy_db_path = config
        .db_path
        .parent()
        .map(|dir| dir.join("psp.db"))
        .unwrap_or_else(|| std::path::PathBuf::from("psp.db"));
    let pal_data_validator = |value: &serde_json::Value| -> Result<serde_json::Value, String> {
        let dto =
            psp_core::dto::pal::PalDto::from_json_lenient(value).map_err(|e| e.to_string())?;
        serde_json::to_value(&dto).map_err(|e| e.to_string())
    };
    match psp_db::import_legacy::import_legacy_if_needed(&db, &legacy_db_path, &pal_data_validator)
        .await
    {
        Ok(Some(report)) => tracing::info!(?report, "legacy psp.db imported"),
        Ok(None) => {}
        Err(error) => {
            tracing::error!(%error, "legacy psp.db import failed; continuing with new DB")
        }
    }
    let (live_connections, live_connections_rx) = tokio::sync::watch::channel(0usize);
    // Both roots sit beside the database, the one directory the deployment
    // already guarantees is writable.
    let app_dir = config
        .db_path
        .parent()
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    let state = Arc::new(AppState {
        config: AppConfig {
            desktop_mode: config.desktop_mode,
        },
        game_data,
        driver: Arc::new(psp_db::SqlxSqliteDriver::new(db)),
        dialogs,
        live_connections,
        ext: Arc::new(crate::server_ext::ServerExtRouter {
            services: Arc::new(crate::services::ServerServices::real()),
        }),
        lsp: Arc::new(crate::lsp_service::ServerLspService::new(
            app_dir.join("lua-language-server"),
            app_dir.join("plugin-workspaces"),
        )),
        sessions: std::sync::Mutex::new(SessionStore::default()),
        breeding_db: Default::default(),
        plugins: Default::default(),
    });
    if let Ok(auto_load_saves_path) = std::env::var("AUTO_LOAD_SAVES_PATH") {
        if let Err(error) = auto_register_mounted_save(&state, &auto_load_saves_path).await {
            tracing::error!(%error, "AUTO_LOAD_SAVES_PATH auto-register failed; continuing without it");
        }
    }

    psp_app::handlers::plugins::seed_bundled_plugins(&state).await?;

    let listener = tokio::net::TcpListener::bind((config.host, config.port)).await?;
    let addr = listener.local_addr()?;
    tracing::info!(%addr, desktop_mode = config.desktop_mode, "psp-server listening");

    let (shutdown_sender, shutdown_receiver) = tokio::sync::oneshot::channel::<()>();
    let application = router::build_router(Arc::clone(&state), &config.ui_dir);
    let serve_task = tokio::spawn(async move {
        axum::serve(listener, application)
            .with_graceful_shutdown(async {
                let _ = shutdown_receiver.await;
            })
            .await
    });

    Ok(ServerHandle {
        addr,
        app: state,
        live_connections: live_connections_rx,
        shutdown_sender,
        serve_task,
    })
}

#[cfg(test)]
mod auto_register_tests {
    use crate::servers_handlers::test_env::TestEnv;

    /// Builds `<root>/SaveGames/0/WORLD01/Level.sav` so
    /// `auto_register_mounted_save` finds a mounted save to register.
    fn write_level_sav(root: &std::path::Path) {
        let world_dir = root.join("SaveGames").join("0").join("WORLD01");
        std::fs::create_dir_all(&world_dir).unwrap();
        std::fs::write(world_dir.join("Level.sav"), b"").unwrap();
    }

    #[tokio::test]
    async fn registers_a_server_row_for_the_mounted_save() {
        let env = TestEnv::new().await;
        let saves = tempfile::tempdir().unwrap();
        write_level_sav(saves.path());
        let saves_path = saves.path().to_str().unwrap();

        super::auto_register_mounted_save(&env.app, saves_path)
            .await
            .unwrap();

        let servers = psp_db::servers::list_servers(&*env.app.driver).await.unwrap();
        assert_eq!(servers.len(), 1);
        assert_eq!(servers[0].saves_path, saves_path);
        assert_eq!(servers[0].server_type, "native");
    }

    #[tokio::test]
    async fn second_startup_against_the_same_path_does_not_duplicate() {
        let env = TestEnv::new().await;
        let saves = tempfile::tempdir().unwrap();
        write_level_sav(saves.path());
        let saves_path = saves.path().to_str().unwrap();

        super::auto_register_mounted_save(&env.app, saves_path)
            .await
            .unwrap();
        super::auto_register_mounted_save(&env.app, saves_path)
            .await
            .unwrap();

        let servers = psp_db::servers::list_servers(&*env.app.driver).await.unwrap();
        assert_eq!(servers.len(), 1);
    }

    #[tokio::test]
    async fn no_level_sav_registers_nothing() {
        let env = TestEnv::new().await;
        let saves = tempfile::tempdir().unwrap();
        let saves_path = saves.path().to_str().unwrap();

        super::auto_register_mounted_save(&env.app, saves_path)
            .await
            .unwrap();

        let servers = psp_db::servers::list_servers(&*env.app.driver).await.unwrap();
        assert!(servers.is_empty());
    }
}
