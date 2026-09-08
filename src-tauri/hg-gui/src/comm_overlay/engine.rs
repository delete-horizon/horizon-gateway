use std::time::{Duration, Instant};

use rand::Rng;

pub const MAX_SPRITES: usize = 12;
pub const DEFAULT_TTL_MS: u64 = 2400;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ActionKind {
    Poke,
    Sparkle,
    Ping,
    Float,
    Burst,
    Wave,
}

impl ActionKind {
    pub fn parse(s: &str) -> Self {
        match s.to_ascii_lowercase().as_str() {
            "sparkle" => Self::Sparkle,
            "ping" => Self::Ping,
            "float" => Self::Float,
            "burst" => Self::Burst,
            "wave" => Self::Wave,
            _ => Self::Poke,
        }
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
}

#[derive(Clone, Debug)]
pub enum DrawCmd {
    /// Soft filled circle (used for glows via layered draws).
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
    /// 5-point star (twinkles / light).
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
    /// Cute cat face (procedural).
    Cat {
        x: f32,
        y: f32,
        scale: f32,
        rot: f32,
        tint: [u8; 3],
        alpha: u8,
    },
    /// Soft radial glow (multiple translucent layers).
    Glow {
        x: f32,
        y: f32,
        r: f32,
        rgba: [u8; 4],
        layers: u8,
    },
    /// Thin light ray from center.
    Ray {
        x: f32,
        y: f32,
        len: f32,
        width: f32,
        rot: f32,
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

impl Engine {
    pub fn spawn(&mut self, kind: ActionKind, seed: Option<u64>, width: f32, height: f32) {
        let mut rng = rand::thread_rng();
        let seed = seed.unwrap_or_else(|| rng.gen());
        let margin = 100.0;
        let x = margin + (seed % 1000) as f32 / 1000.0 * (width - margin * 2.0).max(1.0);
        let y = margin + ((seed / 7) % 1000) as f32 / 1000.0 * (height - margin * 2.0).max(1.0);
        self.sprites.push(Sprite {
            id: self.next_id,
            kind,
            x,
            y,
            born: Instant::now(),
            ttl: Duration::from_millis(DEFAULT_TTL_MS),
            seed,
        });
        self.next_id = self.next_id.wrapping_add(1);
        while self.sprites.len() > MAX_SPRITES {
            self.sprites.remove(0);
        }
    }

    pub fn clear(&mut self) {
        self.sprites.clear();
    }

    pub fn is_empty(&self) -> bool {
        self.sprites.is_empty()
    }

    pub fn tick(&mut self, now: Instant, _width: f32, _height: f32) -> Frame {
        self.sprites.retain(|s| now.duration_since(s.born) < s.ttl);
        let mut cmds = Vec::new();
        for s in &self.sprites {
            let t = now.duration_since(s.born).as_secs_f32() / s.ttl.as_secs_f32();
            let fade = (1.0 - t).clamp(0.0, 1.0);
            let pop = ease_out((t * 2.5).min(1.0));
            match s.kind {
                // 콕 — soft paw-poke glow + tiny hearts
                ActionKind::Poke => {
                    let scale = 0.55 + pop * 0.55;
                    cmds.push(DrawCmd::Glow {
                        x: s.x,
                        y: s.y,
                        r: 36.0 * scale,
                        rgba: [255, 182, 193, a(fade, 90.0)],
                        layers: 5,
                    });
                    cmds.push(DrawCmd::Cat {
                        x: s.x,
                        y: s.y,
                        scale: 22.0 * scale,
                        rot: (t * 0.4).sin() * 0.12,
                        tint: [255, 214, 170],
                        alpha: a(fade, 245.0),
                    });
                    for i in 0..3 {
                        let ang = (s.seed + i * 50) as f32 * 0.15 + t * 4.0;
                        let dist = 28.0 + t * 18.0 + i as f32 * 6.0;
                        cmds.push(DrawCmd::Heart {
                            x: s.x + ang.cos() * dist,
                            y: s.y + ang.sin() * dist - t * 12.0,
                            size: (5.0 + i as f32) * fade,
                            rgba: [255, 105, 180, a(fade, 200.0)],
                        });
                    }
                }
                // 반짝 — beautiful light rays + glitter stars
                ActionKind::Sparkle => {
                    let core = 14.0 + pop * 10.0;
                    cmds.push(DrawCmd::Glow {
                        x: s.x,
                        y: s.y,
                        r: 55.0 * (0.6 + fade * 0.5),
                        rgba: [255, 250, 200, a(fade, 110.0)],
                        layers: 6,
                    });
                    cmds.push(DrawCmd::Glow {
                        x: s.x,
                        y: s.y,
                        r: core,
                        rgba: [255, 255, 255, a(fade, 230.0)],
                        layers: 3,
                    });
                    for i in 0..8 {
                        let rot = (s.seed % 360) as f32 * 0.017 + i as f32 * (std::f32::consts::TAU / 8.0) + t * 1.2;
                        cmds.push(DrawCmd::Ray {
                            x: s.x,
                            y: s.y,
                            len: 28.0 + t * 42.0 + (i % 3) as f32 * 8.0,
                            width: 2.2 + fade * 1.5,
                            rot,
                            rgba: [255, 236, 150, a(fade, 160.0)],
                        });
                    }
                    for i in 0..6 {
                        let ang = (s.seed + i * 37) as f32 * 0.11 + t * 5.0;
                        let dist = 22.0 + t * 38.0;
                        cmds.push(DrawCmd::Star {
                            x: s.x + ang.cos() * dist,
                            y: s.y + ang.sin() * dist,
                            outer: 5.5 * fade,
                            inner: 2.2 * fade,
                            rot: ang + t * 3.0,
                            rgba: [255, 215, 64, a(fade, 230.0)],
                        });
                    }
                }
                // 핑 — soft aurora ripple + star dust
                ActionKind::Ping => {
                    let e = ease_out(t);
                    cmds.push(DrawCmd::Glow {
                        x: s.x,
                        y: s.y,
                        r: 18.0 + e * 20.0,
                        rgba: [186, 230, 253, a(fade, 140.0)],
                        layers: 4,
                    });
                    cmds.push(DrawCmd::Ring {
                        x: s.x,
                        y: s.y,
                        r: 12.0 + e * 70.0,
                        stroke: 2.5 + fade * 2.0,
                        rgba: [125, 211, 252, a(fade, 200.0)],
                    });
                    cmds.push(DrawCmd::Ring {
                        x: s.x,
                        y: s.y,
                        r: 6.0 + e * 40.0,
                        stroke: 1.5,
                        rgba: [224, 242, 254, a(fade * 0.8, 160.0)],
                    });
                    for i in 0..5 {
                        let ang = (s.seed + i * 41) as f32 * 0.13 + t * 2.5;
                        let dist = 16.0 + e * 48.0;
                        cmds.push(DrawCmd::Star {
                            x: s.x + ang.cos() * dist,
                            y: s.y + ang.sin() * dist,
                            outer: 4.0 * fade,
                            inner: 1.6 * fade,
                            rot: ang,
                            rgba: [255, 255, 255, a(fade, 210.0)],
                        });
                    }
                }
                // 둥둥 — floating cat rising with soft violet glow
                ActionKind::Float => {
                    let bob = (t * 10.0).sin() * 4.0;
                    let y = s.y - ease_in_out(t) * 70.0 + bob;
                    let scale = 20.0 + (1.0 - t) * 6.0;
                    cmds.push(DrawCmd::Glow {
                        x: s.x,
                        y,
                        r: 40.0,
                        rgba: [196, 181, 253, a(fade, 100.0)],
                        layers: 5,
                    });
                    cmds.push(DrawCmd::Cat {
                        x: s.x,
                        y,
                        scale,
                        rot: (t * 6.0).sin() * 0.18,
                        tint: [233, 213, 255],
                        alpha: a(fade, 245.0),
                    });
                    cmds.push(DrawCmd::Star {
                        x: s.x + 22.0,
                        y: y - 18.0,
                        outer: 5.0 * fade,
                        inner: 2.0 * fade,
                        rot: t * 4.0,
                        rgba: [255, 255, 255, a(fade, 220.0)],
                    });
                }
                // 팡 — heart + star confetti burst
                ActionKind::Burst => {
                    cmds.push(DrawCmd::Glow {
                        x: s.x,
                        y: s.y,
                        r: 20.0 + ease_out(t) * 30.0,
                        rgba: [251, 113, 133, a(fade, 90.0)],
                        layers: 4,
                    });
                    for i in 0..10 {
                        let ang = i as f32 * std::f32::consts::TAU / 10.0 + (s.seed % 20) as f32 * 0.05;
                        let dist = ease_out(t) * (50.0 + (i % 3) as f32 * 12.0);
                        let px = s.x + ang.cos() * dist;
                        let py = s.y + ang.sin() * dist;
                        if i % 2 == 0 {
                            cmds.push(DrawCmd::Heart {
                                x: px,
                                y: py,
                                size: (7.0 - t * 2.0) * fade,
                                rgba: [
                                    255,
                                    80 + ((i * 17) % 80) as u8,
                                    140,
                                    a(fade, 230.0),
                                ],
                            });
                        } else {
                            cmds.push(DrawCmd::Star {
                                x: px,
                                y: py,
                                outer: 6.0 * fade,
                                inner: 2.4 * fade,
                                rot: ang + t * 5.0,
                                rgba: [254, 240, 138, a(fade, 230.0)],
                            });
                        }
                    }
                }
                // 흔들 — swaying cat with ribbon trail
                ActionKind::Wave => {
                    let ox = (t * 14.0).sin() * 36.0;
                    let rot = (t * 14.0).sin() * 0.35;
                    cmds.push(DrawCmd::Glow {
                        x: s.x + ox,
                        y: s.y,
                        r: 38.0,
                        rgba: [110, 231, 183, a(fade, 90.0)],
                        layers: 4,
                    });
                    cmds.push(DrawCmd::Cat {
                        x: s.x + ox,
                        y: s.y,
                        scale: 24.0,
                        rot,
                        tint: [167, 243, 208],
                        alpha: a(fade, 245.0),
                    });
                    for i in 0..4 {
                        let trail_t = (t - i as f32 * 0.06).max(0.0);
                        let tox = (trail_t * 14.0).sin() * 36.0;
                        cmds.push(DrawCmd::Heart {
                            x: s.x + tox * 0.7,
                            y: s.y + 20.0 + i as f32 * 8.0,
                            size: (4.5 - i as f32 * 0.5) * fade,
                            rgba: [52, 211, 153, a(fade * (1.0 - i as f32 * 0.2), 180.0)],
                        });
                    }
                }
            }
        }
        Frame { cmds }
    }
}
