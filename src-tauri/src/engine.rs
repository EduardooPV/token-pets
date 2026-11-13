//! Motor: junta os coletores, mantém o estado em memória e monta o `Snapshot`.
//! Nenhuma varredura periódica: só reage a eventos de arquivo (via `Msg::Paths`) e a leituras da API.
use crate::collectors::claude_api::{ApiUsage, ApiWindow};
use crate::collectors::claude_local::{self, FileKind, ParsedLine};
use crate::collectors::codex::{self, CodexSample, SessionMeta};
use crate::model::*;
use crate::pace;
use crate::sessions::{SessionTracker, Touch, GONE_SECS};
use crate::store::Store;
use crate::util::{file_mtime_secs, first_line, read_new_lines, TailState};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::Arc;

pub const WEEK: i64 = 7 * 86_400;
pub const FIVE_HOURS: i64 = 5 * 3600;
/// Tetos iniciais (tokens ponderados) da estimativa local; são recalibrados quando o número exato chega.
pub const DEFAULT_CAP_5H: f64 = 6.0e6;
pub const DEFAULT_CAP_7D: f64 = 8.0e7;
/// Leitura exata mais velha que isso (3 consultas sem resposta) deixa de valer.
const EXACT_FRESH_SECS: i64 = 15 * 60;

#[derive(Debug, Clone, PartialEq)]
pub struct Caps {
    pub five: f64,
    pub week: f64,
    pub calibrated: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ExactReading {
    pub five: Option<ApiWindow>,
    pub week: Option<ApiWindow>,
    pub read_at: i64,
}

/// Mensagens que o laço do motor recebe.
pub enum Msg {
    Paths(Vec<PathBuf>),
    Exact(Result<ApiUsage, String>),
    Refresh,
}

#[derive(Default)]
struct ClaudeFile {
    tail: TailState,
    title: Option<String>,
    cwd: Option<String>,
    seen: HashMap<String, (f64, u64)>,
}

struct CodexFile {
    tail: TailState,
    meta: SessionMeta,
    tokens: u64,
}

pub struct Engine {
    store: Arc<Store>,
    claude_root: PathBuf,
    codex_root: PathBuf,
    sessions: SessionTracker,
    codex_files: HashMap<PathBuf, CodexFile>,
    codex_latest: Option<CodexSample>,
    claude_files: HashMap<PathBuf, ClaudeFile>,
    stored_offsets: HashMap<PathBuf, u64>,
    minutes: BTreeMap<i64, (f64, u64)>,
    dirty_minutes: BTreeSet<i64>,
    dirty_offsets: BTreeSet<PathBuf>,
    exact: Option<ExactReading>,
    exact_error: Option<String>,
    caps: Caps,
    last_sample: HashMap<(Tool, &'static str), (i64, f64, i64)>,
    last_prune: i64,
}

fn exact_limit(w: &ApiWindow, window_minutes: u32, read_at: i64, now: i64) -> Limit {
    let renewed = w.resets_at.is_some_and(|r| r <= now);
    Limit {
        used_percent: if renewed { 0.0 } else { w.utilization },
        resets_at: if renewed { None } else { w.resets_at },
        window_minutes,
        source: LimitSource::Exact,
        read_at,
        renewed,
        projected_exhaust_at: None,
    }
}

fn estimated_limit(sum: f64, cap: f64, window_minutes: u32, now: i64) -> Limit {
    Limit {
        used_percent: if cap > 0.0 { (sum / cap * 100.0).clamp(0.0, 100.0) } else { 0.0 },
        resets_at: None,
        window_minutes,
        source: LimitSource::Estimated,
        read_at: now,
        renewed: false,
        projected_exhaust_at: None,
    }
}

/// Número exato quando a leitura é recente; senão a estimativa a partir dos tokens locais.
pub fn build_claude_usage(now: i64, sum5: f64, sum7: f64, caps: &Caps, exact: Option<&ExactReading>) -> ToolUsage {
    let fresh = exact.filter(|e| now - e.read_at <= EXACT_FRESH_SECS);
    let five = match fresh.and_then(|e| e.five.as_ref()) {
        Some(w) => exact_limit(w, 300, fresh.unwrap().read_at, now),
        None => estimated_limit(sum5, caps.five, 300, now),
    };
    let week = match fresh.and_then(|e| e.week.as_ref()) {
        Some(w) => exact_limit(w, 10080, fresh.unwrap().read_at, now),
        None => estimated_limit(sum7, caps.week, 10080, now),
    };
    ToolUsage { tool: Tool::Claude, plan: None, five_hour: Some(five), weekly: Some(week), calibrated: caps.calibrated }
}

/// Ajusta o teto para que `sum` corresponda ao % exato informado. Ignora leituras baixas demais (ruído).
pub fn calibrate(sum: f64, exact_pct: f64, current: f64) -> f64 {
    if exact_pct >= 3.0 && sum > 0.0 {
        sum / (exact_pct / 100.0)
    } else {
        current
    }
}

fn list_files(dir: &Path, depth: u32, out: &mut Vec<(PathBuf, i64)>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        let Ok(ft) = e.file_type() else { continue };
        if ft.is_dir() {
            if depth > 0 {
                list_files(&p, depth - 1, out);
            }
        } else if p.extension().is_some_and(|x| x == "jsonl") {
            if let Some(m) = file_mtime_secs(&p) {
                out.push((p, m));
            }
        }
    }
}

impl Engine {
    pub fn new(store: Arc<Store>, claude_root: PathBuf, codex_root: PathBuf, now: i64) -> Self {
        let minutes = store.load_minutes((now - WEEK) / 60).into_iter().map(|(m, w, t)| (m, (w, t))).collect();
        let stored_offsets = store.load_offsets().into_iter().map(|(p, o)| (PathBuf::from(p), o)).collect();
        let caps = Caps {
            five: store.get("claude_cap_5h").and_then(|v| v.parse().ok()).unwrap_or(DEFAULT_CAP_5H),
            week: store.get("claude_cap_7d").and_then(|v| v.parse().ok()).unwrap_or(DEFAULT_CAP_7D),
            calibrated: store.get_bool("claude_cap_cal", false),
        };
        Self {
            store,
            claude_root,
            codex_root,
            sessions: SessionTracker::default(),
            codex_files: HashMap::new(),
            codex_latest: None,
            claude_files: HashMap::new(),
            stored_offsets,
            minutes,
            dirty_minutes: BTreeSet::new(),
            dirty_offsets: BTreeSet::new(),
            exact: None,
            exact_error: None,
            caps,
            last_sample: HashMap::new(),
            last_prune: 0,
        }
    }

