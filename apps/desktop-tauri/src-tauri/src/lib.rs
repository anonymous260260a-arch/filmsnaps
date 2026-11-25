mod adblock;
mod bridge;
mod commands;
mod config;
mod diag;
mod downloads;
mod expiry;
mod player;
mod power;
mod window_state;

use std::sync::{Arc, Mutex};

use tauri::webview::PageLoadEvent;
use tauri::Manager;

pub use tauri::Url;

pub struct AppState {
    pub config: config::AppConfig,
    pub blocker: Arc<adblock::AdBlocker>,
    pub player: Arc<player::Player>,
    pub downloads: Arc<downloads::Downloads>,
    /// An update that finished downloading and waits for the user to install
    /// it. Installing exits the process, so it is never done unasked.
    pub pending_update: Mutex<Option<(tauri_plugin_updater::Update, Vec<u8>)>>,
    pub provider: Mutex<Option<ProviderWebview>>,
    /// Bounds the page pushed before the provider webview existed.
    pub provider_bounds: Mutex<Option<(f64, f64, f64, f64)>>,
}

pub struct ProviderWebview {
    pub webview: tauri::Webview,
    pub url: String,
}

pub fn run() {
    // Every mark is timed from here, including the process's own startup.
    diag::start_timer();

    tauri::Builder::default()
        // Must be the first plugin: a second launch hands its arguments to the
        // running instance and exits before any window or player exists.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            diag::init(app.handle());
            // Starts before the window exists: it records when WebView2's
            // browser process actually starts, which is the one part of the
            // window-build span the app cannot see from inside the builder.
            diag::watch_startup(app.handle());
            // Must run on this thread: it follows the UI thread's own CPU time.
            diag::watch_cpu();
            let resource_dir = app.path().resource_dir().ok();
            let config = diag::span("config", || config::load(resource_dir))?;
            diag::mark!(
                "app",
                "config: {} providers, signature {}",
                config.provider_count(),
                if config.signature_verified {
                    "verified"
                } else {
                    "absent"
                }
            );
            let blocker = diag::span("adblock", || {
                Arc::new(adblock::AdBlocker::from_rules_text(&config.filters_txt))
            });
            diag::mark!("app", "adblock rules: {}", blocker.rule_count());
            let player = Arc::new(player::Player::new(mpv_search_dirs(&config)));
            let downloads = downloads::Downloads::new(app.handle().clone());

            app.manage(Arc::new(AppState {
                config,
                blocker,
                player,
                downloads,
                pending_update: Mutex::new(None),
                provider: Mutex::new(None),
                provider_bounds: Mutex::new(None),
            }));

            // The window is built here rather than in tauri.conf.json so the
            // bridge script is installed before the UI's first script runs.
            // It stays hidden until the saved geometry is applied, so restoring
            // does not flash the default rectangle first.
            let window = diag::span_cpu("webview", || {
                tauri::WebviewWindowBuilder::new(
                    app,
                    "main",
                    tauri::WebviewUrl::App("index.html".into()),
                )
                .title("FilmSnaps")
                .inner_size(window_state::DEFAULT_WIDTH, window_state::DEFAULT_HEIGHT)
                .min_inner_size(window_state::MIN_WIDTH, window_state::MIN_HEIGHT)
                .decorations(false)
                .visible(false)
                .initialization_script(bridge::bridge_script())
                // Separates the webview's own cost from the page's: the page
                // timeline starts when the navigation request is made here.
                .on_page_load(|_window, payload| {
                    let stage = match payload.event() {
                        PageLoadEvent::Started => "started",
                        PageLoadEvent::Finished => "finished",
                    };
                    diag::mark!("page", "load {stage} {}", payload.url());
                })
                .build()
            })?;
            diag::mark!("app", "webview created");
            diag::span("window state", || window_state::attach(app.handle(), &window));
            diag::attach_window(app.handle());
            diag::span("window shown", || window.show())?;
            power::attach(app.handle());
            diag::mark!("app", "setup complete (content still loading)");

            // Video is the whole point of the app, so pay the player's cold
            // start while the page is still rendering rather than on the first
            // play.
            commands::prewarm_player(app.handle().clone());

            // Quiet start-up update check: an unreachable feed or a missing
            // latest.json must not nag anyone, so only a found update (and a
            // failure to download it) reaches the page.
            let updater_app = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(6));
                commands::spawn_update_check(updater_app, true);
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_status,
            commands::api_fetch,
            commands::provider_open,
            commands::provider_set_bounds,
            commands::provider_set_visible,
            commands::provider_reload,
            commands::provider_close,
            commands::player_start,
            commands::player_stop,
            commands::player_open,
            commands::player_bounds,
            commands::player_visible,
            commands::player_control,
            commands::player_set_property,
            commands::player_state,
            diag::diag_log,
            commands::player_osc_source,
            commands::player_osc_status,
            commands::player_osc_panel,
            commands::window_control,
            commands::open_external,
            commands::legal_state,
            commands::legal_accept,
            commands::clear_cache,
            commands::download_folder,
            commands::download_start,
            commands::download_pause,
            commands::download_resume,
            commands::download_cancel,
            commands::download_get_all,
            commands::download_open,
            commands::download_clear,
            commands::download_speed_limit,
            commands::download_set_folder,
            commands::download_pick_folder,
            commands::falix_detail,
            commands::player_sub_add,
            commands::open_devtools,
            commands::update_check,
            commands::update_install,
        ])
        .run(tauri::generate_context!())
        .expect("failed to start FilmSnaps");
}

fn mpv_search_dirs(config: &config::AppConfig) -> Vec<std::path::PathBuf> {
    vec![
        config.config_dir.join("mpv"),
        config.config_dir.join("vendor/mpv"),
    ]
}
