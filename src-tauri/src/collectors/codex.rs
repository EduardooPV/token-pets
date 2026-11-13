//! Coletor do Codex: lê `token_count` + `rate_limits` dos rollouts em ~/.codex/sessions.
use crate::model::{Limit, LimitSource, Tool, ToolUsage};
use crate::util::parse_iso8601;
use serde::Deserialize;

#[derive(Debug, Clone, PartialEq)]
pub struct RawLimit {
    pub used_percent: f64,
    pub window_minutes: u32,
    pub resets_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct CodexSample {
    /// epoch (s) do evento no log
    pub ts: i64,
    pub primary: Option<RawLimit>,
    pub secondary: Option<RawLimit>,
    pub plan: Option<String>,
    pub total_tokens: Option<u64>,
}

#[derive(Deserialize)]
struct Line {
    timestamp: Option<String>,
    payload: Option<Payload>,
}

#[derive(Deserialize)]
struct Payload {
    #[serde(rename = "type")]
    kind: Option<String>,
    info: Option<Info>,
    rate_limits: Option<RateLimits>,
}

#[derive(Deserialize)]
struct Info {
    total_token_usage: Option<TotalUsage>,
}

#[derive(Deserialize)]
struct TotalUsage {
    total_tokens: Option<u64>,
}

#[derive(Deserialize)]
struct RateLimits {
    limit_id: Option<String>,
    primary: Option<RawWindow>,
    secondary: Option<RawWindow>,
    plan_type: Option<String>,
}

#[derive(Deserialize)]
struct RawWindow {
    used_percent: Option<f64>,
    window_minutes: Option<u32>,
    resets_at: Option<i64>,
}

fn raw(w: Option<RawWindow>) -> Option<RawLimit> {
    let w = w?;
    Some(RawLimit { used_percent: w.used_percent?, window_minutes: w.window_minutes.unwrap_or(0), resets_at: w.resets_at })
}

/// Interpreta uma linha do rollout. Só devolve algo para eventos `token_count` do limite principal do Codex.
pub fn parse_line(line: &str) -> Option<CodexSample> {
    if !line.contains("\"token_count\"") {
        return None;
    }
    let l: Line = serde_json::from_str(line).ok()?;
    let p = l.payload?;
    if p.kind.as_deref() != Some("token_count") {
        return None;
    }
    let total_tokens = p.info.and_then(|i| i.total_token_usage).and_then(|t| t.total_tokens);
    let (primary, secondary, plan) = match p.rate_limits {
        Some(rl) => {
            // limites por modelo têm outro limit_id; só o geral ("codex") representa o plano
            if rl.limit_id.as_deref().is_some_and(|id| id != "codex") {
                return None;
            }
            (raw(rl.primary), raw(rl.secondary), rl.plan_type)
        }
        None => (None, None, None),
    };
    let ts = l.timestamp.as_deref().and_then(parse_iso8601)?;
    Some(CodexSample { ts, primary, secondary, plan, total_tokens })
}

fn limit_from(raw: &RawLimit, sample_ts: i64, now: i64, default_window: u32) -> Limit {
    let renewed = raw.resets_at.is_some_and(|r| r <= now);
    Limit {
        used_percent: if renewed { 0.0 } else { raw.used_percent },
        resets_at: if renewed { None } else { raw.resets_at },
        window_minutes: if raw.window_minutes > 0 { raw.window_minutes } else { default_window },
        source: LimitSource::Log,
        read_at: sample_ts,
        renewed,
        projected_exhaust_at: None,
    }
}

/// Converte a amostra mais recente em uso. Janelas cujo reset já passou ficam zeradas e marcadas "renovado".
pub fn usage_from_sample(sample: Option<&CodexSample>, now: i64) -> ToolUsage {
    let mut u = ToolUsage::empty(Tool::Codex);
    if let Some(s) = sample {
        u.plan = s.plan.clone();
        u.five_hour = s.primary.as_ref().map(|r| limit_from(r, s.ts, now, 300));
        u.weekly = s.secondary.as_ref().map(|r| limit_from(r, s.ts, now, 10080));
    }
    u
}

/// Metadados da sessão (primeira linha do rollout).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct SessionMeta {
    pub id: Option<String>,
    pub cwd: Option<String>,
    pub is_subagent: bool,
}