    pub fn roots(&self) -> (&Path, &Path) {
        (&self.claude_root, &self.codex_root)
    }

    /// Leitura inicial: Codex (arquivos mais recentes até achar um limite) e Claude (últimos 7 dias, a partir do offset salvo).
    pub fn initial_scan(&mut self, now: i64) {
        let mut files = vec![];
        list_files(&self.codex_root.clone(), 4, &mut files);
        files.sort_by(|a, b| b.1.cmp(&a.1));
        for (p, m) in files.into_iter().take(60) {
            if now - m >= GONE_SECS && self.codex_latest.is_some() {
                break;
            }
            self.process_codex(&p, now);
        }
        let mut files = vec![];
        list_files(&self.claude_root.clone(), 4, &mut files);
        files.sort_by(|a, b| a.1.cmp(&b.1));
        for (p, m) in files {
            if now - m <= WEEK {
                self.process_claude(&p, now);
            }
        }
        self.flush(now);
    }

    pub fn handle_path(&mut self, path: &Path, now: i64) {
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if let Some(stem) = name.strip_suffix(".meta.json") {
            let jl = path.with_file_name(format!("{stem}.jsonl"));
            if jl.starts_with(&self.claude_root) {
                self.process_claude(&jl, now);
            }
        } else if path.extension().is_some_and(|x| x == "jsonl") {
            if path.starts_with(&self.codex_root) {
                self.process_codex(path, now);
            } else if path.starts_with(&self.claude_root) {
                self.process_claude(path, now);
            }
        }
    }

