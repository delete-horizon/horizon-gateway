use std::time::{Duration, Instant};

use rand::Rng;

pub const MAX_SPRITES: usize = 12;
pub const DEFAULT_TTL_MS: u64 = 2000;

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

impl Engine {
    pub fn spawn(&mut self, kind: ActionKind, seed: Option<u64>, width: f32, height: f32) {
        let mut rng = rand::thread_rng();
        let seed = seed.unwrap_or_else(|| rng.gen());
        let margin = 80.0;
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
            let alpha = (fade * 220.0) as u8;
            match s.kind {
                ActionKind::Poke => {
                    let r = 12.0 + t * 8.0;
                    cmds.push(DrawCmd::Circle {
                        x: s.x,
                        y: s.y,
                        r,
                        rgba: [16, 185, 129, alpha],
                    });
                }
                ActionKind::Sparkle => {
                    for i in 0..4 {
                        let a = (s.seed + i * 40) as f32 * 0.1 + t * 6.0;
                        let dx = a.cos() * (20.0 + t * 30.0);
                        let dy = a.sin() * (20.0 + t * 30.0);
                        cmds.push(DrawCmd::Circle {
                            x: s.x + dx,
                            y: s.y + dy,
                            r: 4.0 * fade,
                            rgba: [251, 191, 36, alpha],
                        });
                    }
                }
                ActionKind::Ping => {
                    cmds.push(DrawCmd::Ring {
                        x: s.x,
                        y: s.y,
                        r: 10.0 + t * 50.0,
                        stroke: 3.0,
                        rgba: [56, 189, 248, alpha],
                    });
                }
                ActionKind::Float => {
                    cmds.push(DrawCmd::Circle {
                        x: s.x,
                        y: s.y - t * 40.0,
                        r: 14.0,
                        rgba: [167, 139, 250, alpha],
                    });
                }
                ActionKind::Burst => {
                    for i in 0..6 {
                        let a = i as f32 * std::f32::consts::TAU / 6.0;
                        cmds.push(DrawCmd::Circle {
                            x: s.x + a.cos() * t * 60.0,
                            y: s.y + a.sin() * t * 60.0,
                            r: 6.0 * fade,
                            rgba: [244, 63, 94, alpha],
                        });
                    }
                }
                ActionKind::Wave => {
                    let ox = (t * 12.0).sin() * 24.0;
                    cmds.push(DrawCmd::Circle {
                        x: s.x + ox,
                        y: s.y,
                        r: 10.0,
                        rgba: [52, 211, 153, alpha],
                    });
                }
            }
        }
        Frame { cmds }
    }
}
