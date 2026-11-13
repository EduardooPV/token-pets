//! Rastreia sessões e subagentes ativos em memória (nenhuma varredura de disco aqui).
use crate::model::{SessionInfo, SessionKind, SessionStatus, Tool};
use std::collections::HashMap;

/// Menos de 90 s sem atividade = trabalhando; até 10 min = parado/esperando você; depois some.
pub const WORKING_SECS: i64 = 90;
pub const GONE_SECS: i64 = 600;
/// Subagente já finalizado some logo após o último evento.
pub const FINISHED_GONE_SECS: i64 = 45;

#[derive(Debug, Clone)]
struct Entry {
    tool: Tool,
    kind: SessionKind,
    agent_type: Option<String>,
    label: String,
    last_activity: i64,
    tokens: u64,
    finished: bool,
}

#[derive(Default)]
pub struct SessionTracker {
    entries: HashMap<String, Entry>,
}

pub struct Touch<'a> {
    pub key: &'a str,
    pub tool: Tool,
    pub kind: SessionKind,
    pub agent_type: Option<String>,
    pub label: String,
    pub activity: i64,
    pub tokens: u64,
    pub finished: bool,
}

pub fn status_for(age_secs: i64) -> Option<SessionStatus> {
    if age_secs < WORKING_SECS {
        Some(SessionStatus::Working)
    } else if age_secs < GONE_SECS {
        Some(SessionStatus::Waiting)
    } else {
        None
    }
}

impl SessionTracker {
    pub fn touch(&mut self, t: Touch) {
        let e = self.entries.entry(t.key.to_string()).or_insert_with(|| Entry {
            tool: t.tool,
            kind: t.kind,
            agent_type: None,
            label: String::new(),
            last_activity: 0,
            tokens: 0,
            finished: false,
        });
        e.kind = t.kind;
        if t.agent_type.is_some() {
            e.agent_type = t.agent_type;
        }
        if !t.label.is_empty() {
            e.label = t.label;
        }
        e.last_activity = e.last_activity.max(t.activity);
        e.tokens = e.tokens.max(t.tokens);
        e.finished = t.finished;
    }

    pub fn add_tokens(&mut self, key: &str, tokens: u64) {
        if let Some(e) = self.entries.get_mut(key) {
            e.tokens += tokens;
        }
    }

    /// Sessões visíveis agora, trabalhando primeiro e mais recentes antes. Remove as expiradas.
    pub fn snapshot(&mut self, now: i64) -> Vec<SessionInfo> {
        self.entries.retain(|_, e| {
            let age = now - e.last_activity;
            age < GONE_SECS && !(e.finished && age >= FINISHED_GONE_SECS)
        });
        let mut out: Vec<SessionInfo> = self
            .entries
            .iter()
            .filter_map(|(key, e)| {
                let age = now - e.last_activity;
                let status = if e.finished { SessionStatus::Waiting } else { status_for(age)? };
                Some(SessionInfo {
                    id: key.clone(),
                    tool: e.tool,
                    kind: e.kind,
                    agent_type: e.agent_type.clone(),
                    label: e.label.clone(),
                    status,
                    last_activity: e.last_activity,
                    tokens: e.tokens,
                })
            })
            .collect();
        out.sort_by(|a, b| {
            (a.status != SessionStatus::Working)
                .cmp(&(b.status != SessionStatus::Working))
                .then(b.last_activity.cmp(&a.last_activity))
                .then(a.id.cmp(&b.id))
        });
        out
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn touch<'a>(key: &'a str, kind: SessionKind, activity: i64, finished: bool) -> Touch<'a> {
        Touch { key, tool: Tool::Claude, kind, agent_type: None, label: key.to_string(), activity, tokens: 0, finished }
    }

    #[test]
    fn status_thresholds() {
        assert_eq!(status_for(0), Some(SessionStatus::Working));
        assert_eq!(status_for(89), Some(SessionStatus::Working));
        assert_eq!(status_for(90), Some(SessionStatus::Waiting));
        assert_eq!(status_for(599), Some(SessionStatus::Waiting));
        assert_eq!(status_for(600), None);
    }

    #[test]
    fn session_goes_working_then_waiting_then_disappears() {
        let mut t = SessionTracker::default();
        t.touch(touch("a", SessionKind::Main, 1000, false));
        assert_eq!(t.snapshot(1010)[0].status, SessionStatus::Working);
        assert_eq!(t.snapshot(1100)[0].status, SessionStatus::Waiting);
        assert!(t.snapshot(1700).is_empty());
        assert!(t.is_empty());
    }

    #[test]
    fn finished_subagent_leaves_quickly_and_ordering_puts_working_first() {
        let mut t = SessionTracker::default();
        t.touch(touch("main-old", SessionKind::Main, 1000, false));
        t.touch(touch("sub", SessionKind::Subagent, 1500, true));
        t.touch(touch("main-new", SessionKind::Main, 1590, false));
        let s = t.snapshot(1600);
        assert_eq!(s.iter().map(|x| x.id.as_str()).collect::<Vec<_>>(), ["main-new", "sub", "main-old"]);
        let s = t.snapshot(1700);
        assert!(s.iter().all(|x| x.id != "sub"));
    }

    #[test]
    fn touch_keeps_agent_type_and_tokens_monotonic() {
        let mut t = SessionTracker::default();
        let mut a = touch("s", SessionKind::Subagent, 10, false);
        a.agent_type = Some("code-reviewer".into());
        a.tokens = 50;
        t.touch(a);
        let mut b = touch("s", SessionKind::Subagent, 5, false);
        b.tokens = 20;
        t.touch(b);
        t.add_tokens("s", 5);
        let s = t.snapshot(20);
        assert_eq!(s[0].agent_type.as_deref(), Some("code-reviewer"));
        assert_eq!((s[0].last_activity, s[0].tokens), (10, 55));
    }
}