    fn process_codex(&mut self, path: &Path, now: i64) {
        let mtime = file_mtime_secs(path).unwrap_or(now);
        let cf = self.codex_files.entry(path.to_path_buf()).or_insert_with(|| CodexFile {
            tail: TailState::default(),
            meta: first_line(path, 1 << 20).and_then(|l| codex::parse_session_meta(&l)).unwrap_or_default(),
            tokens: 0,
        });
        let mut best: Option<CodexSample> = None;
        let mut last_tokens = None;
        let _ = read_new_lines(path, &mut cf.tail, |line| {
            if let Some(s) = codex::parse_line(line) {
                if s.total_tokens.is_some() {
                    last_tokens = s.total_tokens;
                }
                if (s.primary.is_some() || s.secondary.is_some()) && best.as_ref().is_none_or(|b| s.ts >= b.ts) {
                    best = Some(s);
                }
            }
        });
        if let Some(t) = last_tokens {
            cf.tokens = t;
        }
        let (label, subagent, tokens) = (codex::label_from_cwd(cf.meta.cwd.as_deref()), cf.meta.is_subagent, cf.tokens);
        if let Some(b) = best {
            if self.codex_latest.as_ref().is_none_or(|c| b.ts >= c.ts) {
                self.codex_latest = Some(b);
            }
        }
        if now - mtime < GONE_SECS {
            self.sessions.touch(Touch {
                key: &path.to_string_lossy(),
                tool: Tool::Codex,
                kind: if subagent { SessionKind::Subagent } else { SessionKind::Main },
                agent_type: None,
                label,
                activity: mtime,
                tokens,
                finished: false,
            });
        }
    }

    fn process_claude(&mut self, path: &Path, now: i64) {
        let Some(kind) = claude_local::classify_path(path, &self.claude_root) else { return };
        let mtime = file_mtime_secs(path).unwrap_or(now);
        let offset = self.stored_offsets.get(path).copied().unwrap_or(0);
        let st = self
            .claude_files
            .entry(path.to_path_buf())
            .or_insert_with(|| ClaudeFile { tail: TailState { offset }, ..Default::default() });
        let ClaudeFile { tail, title, cwd, seen } = st;
        let mut added: Vec<(i64, f64, u64)> = vec![];
        let mut tokens_added = 0u64;
        let res = read_new_lines(path, tail, |line| match claude_local::parse_line(line) {
            Some(ParsedLine::Usage(u)) => {
                // o mesmo message.id aparece em várias linhas (uma por bloco): conta só o acréscimo
                let prev = seen.get(&u.message_id).copied().unwrap_or((0.0, 0));
                let dw = (u.weighted - prev.0).max(0.0);
                let dt = u.tokens.saturating_sub(prev.1);
                if dw > 0.0 || dt > 0 {
                    added.push((u.ts.div_euclid(60), dw, dt));
                    tokens_added += dt;
                }
                seen.insert(u.message_id, (u.weighted.max(prev.0), u.tokens.max(prev.1)));
                if u.cwd.is_some() {
                    *cwd = u.cwd;
                }
            }
            Some(ParsedLine::Title(t)) => *title = Some(t),
            None => {}
        });
        if seen.len() > 20_000 {
            seen.clear();
        }
        let new_offset = tail.offset;
        let (title, cwd) = (title.clone(), cwd.clone());
        if res.is_err() {
            return;
        }
        let cutoff = (now - WEEK).div_euclid(60);
        for (m, w, t) in added {
            if m >= cutoff {
                let e = self.minutes.entry(m).or_insert((0.0, 0));
                e.0 += w;
                e.1 += t;
                self.dirty_minutes.insert(m);
            }
        }
        self.stored_offsets.insert(path.to_path_buf(), new_offset);
        self.dirty_offsets.insert(path.to_path_buf());
        if now - mtime >= GONE_SECS {
            return;
        }
        let key = path.to_string_lossy().to_string();
        let (skind, label, agent_type, finished) = match &kind {
            FileKind::Main { session_id } => {
                let fallback = || format!("sessão {}", session_id.chars().take(6).collect::<String>());
                let label = title.or_else(|| claude_local::label_from_cwd(cwd.as_deref())).unwrap_or_else(fallback);
                (SessionKind::Main, label, None, false)
            }
            FileKind::Subagent { agent_id, .. } => {
                let meta = std::fs::read_to_string(path.with_extension("meta.json"))
                    .map(|s| claude_local::parse_agent_meta(&s))
                    .unwrap_or_default();
                let label = meta
                    .description
                    .clone()
                    .or_else(|| meta.agent_type.clone())
                    .unwrap_or_else(|| format!("agente {}", agent_id.chars().take(6).collect::<String>()));
                (SessionKind::Subagent, label, meta.agent_type, meta.finished)
            }
        };
        self.sessions.touch(Touch {
            key: &key,
            tool: Tool::Claude,
            kind: skind,
            agent_type,
            label,
            activity: mtime,
            tokens: 0,
            finished,
        });
        self.sessions.add_tokens(&key, tokens_added);
    }

