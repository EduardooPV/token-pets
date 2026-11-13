mod alerts;
mod collectors;
mod engine;
mod model;
mod pace;
mod runtime;
mod sessions;
mod store;
mod tray;
mod util;
mod windows;

use engine::Msg;
use model::{HistoryPoint, Settings, Snapshot};
use std::sync::Arc;
use store::Store;
use tauri::menu::{CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{image::Image, AppHandle, Manager, RunEvent, State};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

pub struct AppState {
    pub store: Arc<Store>,
    pub rt: runtime::Runtime,
}

fn current_settings(store: &Store) -> Settings {
    Settings {
        pet: store.get_bool("pet_enabled", false),
        sounds: store.get_bool("sounds_enabled", false),
        claude_exact: store.get_bool("claude_exact", true),
    }
}

#[tauri::command]
fn get_snapshot(state: State<AppState>) -> Snapshot {
    state.rt.snapshot.lock().map(|s| s.clone()).unwrap_or_else(|_| Snapshot::empty())
}

#[tauri::command]
fn get_history(state: State<AppState>, days: i64) -> Vec<HistoryPoint> {
    state.store.history(util::now_secs() - days.clamp(1, 30) * 86_400)
}

#[tauri::command]
fn get_settings(state: State<AppState>) -> Settings {
    current_settings(&state.store)
}

/// Alterna uma configuração booleana e aplica o efeito (pet, consulta da API).
fn toggle_setting(app: &AppHandle, key: &str, default: bool) {
    let state = app.state::<AppState>();
    let v = !state.store.get_bool(key, default);
    state.store.set_bool(key, v);
    match key {
        "pet_enabled" => {
            let n = state.rt.snapshot.lock().map(|s| s.sessions.len()).unwrap_or(0);
            windows::sync_pet(app, n);
        }
        "claude_exact" => {
            let _ = state.rt.wake_api.send(());
            let _ = state.rt.tx.send(Msg::Refresh);
        }
        _ => {}
    }
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let app2 = app.clone();
            let _ = app.run_on_main_thread(move || windows::open_popup(&app2));
        }))
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--hidden"])))
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![get_snapshot, get_history, get_settings])
        .setup(|app| {
            let store = Arc::new(Store::open().map_err(|e| e.to_string())?);
            let rt = runtime::start(app.handle(), store.clone());
            app.manage(AppState { store: store.clone(), rt });

            // Primeira execução: iniciar com o Windows (só em release, para não registrar o exe de dev).
            if !store.get_bool("first_run_done", false) {
                if !cfg!(debug_assertions) {
                    let _ = app.autolaunch().enable();
                }
                store.set_bool("first_run_done", true);
            }
            let autostart_on = app.autolaunch().is_enabled().unwrap_or(false);

            let open = MenuItemBuilder::with_id("open", "Abrir").build(app)?;
            let pet = CheckMenuItemBuilder::with_id("pet", "Pet flutuante")
                .checked(store.get_bool("pet_enabled", false))
                .build(app)?;
            let sounds = CheckMenuItemBuilder::with_id("sounds", "Sons")
                .checked(store.get_bool("sounds_enabled", false))
                .build(app)?;
            let exact = CheckMenuItemBuilder::with_id("claude_exact", "% exato do Claude")
                .checked(store.get_bool("claude_exact", true))
                .build(app)?;
            let autostart = CheckMenuItemBuilder::with_id("autostart", "Iniciar com o Windows")
                .checked(autostart_on)
                .build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "Sair").build(app)?;
            let menu = MenuBuilder::new(app)
                .items(&[&open, &pet, &sounds, &exact, &autostart])
                .separator()
                .item(&quit)
                .build()?;

            let icon = Image::new_owned(tray::render_icon(None), tray::SIZE, tray::SIZE);
            TrayIconBuilder::with_id("main")
                .icon(icon)
                .tooltip("Token Pets")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    "open" => windows::open_popup(app),
                    "pet" => toggle_setting(app, "pet_enabled", false),
                    "sounds" => toggle_setting(app, "sounds_enabled", false),
                    "claude_exact" => toggle_setting(app, "claude_exact", true),
                    "autostart" => {
                        let al = app.autolaunch();
                        if al.is_enabled().unwrap_or(false) {
                            let _ = al.disable();
                        } else {
                            let _ = al.enable();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        windows::toggle_popup(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("erro ao construir o app");

    app.run(|_app, event| {
        // Sem janela aberta o app continua vivo na bandeja; só `app.exit(0)` encerra.
        if let RunEvent::ExitRequested { api, code, .. } = event {
            if code.is_none() {
                api.prevent_exit();
            }
        }
    });
}
