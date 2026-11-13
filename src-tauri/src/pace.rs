//! Projeção de quando um limite esgota, por regressão linear das amostras recentes.

/// `samples`: (epoch s, % usado), em qualquer ordem. Só usa amostras de dentro da janela atual
/// (a partir de `window_start`) e dos últimos `lookback_secs`. Devolve o epoch previsto para 100%.
pub fn project_exhaustion(
    samples: &[(i64, f64)],
    now: i64,
    window_start: i64,
    lookback_secs: i64,
    current_pct: f64,
) -> Option<i64> {
    if current_pct >= 100.0 {
        return Some(now);
    }
    let from = window_start.max(now - lookback_secs);
    let mut pts: Vec<(f64, f64)> = samples.iter().filter(|(t, _)| *t >= from && *t <= now).map(|&(t, p)| (t as f64, p)).collect();
    pts.sort_by(|a, b| a.0.total_cmp(&b.0));
    if pts.len() < 3 {
        return None;
    }
    let span = pts.last()?.0 - pts.first()?.0;
    if span < 300.0 {
        return None; // menos de 5 min de histórico: não dá para estimar ritmo
    }
    let n = pts.len() as f64;
    let mean_t = pts.iter().map(|p| p.0).sum::<f64>() / n;
    let mean_p = pts.iter().map(|p| p.1).sum::<f64>() / n;
    let sxx: f64 = pts.iter().map(|p| (p.0 - mean_t).powi(2)).sum();
    if sxx == 0.0 {
        return None;
    }
    let slope = pts.iter().map(|p| (p.0 - mean_t) * (p.1 - mean_p)).sum::<f64>() / sxx; // % por segundo
    if slope <= 1e-7 {
        return None; // estável ou caindo
    }
    let remaining = (100.0 - current_pct) / slope;
    if !remaining.is_finite() || remaining > 30.0 * 86400.0 {
        return None;
    }
    Some(now + remaining as i64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn steady_growth_projects_a_sensible_time() {
        // 10% por hora, partindo de 40% há 2 h: agora 60%, faltam 40% => ~4 h
        let now = 100_000;
        let samples: Vec<(i64, f64)> = (0..=8).map(|i| (now - 7200 + i * 900, 40.0 + i as f64 * 2.5)).collect();
        let t = project_exhaustion(&samples, now, now - 18_000, 3600 * 3, 60.0).unwrap();
        let hours = (t - now) as f64 / 3600.0;
        assert!((hours - 4.0).abs() < 0.1, "esperava ~4h, veio {hours}");
    }

    #[test]
    fn flat_or_falling_usage_never_exhausts() {
        let now = 100_000;
        let flat: Vec<(i64, f64)> = (0..6).map(|i| (now - 3000 + i * 600, 30.0)).collect();
        assert_eq!(project_exhaustion(&flat, now, 0, 7200, 30.0), None);
        let falling: Vec<(i64, f64)> = (0..6).map(|i| (now - 3000 + i * 600, 50.0 - i as f64)).collect();
        assert_eq!(project_exhaustion(&falling, now, 0, 7200, 45.0), None);
    }

    #[test]
    fn too_little_history_gives_no_projection() {
        let now = 100_000;
        assert_eq!(project_exhaustion(&[], now, 0, 7200, 10.0), None);
        assert_eq!(project_exhaustion(&[(now - 60, 10.0), (now, 12.0)], now, 0, 7200, 12.0), None);
        // três pontos em menos de 5 minutos
        assert_eq!(project_exhaustion(&[(now - 200, 10.0), (now - 100, 11.0), (now, 12.0)], now, 0, 7200, 12.0), None);
    }

    #[test]
    fn ignores_samples_from_before_the_window_reset() {
        let now = 100_000;
        // antes do reset (window_start) estava em 90%; depois recomeçou do zero devagar
        let mut samples = vec![(now - 5000, 90.0), (now - 4900, 95.0)];
        samples.extend((0..6).map(|i| (now - 3000 + i * 600, i as f64)));
        let t = project_exhaustion(&samples, now, now - 3100, 10_000, 5.0).unwrap();
        assert!(t > now + 3600 * 10, "projeção deve refletir só o ritmo novo");
    }

    #[test]
    fn already_full_returns_now() {
        assert_eq!(project_exhaustion(&[], 500, 0, 100, 100.0), Some(500));
    }
}