    /// Soma de tokens ponderados nas janelas de 5h e 7d.
    pub fn window_sums(&self, now: i64) -> (f64, f64) {
        let from5 = (now - FIVE_HOURS).div_euclid(60);
        let from7 = (now - WEEK).div_euclid(60);
        let mut s5 = 0.0;
        let mut s7 = 0.0;
        for (m, (w, _)) in self.minutes.range(from7..) {
            s7 += w;
            if *m >= from5 {
                s5 += w;
            }
        }
        (s5, s7)
    }

    pub fn set_exact(&mut self, r: Result<ApiUsage, String>, now: i64) {
        match r {
            Ok(u) => {
                let (s5, s7) = self.window_sums(now);
                if let Some(w) = &u.five_hour {
                    self.caps.five = calibrate(s5, w.utilization, self.caps.five);
                }
                if let Some(w) = &u.seven_day {
                    self.caps.week = calibrate(s7, w.utilization, self.caps.week);
                }
                let any = u.five_hour.as_ref().is_some_and(|w| w.utilization >= 3.0) || u.seven_day.as_ref().is_some_and(|w| w.utilization >= 3.0);
                if any {
                    self.caps.calibrated = true;
                    self.store.set("claude_cap_5h", &self.caps.five.to_string());
                    self.store.set("claude_cap_7d", &self.caps.week.to_string());
                    self.store.set_bool("claude_cap_cal", true);
                }
                self.exact = Some(ExactReading { five: u.five_hour, week: u.seven_day, read_at: now });
                self.exact_error = None;
            }
            Err(e) => self.exact_error = Some(e),
        }
    }

    pub fn snapshot(&mut self, now: i64) -> Snapshot {
        let sessions = self.sessions.snapshot(now);
        let codex = codex::usage_from_sample(self.codex_latest.as_ref(), now);
        let (s5, s7) = self.window_sums(now);
        let exact_on = self.store.get_bool("claude_exact", true);
        let claude = build_claude_usage(now, s5, s7, &self.caps, if exact_on { self.exact.as_ref() } else { None });
        let mut snap = Snapshot {
            claude,
            codex,
            sessions,
            updated_at: now,
            claude_exact_error: if exact_on { self.exact_error.clone() } else { None },
        };
        self.record_samples_and_pace(&mut snap, now);
        snap
    }

    fn record_samples_and_pace(&mut self, snap: &mut Snapshot, now: i64) {
        for tool in [Tool::Claude, Tool::Codex] {
            let u = if tool == Tool::Claude { &mut snap.claude } else { &mut snap.codex };
            let windows = [("5h", FIVE_HOURS, 3 * 3600, &mut u.five_hour), ("7d", WEEK, 2 * 86_400, &mut u.weekly)];
            for (win, secs, lookback, lim) in windows {
                let Some(l) = lim else { continue };
                if l.renewed {
                    continue;
                }
                let key = (tool, win);
                let due = match self.last_sample.get(&key) {
                    None => true,
                    Some(&(ts, pct, read_at)) => {
                        let changed = (l.used_percent - pct).abs() >= 1.0;
                        if l.source == LimitSource::Log {
                            l.read_at > read_at && (now - ts >= 60 || changed)
                        } else {
                            now - ts >= 300 || changed
                        }
                    }
                };
                let sample_ts = if l.source == LimitSource::Log { l.read_at } else { now };
                if due {
                    self.store.add_sample(sample_ts, tool, win, l.used_percent);
                    self.last_sample.insert(key, (sample_ts, l.used_percent, l.read_at));
                }
                let mut pts = self.store.samples_since(tool, win, now - lookback);
                pts.push((sample_ts, l.used_percent));
                let window_start = l.resets_at.map(|r| r - secs).unwrap_or(now - secs);
                l.projected_exhaust_at = pace::project_exhaustion(&pts, now, window_start, lookback, l.used_percent);
            }
        }
    }

