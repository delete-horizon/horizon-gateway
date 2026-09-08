use std::time::{Duration, Instant};

use rand::Rng;

pub const MAX_FX: usize = 14;
pub const MAX_FLIES: usize = 100;
pub const DEFAULT_TTL_MS: u64 = 2600;
pub const FLY_TTL_MS: u64 = 20_000;
pub const SWATTER_REACH: f32 = 56.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ActionKind {
    Poke,
    Sparkle,
    Ping,
    Float,
    Burst,
    Wave,
    CoffeeAsk,
    CoffeeGive,
    Fly,
}

impl ActionKind {
    pub fn parse(s: &str) -> Self {
        match s.to_ascii_lowercase().as_str() {
            "sparkle" => Self::Sparkle,
            "ping" => Self::Ping,
            "float" => Self::Float,
            "burst" => Self::Burst,
            "wave" => Self::Wave,
            "coffee_ask" | "coffee-ask" | "coffeeask" => Self::CoffeeAsk,
            "coffee_give" | "coffee-give" | "coffeegive" => Self::CoffeeGive,
            "fly" | "flies" | "날파리" => Self::Fly,
            _ => Self::Poke,
        }
    }

    pub fn is_fly(self) -> bool {
        matches!(self, Self::Fly)
    }
}

#[derive(Clone, Debug)]
pub struct Sprite {
    pub id: u64,
    pub kind: ActionKind,
    pub x: f32,
    pub y: f32,
    pub born: Instant,
    pub ttl: Duration,
    pub seed: u64,
    /// Visual scale multiplier (randomized).
    pub scale: f32,
    pub rot0: f32,
    /// 0 smug / 1 angry(킹받) / 2 derp
    pub mood: u8,
    pub vx: f32,
    pub vy: f32,
    pub catchable: bool,
}

#[derive(Clone, Debug)]
pub enum DrawCmd {
    Circle {
        x: f32,
        y: f32,
        r: f32,
        rgba: [u8; 4],
    },
    Ring {
        x: f32,
        y: f32,
        r: f32,
        stroke: f32,
        rgba: [u8; 4],
    },
    Star {
        x: f32,
        y: f32,
        outer: f32,
        inner: f32,
        rot: f32,
        rgba: [u8; 4],
    },
    Heart {
        x: f32,
        y: f32,
        size: f32,
        rgba: [u8; 4],
    },
    Cat {
        x: f32,
        y: f32,
        scale: f32,
        rot: f32,
        tint: [u8; 3],
        alpha: u8,
        mood: u8,
    },
    Glow {
        x: f32,
        y: f32,
        r: f32,
        rgba: [u8; 4],
        layers: u8,
    },
    Ray {
        x: f32,
        y: f32,
        len: f32,
        width: f32,
        rot: f32,
        rgba: [u8; 4],
    },
    Coffee {
        x: f32,
        y: f32,
        scale: f32,
        rot: f32,
        alpha: u8,
        /// true = "사줄게요" (offer), false = "사주세요" (ask)
        offer: bool,
    },
    Fly {
        x: f32,
        y: f32,
        scale: f32,
        rot: f32,
        wing: f32,
        alpha: u8,
    },
    /// Fly swatter drawn at cursor while flies are active.
    Swatter {
        x: f32,
        y: f32,
        scale: f32,
        rot: f32,
        alpha: u8,
    },
    /// Annoy marks: 0=💢 vein, 1=sweat, 2=ㅋ blob
    Mark {
        x: f32,
        y: f32,
        scale: f32,
        kind: u8,
        rgba: [u8; 4],
    },
}

#[derive(Clone, Debug, Default)]
pub struct Frame {
    pub cmds: Vec<DrawCmd>,
}

#[derive(Default)]
pub struct Engine {
    sprites: Vec<Sprite>,
    next_id: u64,
    last_x: f32,
    last_y: f32,
    bounds_w: f32,
    bounds_h: f32,
}

fn ease_out(t: f32) -> f32 {
    1.0 - (1.0 - t).powi(3)
}

fn ease_in_out(t: f32) -> f32 {
    if t < 0.5 {
        2.0 * t * t
    } else {
        1.0 - (-2.0 * t + 2.0).powi(2) / 2.0
    }
}

fn a(fade: f32, peak: f32) -> u8 {
    (fade.clamp(0.0, 1.0) * peak).round().clamp(0.0, 255.0) as u8
}

