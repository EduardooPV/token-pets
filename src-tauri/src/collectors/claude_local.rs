//! Coletor local do Claude: tokens dos transcripts em ~/.claude/projects (estimativa) e classificação de arquivos.
use crate::util::parse_iso8601;
use serde::Deserialize;
use std::path::{Component, Path};

#[derive(Debug, Clone, PartialEq)]
pub struct UsageLine {
    pub message_id: String,
    pub ts: i64,
    /// tokens ponderados por custo relativo (ver `weigh`)
    pub weighted: f64,
    /// soma bruta de tokens (entrada + saída + cache)
    pub tokens: u64,
    pub cwd: Option<String>,
}

#[derive(Deserialize)]
struct Line {
    #[serde(rename = "type")]
    kind: Option<String>,
    timestamp: Option<String>,
    cwd: Option<String>,
    message: Option<Message>,
    #[serde(rename = "customTitle")]
    custom_title: Option<String>,
}

#[derive(Deserialize)]
struct Message {
    id: Option<String>,
    usage: Option<Usage>,
}

#[derive(Deserialize, Default)]
struct Usage {
    #[serde(default)]
    input_tokens: u64,
    #[serde(default)]
    output_tokens: u64,
    #[serde(default)]
    cache_creation_input_tokens: u64,
    #[serde(default)]
    cache_read_input_tokens: u64,
}

/// Custo relativo aproximado (entrada = 1): saída 5x, escrita de cache 1,25x, leitura de cache 0,1x.
pub fn weigh(input: u64, output: u64, cache_write: u64, cache_read: u64) -> f64 {
    input as f64 + 5.0 * output as f64 + 1.25 * cache_write as f64 + 0.1 * cache_read as f64
}

#[derive(Debug, Clone, PartialEq)]
pub enum ParsedLine {
    Usage(UsageLine),
    Title(String),
}