    /// Grava no SQLite o que mudou e apaga dados antigos (no máximo 1x por hora).
    pub fn flush(&mut self, now: i64) {
        if !self.dirty_minutes.is_empty() {
            let rows: Vec<(i64, f64, u64)> = self.dirty_minutes.iter().filter_map(|m| self.minutes.get(m).map(|(w, t)| (*m, *w, *t))).collect();
            self.store.save_minutes(&rows);
            self.dirty_minutes.clear();
        }
        if !self.dirty_offsets.is_empty() {
            let rows: Vec<(String, u64)> = self
                .dirty_offsets
                .iter()
                .filter_map(|p| self.stored_offsets.get(p).map(|o| (p.to_string_lossy().to_string(), *o)))
                .collect();
            self.store.save_offsets(&rows);
            self.dirty_offsets.clear();
        }
        if now - self.last_prune >= 3600 {
            self.last_prune = now;
            let cutoff = (now - WEEK - 86_400).div_euclid(60);
            self.minutes = self.minutes.split_off(&cutoff);
            self.store.prune_minutes(cutoff);
            self.store.prune_samples(now - 30 * 86_400);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::util::{format_iso8601, now_secs};
    use std::io::Write;
    use std::sync::atomic::{AtomicU32, Ordering};

    static N: AtomicU32 = AtomicU32::new(0);

    fn tmpdir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("token-pets-eng-{}-{}-{name}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn assistant(id: &str, ts: i64, input: u64, output: u64) -> String {
        format!(
            r#"{{"type":"assistant","timestamp":"{}","cwd":"C:\\proj\\meu-app","message":{{"id":"{id}","usage":{{"input_tokens":{input},"output_tokens":{output},"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}}}}"#,
            format_iso8601(ts)
        )
    }

    fn write(path: &Path, lines: &[String]) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let mut f = std::fs::OpenOptions::new().create(true).append(true).open(path).unwrap();
        for l in lines {
            writeln!(f, "{l}").unwrap();
        }
    }

    fn engine(store: &Arc<Store>, claude: &Path, codex: &Path, now: i64) -> Engine {
        Engine::new(store.clone(), claude.to_path_buf(), codex.to_path_buf(), now)
    }

    #[test]
    fn claude_counts_unique_messages_and_tracks_session() {
        let (claude, codex) = (tmpdir("c1"), tmpdir("x1"));
        let now = now_secs();
        let f = claude.join("proj").join("sess1.jsonl");
        write(
            &f,
            &[
                r#"{"type":"custom-title","customTitle":"Minha sessão"}"#.into(),
                assistant("m1", now - 30, 100, 10),
                assistant("m1", now - 30, 100, 40), // mesmo id, saída maior: conta só o acréscimo
                assistant("m2", now - 10, 50, 0),
            ],
        );
        let store = Arc::new(Store::in_memory().unwrap());
        let mut e = engine(&store, &claude, &codex, now);
        e.handle_path(&f, now);
        let (s5, s7) = e.window_sums(now);
        let expected = (100.0 + 5.0 * 40.0) + 50.0;
        assert!((s5 - expected).abs() < 1e-6 && (s7 - expected).abs() < 1e-6, "s5={s5}");
        let snap = e.snapshot(now);
        assert_eq!(snap.sessions.len(), 1);
        assert_eq!(snap.sessions[0].label, "Minha sessão");
        assert_eq!(snap.sessions[0].status, SessionStatus::Working);
        assert_eq!(snap.sessions[0].tokens, 100 + 40 + 50);
        let l = snap.claude.five_hour.unwrap();
        assert_eq!(l.source, LimitSource::Estimated);
        assert!(l.used_percent > 0.0);
    }

    #[test]
    fn claude_label_falls_back_to_cwd_and_ignores_old_tokens() {
        let (claude, codex) = (tmpdir("c2"), tmpdir("x2"));
        let now = now_secs();
        let f = claude.join("p").join("s2.jsonl");
        write(&f, &[assistant("a", now - 6 * 3600, 1000, 0), assistant("b", now - 5, 10, 0)]);
        let mut e = engine(&Arc::new(Store::in_memory().unwrap()), &claude, &codex, now);
        e.handle_path(&f, now);
        let (s5, s7) = e.window_sums(now);
        assert_eq!(s5, 10.0); // a de 6h atrás fica fora da janela de 5h
        assert_eq!(s7, 1010.0);
        assert_eq!(e.snapshot(now).sessions[0].label, "meu-app");
    }

    #[test]
    fn restart_does_not_double_count_thanks_to_saved_offsets() {
        let (claude, codex) = (tmpdir("c3"), tmpdir("x3"));
        let now = now_secs();
        let f = claude.join("p").join("s3.jsonl");
        write(&f, &[assistant("a", now - 20, 200, 0)]);
        let store = Arc::new(Store::in_memory().unwrap());
        let mut e1 = engine(&store, &claude, &codex, now);
        e1.initial_scan(now);
        assert_eq!(e1.window_sums(now).0, 200.0);
        let mut e2 = engine(&store, &claude, &codex, now);
        e2.initial_scan(now);
        assert_eq!(e2.window_sums(now).0, 200.0);
        // linha nova depois do restart soma normalmente
        write(&f, &[assistant("b", now - 5, 30, 0)]);
        e2.handle_path(&f, now);
        assert_eq!(e2.window_sums(now).0, 230.0);
    }

    #[test]
    fn subagent_gets_type_label_and_finishes() {
        let (claude, codex) = (tmpdir("c4"), tmpdir("x4"));
        let now = now_secs();
        let dir = claude.join("p").join("sess").join("subagents");
        write(&dir.join("agent-ab12.jsonl"), &[assistant("s1", now - 5, 10, 1)]);
        std::fs::write(dir.join("agent-ab12.meta.json"), r#"{"agentType":"security-probe","description":"Sonda de segurança","finished":false}"#).unwrap();
        let mut e = engine(&Arc::new(Store::in_memory().unwrap()), &claude, &codex, now);
        e.handle_path(&dir.join("agent-ab12.jsonl"), now);
        let s = e.snapshot(now).sessions;
        assert_eq!(s.len(), 1);
        assert_eq!((s[0].kind, s[0].agent_type.as_deref(), s[0].label.as_str()), (SessionKind::Subagent, Some("security-probe"), "Sonda de segurança"));
        // meta atualizado para finished => evento do .meta.json reprocessa o jsonl
        std::fs::write(dir.join("agent-ab12.meta.json"), r#"{"agentType":"security-probe","description":"Sonda de segurança","finished":true}"#).unwrap();
        e.handle_path(&dir.join("agent-ab12.meta.json"), now);
        assert_eq!(e.snapshot(now + 60).sessions.len(), 0);
    }

    #[test]
    fn codex_limits_and_session_from_rollout() {
        let (claude, codex) = (tmpdir("c5"), tmpdir("x5"));
        let now = now_secs();
        let f = codex.join("2026").join("11").join("12").join("rollout-a.jsonl");
        let meta = r#"{"type":"session_meta","payload":{"id":"abc","cwd":"C:\\Users\\x\\codex-proj"}}"#;
        let tc = format!(
            r#"{{"timestamp":"{}","type":"event_msg","payload":{{"type":"token_count","info":{{"total_token_usage":{{"total_tokens":777}}}},"rate_limits":{{"limit_id":"codex","primary":{{"used_percent":64.0,"window_minutes":300,"resets_at":{}}},"secondary":{{"used_percent":94.0,"window_minutes":10080,"resets_at":{}}},"plan_type":"plus"}}}}}}"#,
            format_iso8601(now - 20),
            now + 3600,
            now + 86_400
        );
        write(&f, &[meta.into(), tc]);
        let mut e = engine(&Arc::new(Store::in_memory().unwrap()), &claude, &codex, now);
        e.initial_scan(now);
        let snap = e.snapshot(now);
        let h5 = snap.codex.five_hour.clone().unwrap();
        assert_eq!((h5.used_percent, h5.source), (64.0, LimitSource::Log));
        assert_eq!(snap.codex.weekly.unwrap().used_percent, 94.0);
        assert_eq!(snap.codex.plan.as_deref(), Some("plus"));
        assert_eq!(snap.sessions.len(), 1);
        assert_eq!((snap.sessions[0].tool, snap.sessions[0].label.as_str(), snap.sessions[0].tokens), (Tool::Codex, "codex-proj", 777));
        // depois do reset a barra zera e marca renovado
        let later = e.snapshot(now + 3601);
        assert!(later.codex.five_hour.unwrap().renewed);
    }

    #[test]
    fn missing_roots_do_not_panic() {
        let now = now_secs();
        let mut e = engine(&Arc::new(Store::in_memory().unwrap()), Path::new("Z:/nao/existe/claude"), Path::new("Z:/nao/existe/codex"), now);
        e.initial_scan(now);
        let s = e.snapshot(now);
        assert!(s.sessions.is_empty() && s.codex.five_hour.is_none());
    }

    #[test]
    fn exact_reading_replaces_estimate_then_expires() {
        let caps = Caps { five: 1000.0, week: 10_000.0, calibrated: false };
        let exact = ExactReading {
            five: Some(ApiWindow { utilization: 37.0, resets_at: Some(5000) }),
            week: Some(ApiWindow { utilization: 20.0, resets_at: Some(900_000) }),
            read_at: 1000,
        };
        let u = build_claude_usage(1100, 500.0, 500.0, &caps, Some(&exact));
        let h5 = u.five_hour.unwrap();
        assert_eq!((h5.used_percent, h5.source, h5.resets_at), (37.0, LimitSource::Exact, Some(5000)));
        // leitura velha (> 15 min): volta para a estimativa
        let u = build_claude_usage(1000 + 16 * 60, 500.0, 500.0, &caps, Some(&exact));
        assert_eq!(u.five_hour.unwrap().source, LimitSource::Estimated);
        // sem exata: estimativa = soma / teto
        let u = build_claude_usage(1100, 500.0, 5000.0, &caps, None);
        assert_eq!(u.five_hour.unwrap().used_percent, 50.0);
        assert_eq!(u.weekly.unwrap().used_percent, 50.0);
        // janela exata já vencida vira "renovado"
        let u = build_claude_usage(1200, 0.0, 0.0, &caps, Some(&ExactReading { read_at: 1190, five: Some(ApiWindow { utilization: 90.0, resets_at: Some(1100) }), week: None }));
        assert!(u.five_hour.unwrap().renewed);
    }

    #[test]
    fn calibration_sets_cap_from_exact_percentage() {
        assert_eq!(calibrate(500.0, 25.0, 1.0), 2000.0);
        assert_eq!(calibrate(500.0, 1.0, 1234.0), 1234.0); // leitura baixa demais: mantém
        assert_eq!(calibrate(0.0, 50.0, 1234.0), 1234.0);
    }

    #[test]
    fn set_exact_calibrates_caps_and_failure_keeps_estimate() {
        let (claude, codex) = (tmpdir("c6"), tmpdir("x6"));
        let now = now_secs();
        let f = claude.join("p").join("s6.jsonl");
        write(&f, &[assistant("a", now - 20, 1000, 0)]);
        let store = Arc::new(Store::in_memory().unwrap());
        let mut e = engine(&store, &claude, &codex, now);
        e.handle_path(&f, now);
        e.set_exact(
            Ok(ApiUsage { five_hour: Some(ApiWindow { utilization: 10.0, resets_at: Some(now + 1000) }), seven_day: None }),
            now,
        );
        let snap = e.snapshot(now);
        assert!(snap.claude.calibrated);
        assert_eq!(snap.claude.five_hour.as_ref().unwrap().source, LimitSource::Exact);
        assert_eq!(store.get("claude_cap_5h").as_deref(), Some("10000"));
        // falha da API: guarda o motivo e, passada a validade, usa a estimativa calibrada (1000/10000 = 10%)
        e.set_exact(Err("login expirado".into()), now + 2000);
        let snap = e.snapshot(now + 2000);
        assert_eq!(snap.claude_exact_error.as_deref(), Some("login expirado"));
        let l = snap.claude.five_hour.unwrap();
        assert_eq!(l.source, LimitSource::Estimated);
        assert!((l.used_percent - 10.0).abs() < 1e-9);
    }

    #[test]
    fn disabling_exact_hides_it() {
        let (claude, codex) = (tmpdir("c7"), tmpdir("x7"));
        let now = now_secs();
        let store = Arc::new(Store::in_memory().unwrap());
        let mut e = engine(&store, &claude, &codex, now);
        e.set_exact(Ok(ApiUsage { five_hour: Some(ApiWindow { utilization: 40.0, resets_at: None }), seven_day: None }), now);
        assert_eq!(e.snapshot(now).claude.five_hour.unwrap().source, LimitSource::Exact);
        store.set_bool("claude_exact", false);
        assert_eq!(e.snapshot(now).claude.five_hour.unwrap().source, LimitSource::Estimated);
    }
}
