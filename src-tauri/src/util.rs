//! Utilidades pequenas: tempo e leitura incremental de arquivos JSONL.
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

pub fn now_secs() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

pub fn file_mtime_secs(path: &Path) -> Option<i64> {
    let m = std::fs::metadata(path).ok()?.modified().ok()?;
    m.duration_since(UNIX_EPOCH).ok().map(|d| d.as_secs() as i64)
}

fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

/// Converte "2026-11-13T00:46:08.451Z" (ou com offset ±HH:MM) em epoch segundos.
pub fn parse_iso8601(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    if b.len() < 19 || b[4] != b'-' || b[7] != b'-' || (b[10] != b'T' && b[10] != b' ') {
        return None;
    }
    let num = |a: usize, z: usize| s.get(a..z)?.parse::<i64>().ok();
    let (y, mo, d, h, mi, se) = (num(0, 4)?, num(5, 7)?, num(8, 10)?, num(11, 13)?, num(14, 16)?, num(17, 19)?);
    if !(1..=12).contains(&mo) || !(1..=31).contains(&d) || h > 23 || mi > 59 || se > 60 {
        return None;
    }
    let mut rest = &s[19..];
    if let Some(r) = rest.strip_prefix('.') {
        let digits = r.chars().take_while(|c| c.is_ascii_digit()).count();
        rest = &r[digits..];
    }
    let offset = match rest {
        "" | "Z" | "z" => 0,
        _ if rest.len() >= 6 && (rest.starts_with('+') || rest.starts_with('-')) => {
            let sign = if rest.starts_with('-') { -1 } else { 1 };
            let oh: i64 = rest.get(1..3)?.parse().ok()?;
            let om: i64 = rest.get(4..6)?.parse().ok()?;
            sign * (oh * 3600 + om * 60)
        }
        _ => return None,
    };
    Some(days_from_civil(y, mo, d) * 86400 + h * 3600 + mi * 60 + se - offset)
}

/// Posição de leitura de um arquivo JSONL: só avança por linhas completas.
#[derive(Debug, Default, Clone)]
pub struct TailState {
    pub offset: u64,
}

/// Lê as linhas completas novas desde `state.offset`. Linha parcial no fim é deixada para a próxima leitura.
/// Se o arquivo encolheu (rotação/truncamento) recomeça do zero. Retorna quantas linhas leu.
pub fn read_new_lines(path: &Path, state: &mut TailState, mut on_line: impl FnMut(&str)) -> std::io::Result<usize> {
    let file = File::open(path)?;
    let len = file.metadata()?.len();
    if len < state.offset {
        state.offset = 0;
    }
    if len == state.offset {
        return Ok(0);
    }
    let mut reader = BufReader::with_capacity(256 * 1024, file);
    reader.seek(SeekFrom::Start(state.offset))?;
    let mut buf = Vec::new();
    let mut count = 0;
    loop {
        buf.clear();
        let n = reader.read_until(b'\n', &mut buf)?;
        if n == 0 || buf.last() != Some(&b'\n') {
            break; // fim do arquivo ou linha ainda incompleta
        }
        state.offset += n as u64;
        let line = String::from_utf8_lossy(&buf);
        let line = line.trim_end_matches(['\n', '\r']);
        if !line.is_empty() {
            on_line(line);
            count += 1;
        }
    }
    Ok(count)
}

/// Primeira linha do arquivo (limitada a `max` bytes) para ler metadados da sessão.
pub fn first_line(path: &Path, max: usize) -> Option<String> {
    let file = File::open(path).ok()?;
    let mut reader = BufReader::new(file.take(max as u64));
    let mut s = String::new();
    reader.read_line(&mut s).ok()?;
    (!s.is_empty()).then_some(s)
}

#[cfg(test)]
pub fn format_iso8601(ts: i64) -> String {
    let days = ts.div_euclid(86400);
    let secs = ts.rem_euclid(86400);
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", secs / 3600, (secs % 3600) / 60, secs % 60)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn tmp(name: &str) -> std::path::PathBuf {
        let p = std::env::temp_dir().join(format!("token-pets-test-{}-{name}", std::process::id()));
        let _ = std::fs::remove_file(&p);
        p
    }

    #[test]
    fn iso_parsing() {
        assert_eq!(parse_iso8601("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_iso8601("2000-01-01T00:00:00Z"), Some(946_684_800));
        assert_eq!(parse_iso8601("2024-02-29T12:00:00+02:00"), Some(1_709_200_800));
        assert_eq!(parse_iso8601("2024-02-29T10:00:00.123456Z"), Some(1_709_200_800));
        assert_eq!(parse_iso8601("2024-02-29T07:00:00-03:00"), Some(1_709_200_800));
        assert_eq!(parse_iso8601("lixo"), None);
        assert_eq!(parse_iso8601("2024-13-01T00:00:00Z"), None);
    }

    #[test]
    fn iso_format_roundtrip() {
        for ts in [0, 946_684_800, 1_709_200_800, 1_794_543_035] {
            assert_eq!(parse_iso8601(&format_iso8601(ts)), Some(ts));
        }
    }

    #[test]
    fn tail_reads_incrementally_and_keeps_partial_line() {
        let p = tmp("tail");
        let mut f = std::fs::File::create(&p).unwrap();
        write!(f, "a\nb\npar").unwrap();
        f.flush().unwrap();
        let mut st = TailState::default();
        let mut got = vec![];
        assert_eq!(read_new_lines(&p, &mut st, |l| got.push(l.to_string())).unwrap(), 2);
        assert_eq!(got, ["a", "b"]);
        // a linha parcial é completada depois
        write!(f, "cial\nc\n").unwrap();
        f.flush().unwrap();
        got.clear();
        read_new_lines(&p, &mut st, |l| got.push(l.to_string())).unwrap();
        assert_eq!(got, ["parcial", "c"]);
        // nada novo
        assert_eq!(read_new_lines(&p, &mut st, |_| {}).unwrap(), 0);
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn tail_restarts_when_file_is_truncated() {
        let p = tmp("trunc");
        std::fs::write(&p, "um\ndois\ntres\n").unwrap();
        let mut st = TailState::default();
        read_new_lines(&p, &mut st, |_| {}).unwrap();
        std::fs::write(&p, "x\n").unwrap();
        let mut got = vec![];
        read_new_lines(&p, &mut st, |l| got.push(l.to_string())).unwrap();
        assert_eq!(got, ["x"]);
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn tail_missing_file_is_an_error_not_a_panic() {
        let mut st = TailState::default();
        assert!(read_new_lines(Path::new("Z:/nao/existe.jsonl"), &mut st, |_| {}).is_err());
    }

    #[test]
    fn first_line_is_limited() {
        let p = tmp("first");
        std::fs::write(&p, "primeira\nsegunda\n").unwrap();
        assert_eq!(first_line(&p, 1024).unwrap().trim(), "primeira");
        let _ = std::fs::remove_file(&p);
    }
}
