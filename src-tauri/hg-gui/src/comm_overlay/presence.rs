//! Edge-walking residents and speech bubbles. Separate from TTL'd FX sprites.

use std::collections::HashSet;
use std::time::{Duration, Instant};

use serde::Deserialize;
use specta::Type;

use super::avatar::AvatarKit;
use super::engine::{hash_u64, Banner, DrawCmd, Engine};

pub const BUBBLE_TTL_MS: u64 = 5000;
pub const BUBBLE_MAX_CHARS: usize = 50;
const EDGE_Y: f32 = 56.0;
const EDGE_X_PAD: f32 = 44.0;
const WALK_SPEED: f32 = 42.0;

#[derive(Clone, Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CommResidentInput {
    pub profile_id: String,
    pub label: String,
    #[serde(default = "default_online")]
    pub online: bool,
    #[serde(default)]
    pub kit: AvatarKit,
}

fn default_online() -> bool {
    true
}

#[derive(Clone, Debug)]
pub struct Resident {
    pub profile_id: String,
    pub label: String,
    pub x: f32,
    pub y: f32,
    pub vx: f32,
    pub seed: u64,
    pub mood: u8,
    pub scale: f32,
    pub phase: f32,
    pub kit: AvatarKit,
}

#[derive(Clone, Debug)]
pub struct Bubble {
    pub profile_id: String,
    pub text: String,
    pub born: Instant,
    pub ttl: Duration,
}

impl Engine {
    pub fn sync_residents(&mut self, specs: &[CommResidentInput], width: f32, height: f32) {
        self.bounds_w = width.max(1.0);
        self.bounds_h = height.max(1.0);
        let online: Vec<&CommResidentInput> = specs
            .iter()
            .filter(|s| s.online && !s.profile_id.trim().is_empty())
            .collect();
        let keep: HashSet<&str> = online.iter().map(|s| s.profile_id.as_str()).collect();
        self.residents
            .retain(|r| keep.contains(r.profile_id.as_str()));
        self.bubbles
            .retain(|b| keep.contains(b.profile_id.as_str()));

        for spec in online {
            if let Some(existing) = self
                .residents
                .iter_mut()
                .find(|r| r.profile_id == spec.profile_id)
            {
                let label = spec.label.trim();
                if !label.is_empty() {
                    existing.label = label.to_string();
                }
                existing.kit = spec.kit.normalized();
                existing.y = (height - EDGE_Y).max(EDGE_Y);
                continue;
            }
            self.residents
                .push(spawn_resident(spec, width, height, self.residents.len()));
        }
    }

    pub fn show_bubble(&mut self, profile_id: &str, text: &str, ttl: Duration, now: Instant) {
        let profile_id = profile_id.trim();
        let text = truncate_bubble(text);
        if profile_id.is_empty() || text.is_empty() {
            return;
        }
        if !self.residents.iter().any(|r| r.profile_id == profile_id) {
            let spec = CommResidentInput {
                profile_id: profile_id.to_string(),
                label: profile_id.to_string(),
                online: true,
                kit: AvatarKit::default(),
            };
            let w = if self.bounds_w < 64.0 {
                1280.0
            } else {
                self.bounds_w
            };
            let h = if self.bounds_h < 64.0 {
                720.0
            } else {
                self.bounds_h
            };
            self.residents
                .push(spawn_resident(&spec, w, h, self.residents.len()));
        }
        self.bubbles.retain(|b| b.profile_id != profile_id);
        self.bubbles.push(Bubble {
            profile_id: profile_id.to_string(),
            text,
            born: now,
            ttl,
        });
    }

