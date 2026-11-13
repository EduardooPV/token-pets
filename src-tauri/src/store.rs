//! Armazenamento local em SQLite: configurações (kv) e, nas próximas issues, histórico.
use crate::model::{HistoryPoint, Tool};
use rusqlite::{params, Connection};
use std::path::PathBuf;
use std::sync::Mutex;

pub struct Store {
    conn: Mutex<Connection>,
}

pub fn data_dir() -> PathBuf {
    let dir = dirs::data_local_dir().unwrap_or_else(std::env::temp_dir).join("token-pets");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

impl Store {
    pub fn open() -> rusqlite::Result<Self> {
        Self::from_connection(Connection::open(data_dir().join("token-pets.db"))?)
    }

    pub fn in_memory() -> rusqlite::Result<Self> {
        Self::from_connection(Connection::open_in_memory()?)
    }

    fn from_connection(conn: Connection) -> rusqlite::Result<Self> {
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS samples (ts INTEGER NOT NULL, tool TEXT NOT NULL, win TEXT NOT NULL, pct REAL NOT NULL);
             CREATE INDEX IF NOT EXISTS samples_ts ON samples(ts);
             CREATE UNIQUE INDEX IF NOT EXISTS samples_uq ON samples(ts,tool,win);
             CREATE TABLE IF NOT EXISTS claude_minutes (minute INTEGER PRIMARY KEY, weighted REAL NOT NULL, tokens INTEGER NOT NULL);
             CREATE TABLE IF NOT EXISTS file_offsets (path TEXT PRIMARY KEY, offset INTEGER NOT NULL);",
        )?;
        Ok(Self { conn: Mutex::new(conn) })
    }

    pub fn get(&self, key: &str) -> Option<String> {
        let conn = self.conn.lock().ok()?;
        conn.query_row("SELECT value FROM kv WHERE key=?1", params![key], |r| r.get(0)).ok()
    }

    pub fn set(&self, key: &str, value: &str) {
        if let Ok(conn) = self.conn.lock() {
            let _ = conn.execute(
                "INSERT INTO kv(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                params![key, value],
            );
        }
    }

    pub fn get_bool(&self, key: &str, default: bool) -> bool {
        self.get(key).map(|v| v == "1").unwrap_or(default)
    }

    pub fn set_bool(&self, key: &str, value: bool) {
        self.set(key, if value { "1" } else { "0" });
    }

    // ---- histórico de uso (gráfico de 7 dias e projeção) ----

    pub fn add_sample(&self, ts: i64, tool: Tool, win: &str, pct: f64) {
        if let Ok(conn) = self.conn.lock() {
            let _ = conn.execute("INSERT OR IGNORE INTO samples(ts,tool,win,pct) VALUES(?1,?2,?3,?4)", params![ts, tool.as_str(), win, pct]);
        }
    }

    pub fn samples_since(&self, tool: Tool, win: &str, since: i64) -> Vec<(i64, f64)> {
        let Ok(conn) = self.conn.lock() else { return vec![] };
        let Ok(mut st) = conn.prepare("SELECT ts,pct FROM samples WHERE tool=?1 AND win=?2 AND ts>=?3 ORDER BY ts") else {
            return vec![];
        };
        st.query_map(params![tool.as_str(), win, since], |r| Ok((r.get(0)?, r.get(1)?)))
            .map(|rows| rows.flatten().collect())
            .unwrap_or_default()
    }

    pub fn history(&self, since: i64) -> Vec<HistoryPoint> {
        let Ok(conn) = self.conn.lock() else { return vec![] };
        let Ok(mut st) = conn.prepare("SELECT ts,tool,win,pct FROM samples WHERE ts>=?1 ORDER BY ts") else { return vec![] };
        st.query_map(params![since], |r| {
            let tool: String = r.get(1)?;
            Ok(HistoryPoint {
                ts: r.get(0)?,
                tool: if tool == "codex" { Tool::Codex } else { Tool::Claude },
                window: r.get(2)?,
                pct: r.get(3)?,
            })
        })
        .map(|rows| rows.flatten().collect())
        .unwrap_or_default()
    }

    pub fn prune_samples(&self, before: i64) {
        if let Ok(conn) = self.conn.lock() {
            let _ = conn.execute("DELETE FROM samples WHERE ts<?1", params![before]);
        }
    }

    // ---- tokens locais do Claude por minuto + posição de leitura dos arquivos ----

    pub fn load_minutes(&self, since_minute: i64) -> Vec<(i64, f64, u64)> {
        let Ok(conn) = self.conn.lock() else { return vec![] };
        let Ok(mut st) = conn.prepare("SELECT minute,weighted,tokens FROM claude_minutes WHERE minute>=?1") else { return vec![] };
        st.query_map(params![since_minute], |r| Ok((r.get(0)?, r.get(1)?, r.get::<_, i64>(2)? as u64)))
            .map(|rows| rows.flatten().collect())
            .unwrap_or_default()
    }

    pub fn save_minutes(&self, rows: &[(i64, f64, u64)]) {
        let Ok(mut conn) = self.conn.lock() else { return };
        let Ok(tx) = conn.transaction() else { return };
        for (m, w, t) in rows {
            let _ = tx.execute(
                "INSERT INTO claude_minutes(minute,weighted,tokens) VALUES(?1,?2,?3)
                 ON CONFLICT(minute) DO UPDATE SET weighted=excluded.weighted, tokens=excluded.tokens",
                params![m, w, *t as i64],
            );
        }
        let _ = tx.commit();
    }

    pub fn prune_minutes(&self, before_minute: i64) {
        if let Ok(conn) = self.conn.lock() {
            let _ = conn.execute("DELETE FROM claude_minutes WHERE minute<?1", params![before_minute]);
        }
    }

    pub fn load_offsets(&self) -> Vec<(String, u64)> {
        let Ok(conn) = self.conn.lock() else { return vec![] };
        let Ok(mut st) = conn.prepare("SELECT path,offset FROM file_offsets") else { return vec![] };
        st.query_map([], |r| Ok((r.get(0)?, r.get::<_, i64>(1)? as u64)))
            .map(|rows| rows.flatten().collect())
            .unwrap_or_default()
    }

    pub fn save_offsets(&self, rows: &[(String, u64)]) {
        let Ok(mut conn) = self.conn.lock() else { return };
        let Ok(tx) = conn.transaction() else { return };
        for (p, o) in rows {
            let _ = tx.execute(
                "INSERT INTO file_offsets(path,offset) VALUES(?1,?2) ON CONFLICT(path) DO UPDATE SET offset=excluded.offset",
                params![p, *o as i64],
            );
        }
        let _ = tx.commit();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kv_roundtrip_and_defaults() {
        let s = Store::in_memory().unwrap();
        assert_eq!(s.get("x"), None);
        assert!(s.get_bool("pet", true));
        s.set_bool("pet", false);
        assert!(!s.get_bool("pet", true));
        s.set("x", "1");
        s.set("x", "2");
        assert_eq!(s.get("x").as_deref(), Some("2"));
    }

    #[test]
    fn samples_history_and_prune() {
        let s = Store::in_memory().unwrap();
        s.add_sample(100, Tool::Codex, "5h", 10.0);
        s.add_sample(200, Tool::Codex, "5h", 20.0);
        s.add_sample(200, Tool::Claude, "7d", 5.0);
        assert_eq!(s.samples_since(Tool::Codex, "5h", 150), vec![(200, 20.0)]);
        assert_eq!(s.history(0).len(), 3);
        s.prune_samples(150);
        assert_eq!(s.history(0).len(), 2);
    }

    #[test]
    fn minutes_and_offsets_persist_and_upsert() {
        let s = Store::in_memory().unwrap();
        s.save_minutes(&[(10, 1.5, 3), (11, 2.0, 4)]);
        s.save_minutes(&[(10, 9.0, 9)]);
        let mut rows = s.load_minutes(0);
        rows.sort_by_key(|r| r.0);
        assert_eq!(rows, vec![(10, 9.0, 9), (11, 2.0, 4)]);
        s.prune_minutes(11);
        assert_eq!(s.load_minutes(0).len(), 1);
        s.save_offsets(&[("a.jsonl".into(), 10)]);
        s.save_offsets(&[("a.jsonl".into(), 20)]);
        assert_eq!(s.load_offsets(), vec![("a.jsonl".to_string(), 20)]);
    }
}
