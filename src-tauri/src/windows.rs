//! Janelas sob demanda: o popup é criado ao abrir e destruído ao fechar (libera o WebView2).
use std::sync::atomic::{AtomicUsize, Ordering};
use tauri::{AppHandle, LogicalSize, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};

use crate::AppState;

/// Área de trabalho (sem a barra de tarefas) em pixels físicos: (left, top, right, bottom).
#[cfg(windows)]
pub fn work_area() -> Option<(i32, i32, i32, i32)> {
    use windows_sys::Win32::Foundation::RECT;
    use windows_sys::Win32::UI::WindowsAndMessaging::{SystemParametersInfoW, SPI_GETWORKAREA};
    let mut r = RECT { left: 0, top: 0, right: 0, bottom: 0 };
    // SAFETY: `r` é um RECT válido e vive durante a chamada.
    let ok = unsafe { SystemParametersInfoW(SPI_GETWORKAREA, 0, &mut r as *mut RECT as *mut _, 0) };
    (ok != 0).then_some((r.left, r.top, r.right, r.bottom))
}

#[cfg(not(windows))]
pub fn work_area() -> Option<(i32, i32, i32, i32)> {
    None
}

pub fn toggle_popup(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("popup") {
        let _ = w.close();
    } else {
        open_popup(app);
    }
}

pub fn open_popup(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("popup") {
        let _ = w.set_focus();
        return;
    }
    let (w, h) = (380.0, 640.0);
    let built = WebviewWindowBuilder::new(app, "popup", WebviewUrl::App("popup.html".into()))
        .title("Token Pets")
        .inner_size(w, h)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(true)
        .visible(false)
        .build();
    let Ok(win) = built else { return };
    let scale = win.scale_factor().unwrap_or(1.0);
    if let Some((_, _, right, bottom)) = work_area() {
        let x = right - (w * scale) as i32 - (12.0 * scale) as i32;
        let y = bottom - (h * scale) as i32 - (12.0 * scale) as i32;
        let _ = win.set_position(PhysicalPosition::new(x, y));
    }
    let _ = win.show();
    let _ = win.set_focus();
    let closer = win.clone();
    win.on_window_event(move |e| {
        if let tauri::WindowEvent::Focused(false) = e {
            let _ = closer.close();
        }
    });
}

const PET_SLOT: f64 = 56.0;
const PET_HEIGHT: f64 = 72.0;
const PET_MAX_SLOTS: usize = 9;
static PET_SLOTS: AtomicUsize = AtomicUsize::new(0);

/// Quantos "espaços" de boneco a janela do pet precisa: um por sessão (até 8, +1 de "+N"), mínimo 2 mascotes.
pub fn pet_slots(sessions: usize) -> usize {
    let n = if sessions > 8 { PET_MAX_SLOTS } else { sessions };
    n.max(2)
}

/// Cria, redimensiona ou fecha a janela do pet conforme a configuração e o número de sessões.
/// Roda na thread principal (criar janelas fora dela pode travar no Windows).
pub fn sync_pet(app: &AppHandle, sessions: usize) {
    let app2 = app.clone();
    let _ = app.run_on_main_thread(move || {
        let enabled = app2.state::<AppState>().store.get_bool("pet_enabled", false);
        let existing = app2.get_webview_window("pet");
        if !enabled {
            if let Some(w) = existing {
                let _ = w.close();
            }
            PET_SLOTS.store(0, Ordering::SeqCst);
            return;
        }
        let slots = pet_slots(sessions);
        let (w, h) = (slots as f64 * PET_SLOT + 16.0, PET_HEIGHT);
        let win = match existing {
            Some(win) => win,
            None => {
                let built = WebviewWindowBuilder::new(&app2, "pet", WebviewUrl::App("pet.html".into()))
                    .title("Token Pets Pet")
                    .inner_size(w, h)
                    .decorations(false)
                    .transparent(true)
                    .shadow(false)
                    .always_on_top(true)
                    .skip_taskbar(true)
                    .resizable(false)
                    .focused(false)
                    .build();
                let Ok(win) = built else { return };
                let _ = win.set_ignore_cursor_events(true);
                PET_SLOTS.store(0, Ordering::SeqCst);
                win
            }
        };
        if PET_SLOTS.swap(slots, Ordering::SeqCst) != slots {
            let _ = win.set_size(LogicalSize::new(w, h));
            let scale = win.scale_factor().unwrap_or(1.0);
            if let Some((_, _, right, bottom)) = work_area() {
                let x = right - (w * scale) as i32 - (16.0 * scale) as i32;
                let y = bottom - (h * scale) as i32;
                let _ = win.set_position(PhysicalPosition::new(x, y));
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pet_slots_has_two_mascots_minimum_and_caps_overflow() {
        assert_eq!(pet_slots(0), 2);
        assert_eq!(pet_slots(1), 2);
        assert_eq!(pet_slots(5), 5);
        assert_eq!(pet_slots(8), 8);
        assert_eq!(pet_slots(20), PET_MAX_SLOTS);
    }
}