    pub(crate) fn tick_presence(
        &mut self,
        now: Instant,
        width: f32,
        height: f32,
        dt: f32,
        cmds: &mut Vec<DrawCmd>,
        banners: &mut Vec<Banner>,
    ) {
        let min_x = EDGE_X_PAD;
        let max_x = (width - EDGE_X_PAD).max(min_x);
        let y = (height - EDGE_Y).max(EDGE_Y);

        for r in &mut self.residents {
            r.y = y;
            r.x += r.vx * dt;
            r.phase += dt * 5.2;
            if r.x <= min_x {
                r.x = min_x;
                r.vx = r.vx.abs();
            } else if r.x >= max_x {
                r.x = max_x;
                r.vx = -r.vx.abs();
            }
        }

        self.bubbles
            .retain(|b| now.saturating_duration_since(b.born) < b.ttl);

        for r in &self.residents {
            let bob = r.phase.sin() * 3.5;
            let draw_y = r.y + bob;
            let facing = if r.vx < 0.0 { -1 } else { 1 };
            let step = ((r.phase * 3.0).floor() as i32).rem_euclid(2) as u8;
            cmds.push(DrawCmd::Avatar {
                x: r.x,
                y: draw_y,
                pixel_size: crate::comm_overlay::avatar::display_pixel_size(&r.kit, r.scale),
                facing,
                alpha: 255,
                step,
                ids: r.kit.ids(),
            });
            let label_dy =
                22.0 * crate::comm_overlay::avatar::body_scale(&r.kit) * r.scale.max(0.8) + 28.0;
            banners.push(Banner::label(r.label.clone(), r.x, draw_y + label_dy));
        }

        for b in &self.bubbles {
            let Some(r) = self.residents.iter().find(|r| r.profile_id == b.profile_id) else {
                continue;
            };
            let t = now.saturating_duration_since(b.born).as_secs_f32() / b.ttl.as_secs_f32();
            let fade = (1.0 - t).clamp(0.0, 1.0);
            let alpha = (fade * 230.0).round().clamp(0.0, 255.0) as u8;
            if alpha < 8 {
                continue;
            }
            let char_w = 12.0;
            let w = (b.text.chars().count() as f32 * char_w + 28.0).clamp(52.0, 300.0);
            let h = 28.0;
            let bob = r.phase.sin() * 3.5;
            let bx = r.x;
            let body_s = crate::comm_overlay::avatar::body_scale(&r.kit) * r.scale.max(0.8);
            let by = r.y + bob - (42.0 * body_s + 16.0);
            cmds.push(DrawCmd::SpeechBubble {
                x: bx,
                y: by,
                w,
                h,
                alpha,
            });
            banners.push(Banner::speech(b.text.clone(), bx, by, alpha));
        }
    }
}

fn spawn_resident(spec: &CommResidentInput, width: f32, height: f32, index: usize) -> Resident {
    let seed = hash_profile(&spec.profile_id);
    let min_x = EDGE_X_PAD;
    let max_x = (width - EDGE_X_PAD).max(min_x);
    let slot = (seed.wrapping_add(index as u64 * 0x9E37_79B9) % 1000) as f32 / 1000.0;
    let x = min_x + slot * (max_x - min_x).max(1.0);
    let dir = if seed & 1 == 0 { 1.0 } else { -1.0 };
    let speed = WALK_SPEED * (0.82 + ((seed >> 3) % 25) as f32 * 0.01);
    Resident {
        profile_id: spec.profile_id.clone(),
        label: {
            let label = spec.label.trim();
            if label.is_empty() {
                spec.profile_id.clone()
            } else {
                label.to_string()
            }
        },
        x,
        y: (height - EDGE_Y).max(EDGE_Y),
        vx: dir * speed,
        seed,
        mood: (seed % 3) as u8,
        scale: 0.9 + ((seed >> 5) % 20) as f32 * 0.01,
        phase: ((seed >> 8) % 100) as f32 * 0.1,
        kit: spec.kit.normalized(),
    }
}

fn hash_profile(id: &str) -> u64 {
    let mut h: u64 = 0xC0FF_EE12_3456_7890;
    for b in id.as_bytes() {
        h = h.wrapping_mul(0x0100_0000_01B3).wrapping_add(u64::from(*b));
    }
    hash_u64(h)
}