pub fn parse_line(line: &str) -> Option<ParsedLine> {
    let wants_usage = line.contains("\"usage\"");
    let wants_title = line.contains("\"custom-title\"");
    if !wants_usage && !wants_title {
        return None;
    }
    let l: Line = serde_json::from_str(line).ok()?;
    match l.kind.as_deref() {
        Some("custom-title") => l.custom_title.filter(|t| !t.trim().is_empty()).map(ParsedLine::Title),
        Some("assistant") => {
            let m = l.message?;
            let u = m.usage?;
            let ts = l.timestamp.as_deref().and_then(parse_iso8601)?;
            let tokens = u.input_tokens + u.output_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens;
            Some(ParsedLine::Usage(UsageLine {
                message_id: m.id?,
                ts,
                weighted: weigh(u.input_tokens, u.output_tokens, u.cache_creation_input_tokens, u.cache_read_input_tokens),
                tokens,
                cwd: l.cwd,
            }))
        }
        _ => None,
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum FileKind {
    Main { session_id: String },
    Subagent { session_id: String, agent_id: String },
}

/// Classifica um .jsonl dentro de ~/.claude/projects:
/// `<proj>/<sessao>.jsonl` (principal) ou `<proj>/<sessao>/subagents/agent-<id>.jsonl` (subagente).
pub fn classify_path(path: &Path, root: &Path) -> Option<FileKind> {
    if path.extension()?.to_str()? != "jsonl" {
        return None;
    }
    let rel = path.strip_prefix(root).ok()?;
    let parts: Vec<&str> = rel
        .components()
        .filter_map(|c| match c {
            Component::Normal(s) => s.to_str(),
            _ => None,
        })
        .collect();
    let stem = |s: &str| s.trim_end_matches(".jsonl").to_string();
    match parts.as_slice() {
        [_proj, file] => Some(FileKind::Main { session_id: stem(file) }),
        [_proj, session, "subagents", file] if file.starts_with("agent-") => {
            Some(FileKind::Subagent { session_id: (*session).to_string(), agent_id: stem(file).trim_start_matches("agent-").to_string() })
        }
        _ => None,
    }
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct AgentMeta {
    pub agent_type: Option<String>,
    pub description: Option<String>,
    pub finished: bool,
}

pub fn parse_agent_meta(json: &str) -> AgentMeta {
    let v: serde_json::Value = serde_json::from_str(json).unwrap_or_default();
    AgentMeta {
        agent_type: v.get("agentType").and_then(|x| x.as_str()).map(String::from),
        description: v.get("description").and_then(|x| x.as_str()).map(String::from),
        finished: v.get("finished").and_then(|x| x.as_bool()).unwrap_or(false),
    }
}

pub fn label_from_cwd(cwd: Option<&str>) -> Option<String> {
    cwd.and_then(|c| c.rsplit(['\\', '/']).find(|s| !s.is_empty())).map(String::from)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    const ASSISTANT: &str = r#"{"type":"assistant","timestamp":"2026-11-13T00:46:08.451Z","cwd":"C:\\Users\\Eduar\\Documents\\projects\\diagnos","sessionId":"s1","message":{"id":"msg_1","model":"claude-opus-5-5","role":"assistant","content":[{"type":"text","text":"oi"}],"usage":{"input_tokens":2,"cache_creation_input_tokens":2354,"cache_read_input_tokens":98945,"output_tokens":632,"service_tier":"standard"}}}"#;

    #[test]
    fn parses_assistant_usage() {
        let Some(ParsedLine::Usage(u)) = parse_line(ASSISTANT) else { panic!("esperava Usage") };
        assert_eq!(u.message_id, "msg_1");
        assert_eq!(u.tokens, 2 + 2354 + 98945 + 632);
        assert!((u.weighted - (2.0 + 5.0 * 632.0 + 1.25 * 2354.0 + 0.1 * 98945.0)).abs() < 1e-6);
        assert_eq!(label_from_cwd(u.cwd.as_deref()).as_deref(), Some("diagnos"));
    }

    #[test]
    fn parses_custom_title_and_ignores_the_rest() {
        let t = r#"{"type":"custom-title","customTitle":"Token usage monitoring app","sessionId":"s1"}"#;
        assert_eq!(parse_line(t), Some(ParsedLine::Title("Token usage monitoring app".into())));
        assert!(parse_line(r#"{"type":"custom-title","customTitle":"  "}"#).is_none());
        assert!(parse_line(r#"{"type":"user","message":{"role":"user","content":"oi"}}"#).is_none());
        assert!(parse_line("{quebrado \"usage\"").is_none());
        // assistant sem usage
        assert!(parse_line(r#"{"type":"assistant","timestamp":"2026-11-13T00:46:08Z","message":{"id":"m","usage":null}}"#).is_none());
    }

    #[test]
    fn classifies_main_and_subagent_files() {
        let root = PathBuf::from("C:/u/.claude/projects");
        assert_eq!(
            classify_path(&root.join("proj").join("abc.jsonl"), &root),
            Some(FileKind::Main { session_id: "abc".into() })
        );
        assert_eq!(
            classify_path(&root.join("proj").join("abc").join("subagents").join("agent-a33f.jsonl"), &root),
            Some(FileKind::Subagent { session_id: "abc".into(), agent_id: "a33f".into() })
        );
        assert_eq!(classify_path(&root.join("proj").join("abc").join("custom-title.json"), &root), None);
        assert_eq!(classify_path(&root.join("proj").join("abc").join("outro").join("x.jsonl"), &root), None);
        assert_eq!(classify_path(&PathBuf::from("D:/fora/x.jsonl"), &root), None);
    }

    #[test]
    fn parses_agent_meta() {
        let m = parse_agent_meta(r#"{"agentType":"security-probe","description":"Security probe","finished":true}"#);
        assert_eq!(m.agent_type.as_deref(), Some("security-probe"));
        assert!(m.finished);
        assert_eq!(parse_agent_meta("lixo"), AgentMeta::default());
    }
}