pub fn parse_session_meta(first_line: &str) -> Option<SessionMeta> {
    let v: serde_json::Value = serde_json::from_str(first_line).ok()?;
    if v.get("type")?.as_str()? != "session_meta" {
        return None;
    }
    let p = v.get("payload")?;
    Some(SessionMeta {
        id: p.get("id").and_then(|x| x.as_str()).map(String::from),
        cwd: p.get("cwd").and_then(|x| x.as_str()).map(String::from),
        is_subagent: p.get("parent_thread_id").is_some_and(|x| !x.is_null()),
    })
}

pub fn label_from_cwd(cwd: Option<&str>) -> String {
    cwd.and_then(|c| c.rsplit(['\\', '/']).find(|s| !s.is_empty()))
        .map(String::from)
        .unwrap_or_else(|| "Codex".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    const LINE: &str = r#"{"timestamp":"2026-11-13T00:46:08.451Z","ordinal":319,"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":681984,"total_tokens":683830}},"rate_limits":{"limit_id":"codex","limit_name":null,"primary":{"used_percent":64.0,"window_minutes":300,"resets_at":1794543035},"secondary":{"used_percent":94.0,"window_minutes":10080,"resets_at":1794605565},"credits":null,"plan_type":"plus"}}}"#;

    #[test]
    fn parses_token_count_with_rate_limits() {
        let s = parse_line(LINE).unwrap();
        assert_eq!(s.plan.as_deref(), Some("plus"));
        assert_eq!(s.total_tokens, Some(683_830));
        let p = s.primary.unwrap();
        assert_eq!((p.used_percent, p.window_minutes, p.resets_at), (64.0, 300, Some(1_794_543_035)));
        assert_eq!(s.secondary.unwrap().used_percent, 94.0);
        assert!(s.ts > 1_700_000_000);
    }

    #[test]
    fn ignores_other_lines_and_garbage() {
        assert!(parse_line(r#"{"type":"event_msg","payload":{"type":"agent_message"}}"#).is_none());
        assert!(parse_line("não é json {token_count").is_none());
        assert!(parse_line("").is_none());
    }

    #[test]
    fn ignores_per_model_limit_ids() {
        let l = LINE.replace(r#""limit_id":"codex""#, r#""limit_id":"codex_bengalfox""#);
        assert!(parse_line(&l).is_none());
    }

    #[test]
    fn token_count_without_rate_limits_keeps_tokens_only() {
        let l = r#"{"timestamp":"2026-11-13T00:46:08Z","payload":{"type":"token_count","info":{"total_token_usage":{"total_tokens":10}}}}"#;
        let s = parse_line(l).unwrap();
        assert!(s.primary.is_none() && s.secondary.is_none());
        assert_eq!(s.total_tokens, Some(10));
    }

    #[test]
    fn usage_is_zeroed_and_flagged_after_reset_time() {
        let s = parse_line(LINE).unwrap();
        // antes do reset: valores do log
        let u = usage_from_sample(Some(&s), 1_794_540_000);
        let h5 = u.five_hour.unwrap();
        assert_eq!((h5.used_percent, h5.renewed, h5.source), (64.0, false, LimitSource::Log));
        assert_eq!(h5.read_at, s.ts);
        // 5h já renovou, semanal ainda não
        let u = usage_from_sample(Some(&s), 1_794_543_100);
        let h5 = u.five_hour.unwrap();
        assert!(h5.renewed && h5.used_percent == 0.0);
        let wk = u.weekly.unwrap();
        assert!(!wk.renewed && wk.used_percent == 94.0);
        assert_eq!(u.max_percent(), Some(94.0));
    }

    #[test]
    fn no_sample_means_no_limits() {
        let u = usage_from_sample(None, 0);
        assert!(u.five_hour.is_none() && u.weekly.is_none());
    }

    #[test]
    fn session_meta_and_label() {
        let l = r#"{"type":"session_meta","payload":{"id":"abc","cwd":"C:\\Users\\Eduar\\Documents\\projects\\app-diagnos","parent_thread_id":"zzz"}}"#;
        let m = parse_session_meta(l).unwrap();
        assert_eq!(m.id.as_deref(), Some("abc"));
        assert!(m.is_subagent);
        assert_eq!(label_from_cwd(m.cwd.as_deref()), "app-diagnos");
        assert_eq!(label_from_cwd(None), "Codex");
        assert!(parse_session_meta(r#"{"type":"event_msg"}"#).is_none());
    }
}
