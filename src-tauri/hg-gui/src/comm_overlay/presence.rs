//! Residents pace a foot-line strip above the taskbar on the primary monitor.
//! Speech bubbles stay with them; incoming chat also gets a right-side toast stack in the UI.

use std::collections::HashSet;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use specta::Type;

use super::avatar::AvatarKit;
use super::engine::{hash_u64, Banner, DrawCmd, Engine};

pub const BUBBLE_TTL_MS: u64 = 5000;
pub const BUBBLE_MAX_CHARS: usize = 50;
const WALK_PAD_X: f32 = 48.0;
/// Feet sit this many pixels above the primary work-area bottom (already above the taskbar).
const FOOT_CLEARANCE: f32 = 8.0;
const WALK_SPEED: f32 = 54.0;
const ARRIVE_DIST: f32 = 12.0;

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
    pub online: bool,
    pub tx: f32,
    pub ty: f32,
    /// Seconds to stand still before choosing the next point.
    pub pause: f32,
}

/// One resident click, taken by the workspace shell and turned into a composer.
#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct OverlayResidentClick {
    pub profile_id: String,
    pub label: String,
    pub x: f64,
    pub y: f64,
}

static RESIDENT_CLICK: Mutex<Option<OverlayResidentClick>> = Mutex::new(None);

pub fn store_resident_click(profile_id: String, label: String, x: f64, y: f64) {
    if let Ok(mut slot) = RESIDENT_CLICK.lock() {
        *slot = Some(OverlayResidentClick {
            profile_id,
            label,
            x,
            y,
        });
    }
}

