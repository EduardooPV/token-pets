//! Threads do app: motor (watcher + atualização), consulta periódica da API do Claude e publicação do estado.
use crate::alerts::{self, AlertState};
use crate::collectors::claude_api;
use crate::engine::{Engine, Msg};
use crate::model::Snapshot;
use crate::store::Store;
use crate::tray::{self, Mood};
use crate::util::now_secs;
use crate::windows;
use notify::{EventKind, RecursiveMode, Watcher};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::image::Image;
use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;

const DEBOUNCE: Duration = Duration::from_secs(1);
/// Recalcula o estado sem evento de arquivo (status trabalhando/esperando, reset de janelas).
const TICK: Duration = Duration::from_secs(15);
const API_EVERY: Duration = Duration::from_secs(300);

pub struct Runtime {
    pub tx: Sender<Msg>,
    pub wake_api: Sender<()>,
    pub snapshot: Arc<Mutex<Snapshot>>,
}

fn relevant(p: &std::path::Path) -> bool {
    p.extension().is_some_and(|e| e == "jsonl") || p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.ends_with(".meta.json"))
}

fn same_content(a: &Snapshot, b: &Snapshot) -> bool {
    let mut a = a.clone();
    a.updated_at = b.updated_at;
    a == *b
}

#[derive(Default)]
struct TrayState {
    key: Option<(i32, Mood)>,
    tooltip: String,
}

fn update_tray(app: &AppHandle, snap: &Snapshot, st: &mut TrayState) {
    let pct = [snap.claude.max_percent(), snap.codex.max_percent()].into_iter().flatten().fold(None, |a: Option<f64>, p| Some(a.map_or(p, |x| x.max(p))));
    let Some(tray_icon) = app.tray_by_id("main") else { return };
    let key = (pct.map_or(-1, |p| (p / 4.0) as i32), tray::mood_for(pct.map(|p| p as f32)));
    if st.key != Some(key) {
        st.key = Some(key);
        let rgba = tray::render_icon(pct.map(|p| p as f32));
        let _ = tray_icon.set_icon(Some(Image::new_owned(rgba, tray::SIZE, tray::SIZE)));
    }
    let f = |l: &Option<crate::model::Limit>| l.as_ref().filter(|l| !l.renewed).map(|l| l.used_percent as f32);
    let tip = tray::tooltip(&[
        ("Claude", f(&snap.claude.five_hour), f(&snap.claude.weekly)),
        ("Codex", f(&snap.codex.five_hour), f(&snap.codex.weekly)),
    ]);
    if tip != st.tooltip {
        let _ = tray_icon.set_tooltip(Some(&tip));
        st.tooltip = tip;
    }
}

struct Publisher {
    app: AppHandle,
    shared: Arc<Mutex<Snapshot>>,
    prev: Option<Snapshot>,
    alert_state: AlertState,
    tray: TrayState,
}

impl Publisher {
    fn publish(&mut self, snap: Snapshot) {
        for ev in alerts::evaluate(self.prev.as_ref(), &snap, &mut self.alert_state) {
            let _ = self.app.notification().builder().title(&ev.title).body(&ev.body).show();
            let _ = self.app.emit("alert", &ev);
        }
        let changed = self.prev.as_ref().is_none_or(|p| !same_content(p, &snap));
        if changed {
            if let Ok(mut g) = self.shared.lock() {
                *g = snap.clone();
            }
            let _ = self.app.emit("snapshot", &snap);
            update_tray(&self.app, &snap, &mut self.tray);
            windows::sync_pet(&self.app, snap.sessions.len());
        }
        self.prev = Some(snap);
    }
}

pub fn start(app: &AppHandle, store: Arc<Store>) -> Runtime {
    let (tx, rx) = mpsc::channel::<Msg>();
    let (wake_tx, wake_rx) = mpsc::channel::<()>();
    let shared = Arc::new(Mutex::new(Snapshot::empty()));

    // consulta periódica ao endpoint de uso do Claude (só enquanto "% exato" estiver ligado)
    {
        let (tx, store) = (tx.clone(), store.clone());
        thread::spawn(move || loop {
            if store.get_bool("claude_exact", true) {
                let _ = tx.send(Msg::Exact(claude_api::fetch(now_secs())));
            }
            match wake_rx.recv_timeout(API_EVERY) {
                Ok(()) | Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }
        });
    }

    let engine_tx = tx.clone();
    let (app, shared2) = (app.clone(), shared.clone());
    thread::spawn(move || {
        let home = dirs::home_dir().unwrap_or_default();
        let claude_root = home.join(".claude").join("projects");
        let codex_root = home.join(".codex").join("sessions");
        let mut eng = Engine::new(store, claude_root.clone(), codex_root.clone(), now_secs());

        let wtx = engine_tx.clone();
        let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            if let Ok(ev) = res {
                if matches!(ev.kind, EventKind::Create(_) | EventKind::Modify(_) | EventKind::Any) {
                    let paths: Vec<PathBuf> = ev.paths.into_iter().filter(|p| relevant(p)).collect();
                    if !paths.is_empty() {
                        let _ = wtx.send(Msg::Paths(paths));
                    }
                }
            }
        })
        .ok();
        if let Some(w) = watcher.as_mut() {
            for root in [&claude_root, &codex_root] {
                if root.exists() {
                    let _ = w.watch(root, RecursiveMode::Recursive);
                }
            }
        }

        eng.initial_scan(now_secs());
        let mut publisher = Publisher { app, shared: shared2, prev: None, alert_state: AlertState::default(), tray: TrayState::default() };
        publisher.publish(eng.snapshot(now_secs()));

        let mut pending: HashSet<PathBuf> = HashSet::new();
        let mut deadline: Option<Instant> = None;
        loop {
            let timeout = deadline.map_or(TICK, |d| d.saturating_duration_since(Instant::now()));
            match rx.recv_timeout(timeout) {
                Ok(Msg::Paths(p)) => {
                    pending.extend(p);
                    deadline.get_or_insert_with(|| Instant::now() + DEBOUNCE);
                }
                Ok(Msg::Exact(r)) => eng.set_exact(r, now_secs()),
                Ok(Msg::Refresh) => {}
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }
            let due = deadline.is_some_and(|d| Instant::now() >= d);
            let now = now_secs();
            if due {
                for p in pending.drain() {
                    eng.handle_path(&p, now);
                }
                deadline = None;
                eng.flush(now);
            }
            // só recalcula quando algo mudou ou no tick; mensagens pendentes de debounce esperam o prazo
            if deadline.is_none() || due {
                publisher.publish(eng.snapshot(now));
            }
        }
    });

    Runtime { tx, wake_api: wake_tx, snapshot: shared }
}