fn hash_u64(s: u64) -> u64 {
    let mut x = s.wrapping_add(0x9E37_79B9_7F4A_7C15);
    x = (x ^ (x >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    x = (x ^ (x >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    x ^ (x >> 31)
}

impl Engine {
    pub fn spawn(&mut self, kind: ActionKind, seed: Option<u64>, width: f32, height: f32) {
        self.bounds_w = width.max(1.0);
        self.bounds_h = height.max(1.0);
        let mut rng = rand::thread_rng();
        // Always mix fresh entropy — rapid clicks must not land on a grid.
        let entropy: u64 = rng.gen();
        let base = seed.unwrap_or_else(|| rng.gen());
        let seed = hash_u64(base ^ entropy ^ self.next_id.wrapping_mul(0xD1B5_4A32_D192_ED03));

        let margin = 90.0;
        let usable_w = (width - margin * 2.0).max(1.0);
        let usable_h = (height - margin * 2.0).max(1.0);

        let mut x = margin + rng.gen::<f32>() * usable_w;
        let mut y = margin + rng.gen::<f32>() * usable_h;
        // Nudge away from the previous spawn so stacks feel scattered.
        for _ in 0..6 {
            let dx = x - self.last_x;
            let dy = y - self.last_y;
            if dx * dx + dy * dy > 12_000.0 {
                break;
            }
            x = margin + rng.gen::<f32>() * usable_w;
            y = margin + rng.gen::<f32>() * usable_h;
        }
        self.last_x = x;
        self.last_y = y;

        let scale = if kind.is_fly() {
            0.75 + rng.gen::<f32>() * 0.7
        } else {
            0.65 + rng.gen::<f32>() * 1.15
        };
        let rot0 = rng.gen::<f32>() * std::f32::consts::TAU;
        let mood = rng.gen_range(0u8..3);
        let (vx, vy) = if kind.is_fly() {
            let speed = 40.0 + rng.gen::<f32>() * 120.0;
            let ang = rng.gen::<f32>() * std::f32::consts::TAU;
            (ang.cos() * speed, ang.sin() * speed)
        } else {
            (
                (rng.gen::<f32>() - 0.5) * 30.0,
                (rng.gen::<f32>() - 0.5) * 20.0,
            )
        };
        let ttl = if kind.is_fly() {
            Duration::from_millis(FLY_TTL_MS)
        } else {
            Duration::from_millis(DEFAULT_TTL_MS + rng.gen_range(0..900))
        };

        self.sprites.push(Sprite {
            id: self.next_id,
            kind,
            x,
            y,
            born: Instant::now(),
            ttl,
            seed,
            scale,
            rot0,
            mood,
            vx,
            vy,
            catchable: kind.is_fly(),
        });
        self.next_id = self.next_id.wrapping_add(1);

        if kind.is_fly() {
            while self.fly_count() > MAX_FLIES {
                if let Some(i) = self.sprites.iter().position(|s| s.kind.is_fly()) {
                    self.sprites.remove(i);
                } else {
                    break;
                }
            }
        } else {
            let fx: Vec<_> = self
                .sprites
                .iter()
                .filter(|s| !s.kind.is_fly())
                .map(|s| s.id)
                .collect();
            if fx.len() > MAX_FX {
                let drop = fx.len() - MAX_FX;
                for id in fx.into_iter().take(drop) {
                    self.sprites.retain(|s| s.id != id);
                }
            }
        }
    }

    fn fly_count(&self) -> usize {
        self.sprites.iter().filter(|s| s.kind.is_fly()).count()
    }

    pub fn clear(&mut self) {
        self.sprites.clear();
    }

    pub fn is_empty(&self) -> bool {
        self.sprites.is_empty()
    }

    pub fn has_catchables(&self) -> bool {
        self.sprites.iter().any(|s| s.catchable)
    }

    /// Hit targets in overlay pixel space: (x, y, radius).
    pub fn catch_targets(&self) -> Vec<(f32, f32, f32)> {
        self.sprites
            .iter()
            .filter(|s| s.catchable)
            .map(|s| (s.x, s.y, SWATTER_REACH * s.scale.max(0.7)))
            .collect()
    }

    /// Returns true if a catchable near (x,y) was removed.
    pub fn try_catch(&mut self, x: f32, y: f32) -> bool {
        let mut best: Option<(usize, f32)> = None;
        for (i, s) in self.sprites.iter().enumerate() {
            if !s.catchable {
                continue;
            }
            let r = SWATTER_REACH * s.scale.max(0.7);
            let dx = s.x - x;
            let dy = s.y - y;
            let d2 = dx * dx + dy * dy;
            if d2 <= r * r {
                if best.map(|(_, bd)| d2 < bd).unwrap_or(true) {
                    best = Some((i, d2));
                }
            }
        }
        if let Some((i, _)) = best {
            self.sprites.remove(i);
            true
        } else {
            false
        }
    }

    pub fn tick(
        &mut self,
        now: Instant,
        width: f32,
        height: f32,
        cursor: Option<(f32, f32)>,
    ) -> Frame {
        self.bounds_w = width.max(1.0);
        self.bounds_h = height.max(1.0);
        let dt = 1.0 / 30.0;

        for s in &mut self.sprites {
            if s.kind.is_fly() {
                // Buzz: wander + occasional direction flick.
                let h = hash_u64(s.seed ^ (now.elapsed().as_millis() as u64 / 80));
                if h % 17 == 0 {
                    let ang = ((h >> 8) as f32 / u32::MAX as f32) * std::f32::consts::TAU;
                    let speed = 50.0 + (h % 90) as f32;
                    s.vx = ang.cos() * speed;
                    s.vy = ang.sin() * speed;
                }
                let wobble = ((now.duration_since(s.born).as_secs_f32() * 28.0)
                    + (s.seed % 50) as f32)
                    .sin()
                    * 35.0;
                s.x += (s.vx + wobble) * dt;
                s.y += (s.vy - wobble * 0.4) * dt;
                let m = 20.0;
                if s.x < m {
                    s.x = m;
                    s.vx = s.vx.abs();
                }
                if s.x > width - m {
                    s.x = width - m;
                    s.vx = -s.vx.abs();
                }
                if s.y < m {
                    s.y = m;
                    s.vy = s.vy.abs();
                }
                if s.y > height - m {
                    s.y = height - m;
                    s.vy = -s.vy.abs();
                }
            }
        }

        self.sprites.retain(|s| now.duration_since(s.born) < s.ttl);
        let mut cmds = Vec::new();
        for s in &self.sprites {
            let t = now.duration_since(s.born).as_secs_f32() / s.ttl.as_secs_f32();
            let fade = if s.kind.is_fly() {
                1.0
            } else {
                (1.0 - t).clamp(0.0, 1.0)
            };
            let pop = ease_out((t * 2.8).min(1.0));
            let sc = s.scale;
            let chaos = ((s.seed % 100) as f32) * 0.01;

            match s.kind {
                ActionKind::Poke => {
                    let scale = (0.7 + pop * 0.9) * sc;
                    let shake = if s.mood == 1 {
                        (t * 40.0).sin() * 10.0
                    } else {
                        (t * 18.0).sin() * 3.0
                    };
                    cmds.push(DrawCmd::Glow {
                        x: s.x + shake,
                        y: s.y,
                        r: 48.0 * scale,
                        rgba: [255, 120, 150, a(fade, 100.0)],
                        layers: 5,
                    });
                    cmds.push(DrawCmd::Cat {
                        x: s.x + shake,
                        y: s.y,
                        scale: 28.0 * scale,
                        rot: s.rot0 * 0.05 + (t * (8.0 + s.mood as f32 * 10.0)).sin() * 0.35,
                        tint: match s.mood {
                            1 => [255, 170, 140],
                            2 => [255, 240, 160],
                            _ => [255, 214, 170],
                        },
                        alpha: a(fade, 250.0),
                        mood: s.mood,
                    });
                    if s.mood == 1 {
                        cmds.push(DrawCmd::Mark {
                            x: s.x + 34.0 * scale,
                            y: s.y - 30.0 * scale,
                            scale: 14.0 * scale,
                            kind: 0,
                            rgba: [220, 40, 60, a(fade, 230.0)],
                        });
                    }
                    for i in 0..(3 + s.mood as i32) {
                        let ang = chaos * 6.0 + i as f32 * 1.7 + t * (5.0 + chaos * 4.0);
                        let dist = 30.0 + t * 28.0 + i as f32 * 8.0 + chaos * 20.0;
                        cmds.push(DrawCmd::Heart {
                            x: s.x + ang.cos() * dist,
                            y: s.y + ang.sin() * dist - t * 16.0,
                            size: (6.0 + i as f32 * 2.0) * fade * sc,
                            rgba: [255, 70 + (i as u8 * 30), 160, a(fade, 220.0)],
                        });
                    }
                }
                ActionKind::Sparkle => {
                    let spin = s.rot0 + t * (2.0 + chaos * 5.0);
                    cmds.push(DrawCmd::Glow {
                        x: s.x,
                        y: s.y,
                        r: 70.0 * sc * (0.5 + fade * 0.6),
                        rgba: [255, 245, 180, a(fade, 120.0)],
                        layers: 6,
                    });
                    cmds.push(DrawCmd::Glow {
                        x: s.x,
                        y: s.y,
                        r: (16.0 + pop * 14.0) * sc,
                        rgba: [255, 255, 255, a(fade, 240.0)],
                        layers: 3,
                    });
                    let rays = 6 + (s.seed % 5) as i32;
                    for i in 0..rays {
                        let rot = spin + i as f32 * (std::f32::consts::TAU / rays as f32);
                        cmds.push(DrawCmd::Ray {
                            x: s.x,
                            y: s.y,
                            len: (30.0 + t * 55.0 + (i % 3) as f32 * 12.0) * sc,
                            width: (2.0 + fade * 2.5) * sc,
                            rot,
                            rgba: [255, 230, 120, a(fade, 180.0)],
                        });
                    }
                    for i in 0..8 {
                        let ang = chaos * 10.0 + i as f32 * 0.9 + t * 6.0;
                        let dist = (18.0 + t * 50.0 + (hash_u64(s.seed + i as u64) % 40) as f32) * sc;
                        cmds.push(DrawCmd::Star {
                            x: s.x + ang.cos() * dist,
                            y: s.y + ang.sin() * dist,
                            outer: 7.0 * fade * sc,
                            inner: 2.8 * fade * sc,
                            rot: ang + t * 4.0,
                            rgba: [255, 215, 64, a(fade, 240.0)],
                        });
                    }
                }
                ActionKind::Ping => {
                    let e = ease_out(t);
                    let skew = (s.seed % 40) as f32 - 20.0;
                    cmds.push(DrawCmd::Glow {
                        x: s.x,
                        y: s.y,
                        r: (20.0 + e * 24.0) * sc,
                        rgba: [160, 220, 255, a(fade, 150.0)],
                        layers: 4,
                    });
                    for k in 0..3 {
                        cmds.push(DrawCmd::Ring {
                            x: s.x + skew * 0.1 * k as f32,
                            y: s.y,
                            r: (10.0 + e * (55.0 + k as f32 * 22.0)) * sc,
                            stroke: (2.0 + fade * 2.0) * sc,
                            rgba: [100 + k * 40, 200, 255, a(fade * (1.0 - k as f32 * 0.2), 200.0)],
                        });
                    }
                    for i in 0..6 {
                        let ang = s.rot0 + i as f32 * 1.1 + t * 3.0;
                        let dist = (14.0 + e * 60.0) * sc;
                        cmds.push(DrawCmd::Star {
                            x: s.x + ang.cos() * dist,
                            y: s.y + ang.sin() * dist,
                            outer: 5.0 * fade * sc,
                            inner: 2.0 * fade * sc,
                            rot: ang,
                            rgba: [255, 255, 255, a(fade, 220.0)],
                        });
                    }
                }
                ActionKind::Float => {
                    let rise = ease_in_out(t.min(1.0)) * (80.0 + chaos * 60.0) * sc;
                    let bob = (t * (9.0 + chaos * 8.0)).sin() * 8.0;
                    let x = s.x + s.vx * t * 2.0;
                    let y = s.y - rise + bob;
                    cmds.push(DrawCmd::Glow {
                        x,
                        y,
                        r: 50.0 * sc,
                        rgba: [200, 160, 255, a(fade, 110.0)],
                        layers: 5,
                    });
                    cmds.push(DrawCmd::Cat {
                        x,
                        y,
                        scale: 26.0 * sc,
                        rot: s.rot0 * 0.1 + (t * 7.0).sin() * 0.45,
                        tint: [230, 200, 255],
                        alpha: a(fade, 250.0),
                        mood: s.mood,
                    });
                    cmds.push(DrawCmd::Mark {
                        x: x + 28.0 * sc,
                        y: y - 10.0 * sc,
                        scale: 10.0 * sc,
                        kind: 2,
                        rgba: [80, 60, 100, a(fade, 200.0)],
                    });
                }
                ActionKind::Burst => {
                    cmds.push(DrawCmd::Glow {
                        x: s.x,
                        y: s.y,
                        r: (24.0 + ease_out(t) * 40.0) * sc,
                        rgba: [255, 80, 120, a(fade, 100.0)],
                        layers: 4,
                    });
                    let n = 8 + (s.seed % 6) as i32;
                    for i in 0..n {
                        let ang = s.rot0 + i as f32 * (std::f32::consts::TAU / n as f32);
                        let dist = ease_out(t) * (55.0 + (i % 4) as f32 * 18.0 + chaos * 30.0) * sc;
                        let px = s.x + ang.cos() * dist;
                        let py = s.y + ang.sin() * dist + t * s.vy;
                        if i % 3 == 0 {
                            cmds.push(DrawCmd::Mark {
                                x: px,
                                y: py,
                                scale: 9.0 * fade * sc,
                                kind: 2,
                                rgba: [40, 40, 50, a(fade, 230.0)],
                            });
                        } else if i % 2 == 0 {
                            cmds.push(DrawCmd::Heart {
                                x: px,
                                y: py,
                                size: (8.0 - t * 2.0) * fade * sc,
                                rgba: [255, 60 + ((i * 20) % 100) as u8, 130, a(fade, 240.0)],
                            });
                        } else {
                            cmds.push(DrawCmd::Star {
                                x: px,
                                y: py,
                                outer: 7.0 * fade * sc,
                                inner: 2.6 * fade * sc,
                                rot: ang + t * 6.0,
                                rgba: [255, 230, 100, a(fade, 240.0)],
                            });
                        }
                    }
                }
                ActionKind::Wave => {
                    let amp = 40.0 + chaos * 50.0;
                    let freq = 12.0 + chaos * 10.0;
                    let ox = (t * freq).sin() * amp * sc;
                    let rot = (t * freq).sin() * 0.55 + s.rot0 * 0.05;
                    cmds.push(DrawCmd::Glow {
                        x: s.x + ox,
                        y: s.y,
                        r: 46.0 * sc,
                        rgba: [80, 230, 180, a(fade, 100.0)],
                        layers: 4,
                    });
                    cmds.push(DrawCmd::Cat {
                        x: s.x + ox,
                        y: s.y,
                        scale: 30.0 * sc,
                        rot,
                        tint: [150, 250, 200],
                        alpha: a(fade, 250.0),
                        mood: s.mood,
                    });
                    if s.mood >= 1 {
                        cmds.push(DrawCmd::Mark {
                            x: s.x + ox + 32.0 * sc,
                            y: s.y - 28.0 * sc,
                            scale: 12.0 * sc,
                            kind: 1,
                            rgba: [120, 180, 255, a(fade, 220.0)],
                        });
                    }
                }
                ActionKind::CoffeeAsk | ActionKind::CoffeeGive => {
                    let offer = matches!(s.kind, ActionKind::CoffeeGive);
                    let bob = (t * 10.0).sin() * 6.0;
                    let y = s.y + bob - t * 10.0;
                    cmds.push(DrawCmd::Glow {
                        x: s.x,
                        y,
                        r: 50.0 * sc,
                        rgba: if offer {
                            [255, 200, 120, a(fade, 110.0)]
                        } else {
                            [180, 140, 255, a(fade, 110.0)]
                        },
                        layers: 5,
                    });
                    cmds.push(DrawCmd::Coffee {
                        x: s.x,
                        y,
                        scale: 34.0 * sc * (0.85 + pop * 0.3),
                        rot: s.rot0 * 0.08 + (t * 5.0).sin() * 0.2,
                        alpha: a(fade, 250.0),
                        offer,
                    });
                    cmds.push(DrawCmd::Cat {
                        x: s.x + 40.0 * sc,
                        y: y - 8.0 * sc,
                        scale: 18.0 * sc,
                        rot: -0.2,
                        tint: [255, 220, 190],
                        alpha: a(fade, 240.0),
                        mood: if offer { 0 } else { 1 },
                    });
                    cmds.push(DrawCmd::Mark {
                        x: s.x - 36.0 * sc,
                        y: y - 30.0 * sc,
                        scale: 11.0 * sc,
                        kind: 2,
                        rgba: [60, 40, 30, a(fade, 210.0)],
                    });
                }
                ActionKind::Fly => {
                    let phase = now.duration_since(s.born).as_secs_f32() * 40.0 + (s.seed % 20) as f32;
                    let rot = s.vy.atan2(s.vx) + phase.sin() * 0.4;
                    let life_fade = if t > 0.85 {
                        ((1.0 - t) / 0.15).clamp(0.0, 1.0)
                    } else {
                        1.0
                    };
                    cmds.push(DrawCmd::Fly {
                        x: s.x,
                        y: s.y,
                        scale: 10.0 * sc,
                        rot,
                        wing: phase,
                        alpha: a(life_fade, 230.0),
                    });
                }
            }
        }
        if let Some((cx, cy)) = cursor.filter(|_| self.has_catchables()) {
            cmds.push(DrawCmd::Swatter {
                x: cx,
                y: cy,
                scale: 1.15,
                rot: -0.55,
                alpha: 230,
            });
        }
        Frame { cmds }
    }
}
