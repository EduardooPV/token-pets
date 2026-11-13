//! Decide quais avisos disparar comparando o snapshot anterior com o novo (função pura, testável).
use crate::model::{AlertEvent, Limit, SessionStatus, Snapshot, Tool};
use crate::util;
use std::collections::HashSet;

#[derive(Default)]
pub struct AlertState {
    /// chaves já avisadas: "tool|janela|resets_at|limiar"
    fired: HashSet<String>,
}

const THRESHOLDS: [(u32, &str); 2] = [(95, "threshold95"), (80, "threshold80")];

fn windows(s: &Snapshot, tool: Tool) -> [(&'static str, &'static str, Option<&Limit>); 2] {
    let u = s.usage(tool);
    [("5h", "de 5h", u.five_hour.as_ref()), ("7d", "semanal", u.weekly.as_ref())]
}

fn key(tool: Tool, win: &str, l: &Limit, thr: u32) -> String {
    format!("{}|{}|{}|{}", tool.as_str(), win, l.resets_at.unwrap_or(0), thr)
}

fn reset_in(l: &Limit, now: i64) -> String {
    match l.resets_at {
        Some(r) if r > now => format!("Renova em {}.", fmt_duration(r - now)),
        _ => String::new(),
    }
}

pub fn fmt_duration(secs: i64) -> String {
    let m = (secs.max(0) / 60).max(1);
    if m < 60 {
        format!("{m} min")
    } else if m < 24 * 60 {
        let (h, rm) = (m / 60, m % 60);
        if rm == 0 { format!("{h} h") } else { format!("{h} h {rm} min") }
    } else {
        let (d, rh) = (m / 1440, (m % 1440) / 60);
        if rh == 0 { format!("{d} d") } else { format!("{d} d {rh} h") }
    }
}

