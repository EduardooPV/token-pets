//! % exato do plano Claude via endpoint de uso da conta (o mesmo dado do `/usage`).
//!
//! Regras de segurança: o token é lido do disco só para esta chamada, nunca é renovado, gravado, exibido ou
//! registrado em log, e só é enviado para api.anthropic.com. Mensagens de erro nunca incluem o token.
use crate::util::parse_iso8601;
use std::path::PathBuf;
use std::time::Duration;

const USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";

#[derive(Debug, Clone, PartialEq)]
pub struct ApiWindow {
    pub utilization: f64,
    pub resets_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct ApiUsage {
    pub five_hour: Option<ApiWindow>,
    pub seven_day: Option<ApiWindow>,
}

fn window(v: Option<&serde_json::Value>) -> Option<ApiWindow> {
    let v = v?;
    let utilization = v.get("utilization")?.as_f64()?;
    let resets_at = v.get("resets_at").and_then(|r| r.as_str()).and_then(parse_iso8601);
    Some(ApiWindow { utilization: utilization.clamp(0.0, 100.0), resets_at })
}

pub fn parse_usage(v: &serde_json::Value) -> Option<ApiUsage> {
    let u = ApiUsage { five_hour: window(v.get("five_hour")), seven_day: window(v.get("seven_day")) };
    (u.five_hour.is_some() || u.seven_day.is_some()).then_some(u)
}

fn credentials_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".claude").join(".credentials.json"))
}

/// Extrai o token de acesso e valida a expiração (`expiresAt` em ms). Não renova.
pub fn token_from_credentials(json: &str, now_secs: i64) -> Result<String, String> {
    let v: serde_json::Value = serde_json::from_str(json).map_err(|_| "credenciais ilegíveis".to_string())?;
    let oauth = v.get("claudeAiOauth").ok_or_else(|| "sem login do Claude Code".to_string())?;
    let token = oauth.get("accessToken").and_then(|t| t.as_str()).filter(|t| !t.is_empty());
    let token = token.ok_or_else(|| "sem login do Claude Code".to_string())?;
    if let Some(exp_ms) = oauth.get("expiresAt").and_then(|e| e.as_i64()) {
        if exp_ms / 1000 <= now_secs {
            return Err("login expirado (abra o Claude Code)".into());
        }
    }
    Ok(token.to_string())
}

pub fn fetch(now_secs: i64) -> Result<ApiUsage, String> {
    let path = credentials_path().ok_or_else(|| "sem pasta do usuário".to_string())?;
    let raw = std::fs::read_to_string(path).map_err(|_| "credenciais do Claude Code não encontradas".to_string())?;
    let token = token_from_credentials(&raw, now_secs)?;
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(10)))
        .http_status_as_error(false)
        .build()
        .into();
    let mut resp = agent
        .get(USAGE_URL)
        .header("Authorization", &format!("Bearer {token}"))
        .header("anthropic-beta", "oauth-2025-04-20")
        .header("User-Agent", "token-pets/0.1")
        .call()
        .map_err(|_| "sem conexão com a Anthropic".to_string())?;
    let status = resp.status().as_u16();
    if status == 401 || status == 403 {
        return Err("login recusado (abra o Claude Code)".into());
    }
    if status != 200 {
        return Err(format!("endpoint de uso respondeu {status}"));
    }
    let body: serde_json::Value = resp.body_mut().read_json().map_err(|_| "resposta inesperada".to_string())?;
    parse_usage(&body).ok_or_else(|| "formato de resposta mudou".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_usage_response() {
        let v: serde_json::Value = serde_json::from_str(
            r#"{"five_hour":{"utilization":37.0,"resets_at":"2026-11-13T03:00:00.123456+00:00"},"seven_day":{"utilization":26.5,"resets_at":"2026-11-18T10:00:00Z"},"seven_day_opus":null}"#,
        )
        .unwrap();
        let u = parse_usage(&v).unwrap();
        assert_eq!(u.five_hour.as_ref().unwrap().utilization, 37.0);
        assert_eq!(u.five_hour.unwrap().resets_at, parse_iso8601("2026-11-13T03:00:00Z"));
        assert_eq!(u.seven_day.unwrap().utilization, 26.5);
    }

    #[test]
    fn tolerates_missing_windows_and_rejects_unknown_shape() {
        let v: serde_json::Value = serde_json::from_str(r#"{"five_hour":{"utilization":10}}"#).unwrap();
        let u = parse_usage(&v).unwrap();
        assert!(u.five_hour.is_some() && u.seven_day.is_none());
        assert!(u.five_hour.unwrap().resets_at.is_none());
        let bad: serde_json::Value = serde_json::from_str(r#"{"algo":"novo"}"#).unwrap();
        assert!(parse_usage(&bad).is_none());
    }

    #[test]
    fn clamps_out_of_range_utilization() {
        let v: serde_json::Value = serde_json::from_str(r#"{"five_hour":{"utilization":140}}"#).unwrap();
        assert_eq!(parse_usage(&v).unwrap().five_hour.unwrap().utilization, 100.0);
    }

    #[test]
    fn token_extraction_checks_expiry_and_never_echoes_it() {
        let ok = r#"{"claudeAiOauth":{"accessToken":"SEGREDO","expiresAt":4102444800000}}"#;
        assert_eq!(token_from_credentials(ok, 1_000).unwrap(), "SEGREDO");
        let expired = r#"{"claudeAiOauth":{"accessToken":"SEGREDO","expiresAt":1000}}"#;
        let err = token_from_credentials(expired, 5_000).unwrap_err();
        assert!(err.contains("expirado") && !err.contains("SEGREDO"));
        for bad in ["{}", "lixo", r#"{"claudeAiOauth":{"accessToken":""}}"#] {
            let e = token_from_credentials(bad, 0).unwrap_err();
            assert!(!e.contains("SEGREDO"));
        }
    }
}
