//! Ícone da bandeja desenhado em código: anel com o maior % de uso e um rostinho com humor.
//! Os ícones só são recriados quando o estado visível muda.

pub const SIZE: u32 = 32;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mood {
    Happy,
    Tired,
    Exhausted,
}

pub fn mood_for(pct: Option<f32>) -> Mood {
    match pct {
        Some(p) if p >= 95.0 => Mood::Exhausted,
        Some(p) if p >= 80.0 => Mood::Tired,
        _ => Mood::Happy,
    }
}

fn ring_color(pct: f32) -> [u8; 3] {
    if pct >= 95.0 {
        [229, 72, 77]
    } else if pct >= 80.0 {
        [245, 166, 35]
    } else {
        [70, 190, 120]
    }
}

fn put(buf: &mut [u8], x: i32, y: i32, c: [u8; 4]) {
    if x < 0 || y < 0 || x >= SIZE as i32 || y >= SIZE as i32 {
        return;
    }
    let i = ((y as u32 * SIZE + x as u32) * 4) as usize;
    buf[i..i + 4].copy_from_slice(&c);
}

/// Retorna RGBA SIZE×SIZE. `pct` None = sem dados (anel cinza).
pub fn render_icon(pct: Option<f32>) -> Vec<u8> {
    let mut buf = vec![0u8; (SIZE * SIZE * 4) as usize];
    let c = (SIZE as f32 - 1.0) / 2.0;
    let fraction = pct.map(|p| (p / 100.0).clamp(0.0, 1.0)).unwrap_or(0.0);
    let fill = pct.map(ring_color).unwrap_or([120, 120, 120]);
    for y in 0..SIZE as i32 {
        for x in 0..SIZE as i32 {
            let dx = x as f32 - c;
            let dy = y as f32 - c;
            let r = (dx * dx + dy * dy).sqrt();
            if (11.5..=15.5).contains(&r) {
                // ângulo a partir do topo, no sentido horário, em [0,1)
                let mut a = dx.atan2(-dy) / std::f32::consts::TAU;
                if a < 0.0 {
                    a += 1.0;
                }
                if a <= fraction {
                    put(&mut buf, x, y, [fill[0], fill[1], fill[2], 255]);
                } else {
                    put(&mut buf, x, y, [90, 90, 90, 150]);
                }
            } else if r < 10.0 {
                put(&mut buf, x, y, [217, 119, 87, 255]);
            }
        }
    }
    let mood = mood_for(pct);
    let eye = [38, 38, 38, 255];
    match mood {
        Mood::Exhausted => {
            for (ex, ey) in [(11, 12), (20, 12)] {
                for d in 0..3 {
                    put(&mut buf, ex + d, ey + d, eye);
                    put(&mut buf, ex + 2 - d, ey + d, eye);
                }
            }
        }
        _ => {
            for (ex, ey) in [(12, 13), (19, 13)] {
                for dy in 0..2 {
                    for dx in 0..2 {
                        put(&mut buf, ex + dx, ey + dy, eye);
                    }
                }
            }
        }
    }
    match mood {
        Mood::Happy => {
            for (x, y) in [(12, 19), (13, 20), (14, 20), (15, 20), (16, 20), (17, 20), (18, 20), (19, 19)] {
                put(&mut buf, x, y, eye);
            }
        }
        Mood::Tired => {
            for x in 13..=18 {
                put(&mut buf, x, 20, eye);
            }
        }
        Mood::Exhausted => {
            for (x, y) in [(12, 21), (13, 20), (14, 19), (15, 19), (16, 19), (17, 19), (18, 20), (19, 21)] {
                put(&mut buf, x, y, eye);
            }
        }
    }
    buf
}

pub fn tooltip(parts: &[(&str, Option<f32>, Option<f32>)]) -> String {
    let fmt = |v: Option<f32>| v.map(|p| format!("{:.0}%", p)).unwrap_or_else(|| "--".into());
    let lines: Vec<String> =
        parts.iter().map(|(name, h5, wk)| format!("{name}: 5h {} · sem {}", fmt(*h5), fmt(*wk))).collect();
    if lines.is_empty() {
        "Token Pets".into()
    } else {
        lines.join("\n")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn alpha_at(buf: &[u8], x: u32, y: u32) -> u8 {
        buf[((y * SIZE + x) * 4 + 3) as usize]
    }

    fn rgb_at(buf: &[u8], x: u32, y: u32) -> [u8; 3] {
        let i = ((y * SIZE + x) * 4) as usize;
        [buf[i], buf[i + 1], buf[i + 2]]
    }

    #[test]
    fn mood_thresholds() {
        assert_eq!(mood_for(None), Mood::Happy);
        assert_eq!(mood_for(Some(79.9)), Mood::Happy);
        assert_eq!(mood_for(Some(80.0)), Mood::Tired);
        assert_eq!(mood_for(Some(95.0)), Mood::Exhausted);
    }

    #[test]
    fn icon_has_expected_size_and_corner_is_transparent() {
        let buf = render_icon(Some(50.0));
        assert_eq!(buf.len(), (SIZE * SIZE * 4) as usize);
        assert_eq!(alpha_at(&buf, 0, 0), 0);
    }

    #[test]
    fn ring_fill_follows_percentage() {
        // pixel à direita do centro (quarto de volta): preenchido com 50%, vazio com 10%
        let half = render_icon(Some(50.0));
        let low = render_icon(Some(10.0));
        assert_eq!(rgb_at(&half, 28, 16), [70, 190, 120]);
        assert_eq!(rgb_at(&low, 28, 16), [90, 90, 90]);
        assert_eq!(rgb_at(&render_icon(Some(97.0)), 28, 16), [229, 72, 77]);
    }

    #[test]
    fn tooltip_formats_both_tools() {
        let t = tooltip(&[("Claude", Some(42.0), None), ("Codex", Some(64.0), Some(94.0))]);
        assert_eq!(t, "Claude: 5h 42% · sem --\nCodex: 5h 64% · sem 94%");
        assert_eq!(tooltip(&[]), "Token Pets");
    }
}
