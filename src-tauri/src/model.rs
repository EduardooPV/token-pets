//! Tipos compartilhados com o front-end (serde camelCase). Mantenha em sincronia com src/shared/types.ts.
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum Tool {
    Claude,
    Codex,
}

impl Tool {
    pub fn as_str(self) -> &'static str {
        match self {
            Tool::Claude => "claude",
            Tool::Codex => "codex",
        }
    }

    pub fn display(self) -> &'static str {
        match self {
            Tool::Claude => "Claude",
            Tool::Codex => "Codex",
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LimitSource {
    Exact,
    Estimated,
    Log,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Limit {
    pub used_percent: f64,
    pub resets_at: Option<i64>,
    pub window_minutes: u32,
    pub source: LimitSource,
    pub read_at: i64,
    pub renewed: bool,
    pub projected_exhaust_at: Option<i64>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolUsage {
    pub tool: Tool,
    pub plan: Option<String>,
    pub five_hour: Option<Limit>,
    pub weekly: Option<Limit>,
    pub calibrated: bool,
}

impl ToolUsage {
    pub fn empty(tool: Tool) -> Self {
        Self { tool, plan: None, five_hour: None, weekly: None, calibrated: false }
    }

    /// Maior % entre as janelas ainda válidas (ignora as renovadas).
    pub fn max_percent(&self) -> Option<f64> {
        [&self.five_hour, &self.weekly]
            .into_iter()
            .flatten()
            .filter(|l| !l.renewed)
            .map(|l| l.used_percent)
            .fold(None, |acc, p| Some(acc.map_or(p, |a: f64| a.max(p))))
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SessionStatus {
    Working,
    Waiting,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SessionKind {
    Main,
    Subagent,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: String,
    pub tool: Tool,
    pub kind: SessionKind,
    pub agent_type: Option<String>,
    pub label: String,
    pub status: SessionStatus,
    pub last_activity: i64,
    pub tokens: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub claude: ToolUsage,
    pub codex: ToolUsage,
    pub sessions: Vec<SessionInfo>,
    pub updated_at: i64,
    pub claude_exact_error: Option<String>,
}

impl Snapshot {
    pub fn empty() -> Self {
        Self {
            claude: ToolUsage::empty(Tool::Claude),
            codex: ToolUsage::empty(Tool::Codex),
            sessions: vec![],
            updated_at: 0,
            claude_exact_error: None,
        }
    }

    pub fn usage(&self, tool: Tool) -> &ToolUsage {
        match tool {
            Tool::Claude => &self.claude,
            Tool::Codex => &self.codex,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPoint {
    pub ts: i64,
    pub tool: Tool,
    pub window: String,
    pub pct: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub pet: bool,
    pub sounds: bool,
    pub claude_exact: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AlertEvent {
    pub kind: String,
    pub title: String,
    pub body: String,
}