pub fn truncate_bubble(text: &str) -> String {
    let trimmed = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if trimmed.is_empty() {
        return String::new();
    }
    let mut out = String::new();
    for (i, ch) in trimmed.chars().enumerate() {
        if i >= BUBBLE_MAX_CHARS {
            out.push('…');
            break;
        }
        out.push(ch);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::comm_overlay::engine::{DrawCmd, Engine};

    fn spec(id: &str, label: &str) -> CommResidentInput {
        CommResidentInput {
            profile_id: id.into(),
            label: label.into(),
            online: true,
            kit: AvatarKit::default(),
        }
    }

    #[test]
    fn sync_adds_updates_and_removes() {
        let mut e = Engine::default();
        e.sync_residents(&[spec("a", "나"), spec("b", "보리")], 800.0, 600.0);
        assert_eq!(e.residents.len(), 2);
        e.sync_residents(&[spec("a", "나")], 800.0, 600.0);
        assert_eq!(e.residents.len(), 1);
        assert_eq!(e.residents[0].profile_id, "a");
        e.sync_residents(&[], 800.0, 600.0);
        assert!(e.is_empty());
    }

    #[test]
    fn offline_specs_are_dropped() {
        let mut e = Engine::default();
        e.sync_residents(
            &[CommResidentInput {
                profile_id: "a".into(),
                label: "나".into(),
                online: false,
                kit: AvatarKit::default(),
            }],
            800.0,
            600.0,
        );
        assert!(e.residents.is_empty());
    }

    #[test]
    fn bubble_attaches_and_expires() {
        let mut e = Engine::default();
        let t0 = Instant::now();
        e.sync_residents(&[spec("me", "나")], 800.0, 600.0);
        e.show_bubble("me", "안녕 테스트", Duration::from_millis(1000), t0);
        let frame = e.tick(t0, 800.0, 600.0, None);
        assert!(frame.banners.iter().any(|b| b.text.contains("안녕")));
        assert!(frame
            .cmds
            .iter()
            .any(|c| matches!(c, DrawCmd::SpeechBubble { .. })));
        let later = t0 + Duration::from_millis(1600);
        e.tick(later, 800.0, 600.0, None);
        assert!(e.bubbles.is_empty());
    }

    #[test]
    fn bubble_spawns_missing_resident() {
        let mut e = Engine::default();
        e.bounds_w = 800.0;
        e.bounds_h = 600.0;
        e.show_bubble("solo", "hi", Duration::from_millis(4000), Instant::now());
        assert_eq!(e.residents.len(), 1);
        assert_eq!(e.residents[0].profile_id, "solo");
    }

    #[test]
    fn residents_stay_on_bottom_and_walk() {
        let mut e = Engine::default();
        e.sync_residents(&[spec("me", "나")], 800.0, 600.0);
        let x0 = e.residents[0].x;
        let t0 = Instant::now();
        e.tick(t0, 800.0, 600.0, None);
        e.tick(t0 + Duration::from_millis(400), 800.0, 600.0, None);
        assert!((e.residents[0].y - (600.0 - super::EDGE_Y)).abs() < 0.1);
        assert!((e.residents[0].x - x0).abs() > 1.0);
        assert!(e.residents[0].x >= super::EDGE_X_PAD - 0.1);
        assert!(e.residents[0].x <= 800.0 - super::EDGE_X_PAD + 0.1);
    }

    #[test]
    fn truncate_bubble_caps_and_collapses_space() {
        assert_eq!(truncate_bubble("  안녕   세상  "), "안녕 세상");
        let long = "가".repeat(60);
        let out = truncate_bubble(&long);
        assert!(out.ends_with('…'));
        assert_eq!(out.chars().count(), BUBBLE_MAX_CHARS + 1);
    }

    #[test]
    fn frame_sleep_slows_when_only_residents() {
        let mut e = Engine::default();
        assert_eq!(e.frame_sleep_ms(), 200);
        e.sync_residents(&[spec("me", "나")], 800.0, 600.0);
        assert_eq!(e.frame_sleep_ms(), 80);
    }

    #[test]
    fn tick_draws_an_avatar_for_each_resident() {
        let mut e = Engine::default();
        e.sync_residents(&[spec("me", "나")], 800.0, 600.0);
        let frame = e.tick(Instant::now(), 800.0, 600.0, None);
        let avatars = frame
            .cmds
            .iter()
            .filter(|c| matches!(c, DrawCmd::Avatar { .. }))
            .count();
        assert_eq!(avatars, 1);
    }
}