pub fn take_resident_click() -> Option<OverlayResidentClick> {
    RESIDENT_CLICK.lock().ok().and_then(|mut slot| slot.take())
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
        let wanted: Vec<&CommResidentInput> = specs
            .iter()
            .filter(|s| !s.profile_id.trim().is_empty())
            .collect();
        let keep: HashSet<&str> = wanted.iter().map(|s| s.profile_id.as_str()).collect();
        self.residents
            .retain(|r| keep.contains(r.profile_id.as_str()));
        self.bubbles
            .retain(|b| keep.contains(b.profile_id.as_str()));

        let (ox, oy, w, h) = self.resident_walk_span();
        let rect = walk_rect(ox, oy, w, h);

        for spec in wanted {
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
                existing.online = spec.online;
                // Keep survivors on the foot strip if walk bounds changed (or after upgrade).
                existing.x = existing.x.clamp(rect.min_x, rect.max_x);
                existing.y = rect.min_y;
                existing.ty = rect.min_y;
                continue;
            }
            self.residents.push(spawn_resident(
                spec,
                ox,
                oy,
                w,
                h,
                self.residents.len(),
            ));
        }
    }

    /// Sprite-box hit, closest resident wins. `resident.y` is the foot line.
    pub fn resident_at(&self, x: f32, y: f32) -> Option<(String, String)> {
        let mut best: Option<(f32, &Resident)> = None;
        for resident in &self.residents {
            let ps = crate::comm_overlay::avatar::display_pixel_size(&resident.kit, resident.scale);
            let (hx, hy) = crate::comm_overlay::avatar::bounds(ps);
            let half_h = (crate::comm_overlay::avatar::COMPOSE_H as f32) * 0.5 * ps;
            let cx = resident.x;
            let cy = resident.y - half_h;
            if (x - cx).abs() > hx || y < cy - hy || y > resident.y + 18.0 {
                continue;
            }
            let dist = (x - cx) * (x - cx) + (y - cy) * (y - cy);
            if best.as_ref().is_none_or(|found| dist < found.0) {
                best = Some((dist, resident));
            }
        }
        best.map(|(_, resident)| (resident.profile_id.clone(), resident.label.clone()))
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
            let (ox, oy, mut w, mut h) = self.resident_walk_span();
            if w < 64.0 {
                w = 1280.0;
            }
            if h < 64.0 {
                h = 720.0;
            }
            self.residents.push(spawn_resident(
                &spec,
                ox,
                oy,
                w,
                h,
                self.residents.len(),
            ));
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
        let (ox, oy, w, h) = self.resident_walk_span();
        let rect = walk_rect(ox, oy, w, h);
        let foot_y = rect.min_y;

        for r in &mut self.residents {
            r.phase += dt * 5.2;
            // Horizontal pace only — feet never leave the taskbar strip.
            r.y = foot_y;
            r.ty = foot_y;
            r.x = r.x.clamp(rect.min_x, rect.max_x);
            r.tx = r.tx.clamp(rect.min_x, rect.max_x);
            if r.pause > 0.0 {
                r.pause = (r.pause - dt).max(0.0);
                continue;
            }
            let dx = r.tx - r.x;
            let speed = resident_speed(r.seed);
            if dx.abs() <= ARRIVE_DIST {
                r.x = r.tx;
                let roll = hash_u64(r.seed ^ r.tx.to_bits() as u64 ^ r.ty.to_bits() as u64);
                r.pause = if roll % 3 == 0 {
                    0.8 + (roll % 140) as f32 / 100.0
                } else {
                    0.12
                };
                let (tx, _) = pick_target(rect, roll);
                r.tx = tx;
                continue;
            }
            let step = speed * dt;
            r.x += dx.signum() * step.min(dx.abs());
            r.vx = dx.signum() * speed;
        }

        self.bubbles
            .retain(|b| now.saturating_duration_since(b.born) < b.ttl);

        for r in &self.residents {
            let bob = r.phase.sin() * 2.0;
            let ps = crate::comm_overlay::avatar::display_pixel_size(&r.kit, r.scale);
            let half_h = (crate::comm_overlay::avatar::COMPOSE_H as f32) * 0.5 * ps;
            // paint() treats y as sprite center; pin feet to resident.y.
            let foot_y = r.y + bob;
            let center_y = foot_y - half_h;
            let facing = if r.vx < 0.0 { -1 } else { 1 };
            let step = ((r.phase * 3.0).floor() as i32).rem_euclid(2) as u8;
            cmds.push(DrawCmd::Avatar {
                x: r.x,
                y: center_y,
                pixel_size: ps,
                facing,
                alpha: if r.online { 255 } else { 110 },
                step,
                ids: r.kit.ids(),
            });
            banners.push(Banner::label(r.label.clone(), r.x, foot_y + 14.0));
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
            let bob = r.phase.sin() * 2.0;
            let ps = crate::comm_overlay::avatar::display_pixel_size(&r.kit, r.scale);
            let half_h = (crate::comm_overlay::avatar::COMPOSE_H as f32) * 0.5 * ps;
            let body_s = crate::comm_overlay::avatar::body_scale(&r.kit) * r.scale.max(0.8);
            let bx = r.x;
            let by = r.y + bob - half_h - (24.0 * body_s + 10.0);
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

#[derive(Clone, Copy)]
struct WalkRect {
    min_x: f32,
    max_x: f32,
    min_y: f32,
    max_y: f32,
}

fn walk_rect(origin_x: f32, origin_y: f32, width: f32, height: f32) -> WalkRect {
    let min_x = origin_x + WALK_PAD_X;
    let max_x = (origin_x + width - WALK_PAD_X).max(min_x);
    // Resident.y is the foot line. Keep everyone on one strip above the taskbar.
    let foot_y = origin_y + height - FOOT_CLEARANCE;
    WalkRect {
        min_x,
        max_x,
        min_y: foot_y,
        max_y: foot_y,
    }
}

fn unit(seed: u64) -> f32 {
    (hash_u64(seed) % 10_000) as f32 / 10_000.0
}

fn pick_target(rect: WalkRect, seed: u64) -> (f32, f32) {
    let x = rect.min_x + unit(seed) * (rect.max_x - rect.min_x);
    let y = rect.min_y + unit(seed ^ 0xA5A5_5A5A) * (rect.max_y - rect.min_y);
    (x, y)
}

fn resident_speed(seed: u64) -> f32 {
    WALK_SPEED * (0.82 + ((seed >> 3) % 30) as f32 * 0.012)
}

fn spawn_resident(
    spec: &CommResidentInput,
    origin_x: f32,
    origin_y: f32,
    width: f32,
    height: f32,
    index: usize,
) -> Resident {
    let seed = hash_profile(&spec.profile_id).wrapping_add(index as u64 * 0x9E37_79B9);
    let rect = walk_rect(origin_x, origin_y, width, height);
    let (x, y) = pick_target(rect, seed);
    let (tx, ty) = pick_target(rect, seed ^ 0x51ED_1234);
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
        y,
        vx: if tx < x {
            -resident_speed(seed)
        } else {
            resident_speed(seed)
        },
        seed,
        mood: (seed % 3) as u8,
        scale: 0.9 + ((seed >> 5) % 20) as f32 * 0.01,
        phase: ((seed >> 8) % 100) as f32 * 0.1,
        kit: spec.kit.normalized(),
        online: spec.online,
        tx,
        ty,
        pause: 0.0,
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
    fn offline_specs_stay_dimmed() {
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
        assert_eq!(e.residents.len(), 1);
        assert!(!e.residents[0].online);
        let frame = e.tick(Instant::now(), 800.0, 600.0, None);
        assert!(frame
            .cmds
            .iter()
            .any(|cmd| matches!(cmd, DrawCmd::Avatar { alpha: 110, .. })));
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
    fn residents_wander_inside_the_screen() {
        let mut e = Engine::default();
        e.set_screen_origin(-1920.0, 0.0);
        e.set_walk_bounds(0.0, 0.0, 1920.0, 1080.0);
        e.sync_residents(&[spec("me", "나")], 3840.0, 1080.0);
        let start = e.residents[0].clone();
        let foot_line = 1080.0 - super::FOOT_CLEARANCE;
        assert!(start.x >= super::WALK_PAD_X - 0.1);
        assert!(start.x <= 1920.0 - super::WALK_PAD_X + 0.1);
        assert!((start.y - foot_line).abs() < 1.0);
        let mut t = Instant::now();
        for _ in 0..80 {
            t += Duration::from_millis(50);
            e.tick(t, 3840.0, 1080.0, None);
        }
        let moved = e.residents[0].clone();
        let dx = moved.x - start.x;
        assert!(dx.abs() > 8.0, "resident should pace horizontally");
        assert!(moved.x >= super::WALK_PAD_X - 1.0);
        assert!(moved.x <= 1920.0 - super::WALK_PAD_X + 1.0);
        assert!((moved.y - foot_line).abs() < 1.0, "feet stay on the strip");
        assert!(moved.x >= 0.0, "resident stays on the primary monitor");
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