/// `prev = None` é a primeira leitura: só registra o que já estava acima dos limiares, sem avisar.
pub fn evaluate(prev: Option<&Snapshot>, next: &Snapshot, state: &mut AlertState) -> Vec<AlertEvent> {
    let now = if next.updated_at > 0 { next.updated_at } else { util::now_secs() };
    let mut out = vec![];
    for tool in [Tool::Claude, Tool::Codex] {
        for (win, win_label, limit) in windows(next, tool) {
            let Some(l) = limit else { continue };
            if l.renewed {
                continue;
            }
            // limiares: avisa só o maior cruzado e marca os menores como já avisados
            let crossed: Vec<(u32, &str)> = THRESHOLDS.iter().copied().filter(|(t, _)| l.used_percent >= *t as f64).collect();
            let mut newly = None;
            for (thr, kind) in &crossed {
                if state.fired.insert(key(tool, win, l, *thr)) && newly.is_none() {
                    newly = Some((*thr, *kind));
                }
            }
            if let (Some((thr, kind)), Some(_)) = (newly, prev) {
                let est = if l.source == crate::model::LimitSource::Estimated { " (estimado)" } else { "" };
                out.push(AlertEvent {
                    kind: kind.into(),
                    title: format!("{}: {}% do limite {}{}", tool.display(), thr, win_label, est),
                    body: format!("Uso em {:.0}%. {}", l.used_percent, reset_in(l, now)).trim().to_string(),
                });
            }
        }
    }
    let Some(prev) = prev else { return out };
    // reset: nova janela (resets_at maior) ou janela marcada como renovada
    for tool in [Tool::Claude, Tool::Codex] {
        let before = windows(prev, tool);
        let after = windows(next, tool);
        for i in 0..2 {
            let (win, win_label, _) = after[i];
            let (Some(b), Some(a)) = (before[i].2, after[i].2) else { continue };
            let was_used = !b.renewed && b.used_percent >= 1.0;
            let new_window = matches!((b.resets_at, a.resets_at), (Some(x), Some(y)) if y > x + 60);
            let became_renewed = a.renewed && !b.renewed;
            if was_used && (new_window || became_renewed) {
                let tag = format!("reset|{}|{}|{}", tool.as_str(), win, b.resets_at.unwrap_or(0));
                if state.fired.insert(tag) {
                    out.push(AlertEvent {
                        kind: "reset".into(),
                        title: format!("{}: limite {} renovado", tool.display(), win_label),
                        body: "Barra zerada, pode voltar a usar à vontade.".into(),
                    });
                }
            }
        }
    }
    // agente terminou (ou espera você): trabalhando antes, parado/ausente agora
    for s in prev.sessions.iter().filter(|s| s.status == SessionStatus::Working) {
        let still_working = next.sessions.iter().any(|n| n.id == s.id && n.status == SessionStatus::Working);
        if !still_working {
            out.push(AlertEvent {
                kind: "agentDone".into(),
                title: format!("{} parou", s.label),
                body: format!("{} terminou ou está esperando você.", s.tool.display()),
            });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{LimitSource, SessionInfo, SessionKind, ToolUsage};

    fn lim(pct: f64, resets: i64) -> Limit {
        Limit {
            used_percent: pct,
            resets_at: Some(resets),
            window_minutes: 300,
            source: LimitSource::Log,
            read_at: 0,
            renewed: false,
            projected_exhaust_at: None,
        }
    }

    fn snap(codex5: Option<Limit>) -> Snapshot {
        let mut s = Snapshot::empty();
        s.updated_at = 1000;
        s.codex = ToolUsage { five_hour: codex5, ..ToolUsage::empty(Tool::Codex) };
        s
    }

    fn session(id: &str, status: SessionStatus) -> SessionInfo {
        SessionInfo {
            id: id.into(),
            tool: Tool::Claude,
            kind: SessionKind::Main,
            agent_type: None,
            label: id.into(),
            status,
            last_activity: 0,
            tokens: 0,
        }
    }

    #[test]
    fn first_snapshot_never_alerts_but_arms_thresholds() {
        let mut st = AlertState::default();
        let first = snap(Some(lim(90.0, 5000)));
        assert!(evaluate(None, &first, &mut st).is_empty());
        // continua em 90%: sem aviso repetido
        let again = snap(Some(lim(91.0, 5000)));
        assert!(evaluate(Some(&first), &again, &mut st).is_empty());
    }

    #[test]
    fn crossing_80_then_95_alerts_once_each() {
        let mut st = AlertState::default();
        let a = snap(Some(lim(50.0, 5000)));
        evaluate(None, &a, &mut st);
        let b = snap(Some(lim(81.0, 5000)));
        let ev = evaluate(Some(&a), &b, &mut st);
        assert_eq!(ev.len(), 1);
        assert_eq!(ev[0].kind, "threshold80");
        assert!(ev[0].title.contains("Codex") && ev[0].title.contains("80%"));
        // repetir não avisa de novo
        assert!(evaluate(Some(&b), &snap(Some(lim(84.0, 5000))), &mut st).is_empty());
        let c = snap(Some(lim(96.0, 5000)));
        let ev = evaluate(Some(&b), &c, &mut st);
        assert_eq!(ev.len(), 1);
        assert_eq!(ev[0].kind, "threshold95");
        assert!(evaluate(Some(&c), &snap(Some(lim(97.0, 5000))), &mut st).is_empty());
    }

    #[test]
    fn jumping_straight_to_95_sends_a_single_alert() {
        let mut st = AlertState::default();
        let a = snap(Some(lim(10.0, 5000)));
        evaluate(None, &a, &mut st);
        let ev = evaluate(Some(&a), &snap(Some(lim(97.0, 5000))), &mut st);
        assert_eq!(ev.len(), 1);
        assert_eq!(ev[0].kind, "threshold95");
    }

    #[test]
    fn new_window_rearms_thresholds_and_alerts_reset() {
        let mut st = AlertState::default();
        let a = snap(Some(lim(85.0, 5000)));
        evaluate(None, &a, &mut st);
        // nova janela com o mesmo uso baixo: avisa o reset
        let b = snap(Some(lim(3.0, 23_000)));
        let ev = evaluate(Some(&a), &b, &mut st);
        assert_eq!(ev.iter().filter(|e| e.kind == "reset").count(), 1);
        // e volta a avisar 80% na nova janela
        let c = snap(Some(lim(82.0, 23_000)));
        let ev = evaluate(Some(&b), &c, &mut st);
        assert!(ev.iter().any(|e| e.kind == "threshold80"));
    }

    #[test]
    fn renewed_flag_alerts_reset_once() {
        let mut st = AlertState::default();
        let a = snap(Some(lim(60.0, 900)));
        evaluate(None, &a, &mut st);
        let mut renewed = lim(0.0, 900);
        renewed.renewed = true;
        renewed.resets_at = None;
        let b = snap(Some(renewed));
        assert_eq!(evaluate(Some(&a), &b, &mut st).iter().filter(|e| e.kind == "reset").count(), 1);
        assert!(evaluate(Some(&b), &b, &mut st).is_empty());
    }

    #[test]
    fn agent_stopping_alerts_once() {
        let mut st = AlertState::default();
        let mut a = Snapshot::empty();
        a.updated_at = 1000;
        a.sessions = vec![session("s1", SessionStatus::Working), session("s2", SessionStatus::Working)];
        let mut b = a.clone();
        b.sessions = vec![session("s1", SessionStatus::Waiting), session("s2", SessionStatus::Working)];
        let ev = evaluate(Some(&a), &b, &mut st);
        assert_eq!(ev.len(), 1);
        assert_eq!(ev[0].kind, "agentDone");
        assert!(ev[0].title.contains("s1"));
        assert!(evaluate(Some(&b), &b, &mut st).is_empty());
        // sessão que sumiu também conta
        let mut c = b.clone();
        c.sessions.clear();
        assert_eq!(evaluate(Some(&b), &c, &mut st).len(), 1);
    }

    #[test]
    fn duration_format() {
        assert_eq!(fmt_duration(20), "1 min");
        assert_eq!(fmt_duration(3600 + 20 * 60), "1 h 20 min");
        assert_eq!(fmt_duration(2 * 86400 + 3 * 3600), "2 d 3 h");
    }
}
