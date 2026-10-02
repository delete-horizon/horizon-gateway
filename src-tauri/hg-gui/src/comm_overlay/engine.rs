use std::time::{Duration, Instant};

use rand::Rng;

pub const MAX_FX: usize = 14;
pub const MAX_FLIES: usize = 100;
pub const DEFAULT_TTL_MS: u64 = 2600;
pub const FLY_TTL_MS: u64 = 20_000;
pub const SWATTER_REACH: f32 = 56.0;
pub const SPRAY_RADIUS: f32 = 96.0;
pub const MAX_FLY_BURST: u32 = 40;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum OverlayTool {
    #[default]
    None,
    /// Cursor-local spray: rest of the desktop stays click-through.
    Spray,
}

impl OverlayTool {
    pub fn parse(s: &str) -> Self {
        match s.to_ascii_lowercase().as_str() {
            "spray" | "스프레이" => Self::Spray,
            _ => Self::None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Spray => "spray",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ActionKind {
    Poke,
    Slash,
    Thrust,
    Blunt,
    Shot,
    Cast,
    Guard,
    Light,
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
            "slash" | "swing" => Self::Slash,
            "thrust" => Self::Thrust,
            "blunt" | "bonk" => Self::Blunt,
            "shot" | "arrow" | "bow" => Self::Shot,
            "cast" => Self::Cast,
            "guard" | "block" => Self::Guard,
            "light" | "lantern" => Self::Light,
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

    /// Overlay name shared with `held-actions.json` and [`hg_avatar::strike_grip`].
    pub fn overlay_name(self) -> &'static str {
        match self {
            Self::Slash => "slash",
            Self::Thrust => "thrust",
            Self::Blunt => "blunt",
            Self::Shot => "shot",
            Self::Cast => "cast",
            Self::Guard => "guard",
            Self::Light => "light",
            Self::Poke => "poke",
            _ => "poke",
        }
    }

    /// Weapon and unarmed hits land on a body instead of a random screen point.
    pub fn hits_body(self) -> bool {
        matches!(
            self,
            Self::Poke
                | Self::Slash
                | Self::Thrust
                | Self::Blunt
                | Self::Shot
                | Self::Cast
                | Self::Guard
                | Self::Light
        )
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
    pub from_label: Option<String>,
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
    /// Pixel-art resident. Packed part ids are shop SKUs.
    Avatar {
        x: f32,
        y: f32,
        pixel_size: f32,
        facing: i8,
        alpha: u8,
        step: u8,
        /// 0 neutral, 1 hurt, 2 angry. Set while the resident is flinching.
        face: u8,
        /// Held-layer shift in cells. Zero keeps the weapon on the hand anchor.
        grip_dx: i8,
        grip_dy: i8,
        ids: crate::comm_overlay::avatar::AvatarIds,
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
    /// Fly swatter drawn at cursor while spray tool is armed.
    Swatter {
        x: f32,
        y: f32,
        scale: f32,
        rot: f32,
        alpha: u8,
    },
    /// Mist cloud for the spray tool.
    SprayCloud { x: f32, y: f32, r: f32, alpha: u8 },
    /// Bottom-right arm chip (visual); hit handled separately.
    ArmChip { x: f32, y: f32, w: f32, h: f32 },
    /// Annoy marks: 0=💢 vein, 1=sweat, 2=ㅋ blob
    Mark {
        x: f32,
        y: f32,
        scale: f32,
        kind: u8,
        rgba: [u8; 4],
    },
    /// Rounded speech panel behind a banner (center = x,y). Drawn as one occupancy
    /// mask so faded alpha does not show circle/rect seams.
    SpeechBubble {
        x: f32,
        y: f32,
        w: f32,
        h: f32,
        alpha: u8,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BannerKind {
    Label,
    Speech,
}

#[derive(Clone, Debug)]
pub struct Banner {
    pub text: String,
    pub x: f32,
    pub y: f32,
    pub kind: BannerKind,
    pub alpha: u8,
}

impl Banner {
    pub fn label(text: impl Into<String>, x: f32, y: f32) -> Self {
        Self {
            text: text.into(),
            x,
            y,
            kind: BannerKind::Label,
            alpha: 235,
        }
    }

    pub fn speech(text: impl Into<String>, x: f32, y: f32, alpha: u8) -> Self {
        Self {
            text: text.into(),
            x,
            y,
            kind: BannerKind::Speech,
            alpha,
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct Frame {
    pub cmds: Vec<DrawCmd>,
    /// Sender banners drawn via platform text (GDI on Windows).
    pub banners: Vec<Banner>,
}

#[derive(Default)]
pub struct Engine {
    sprites: Vec<Sprite>,
    next_id: u64,
    last_x: f32,
    last_y: f32,
    pub(crate) bounds_x: f32,
    pub(crate) bounds_y: f32,
    pub(crate) bounds_w: f32,
    pub(crate) bounds_h: f32,
    /// Primary monitor, in the same virtual-screen pixels as `bounds_*`.
    /// Residents walk here. FX sprites still use the full virtual desktop.
    pub(crate) walk_x: f32,
    pub(crate) walk_y: f32,
    pub(crate) walk_w: f32,
    pub(crate) walk_h: f32,
    tool: OverlayTool,
    pub(crate) residents: Vec<super::presence::Resident>,
    pub(crate) bubbles: Vec<super::presence::Bubble>,
    last_tick: Option<Instant>,
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

pub(crate) fn hash_u64(s: u64) -> u64 {
    let mut x = s.wrapping_add(0x9E37_79B9_7F4A_7C15);
    x = (x ^ (x >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    x = (x ^ (x >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    x ^ (x >> 31)
}

impl Engine {
    pub fn set_tool(&mut self, tool: OverlayTool) {
        self.tool = tool;
        if !self.has_catchables() {
            self.tool = OverlayTool::None;
        }
    }

    pub fn tool(&self) -> OverlayTool {
        self.tool
    }

    pub fn spawn_n(
        &mut self,
        kind: ActionKind,
        seed: Option<u64>,
        width: f32,
        height: f32,
        count: u32,
        from_label: Option<String>,
        anchor: Option<String>,
    ) {
        let n = if kind.is_fly() {
            count.clamp(1, MAX_FLY_BURST)
        } else {
            1
        };
        let label = from_label
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        for i in 0..n {
            let s = seed.map(|base| base ^ ((i as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15)));
            self.spawn(kind, s, width, height, label.clone(), anchor.clone());
        }
    }

    pub fn spawn(
        &mut self,
        kind: ActionKind,
        seed: Option<u64>,
        width: f32,
        height: f32,
        from_label: Option<String>,
        anchor: Option<String>,
    ) {
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

        let anchored = kind.hits_body().then(|| self.hit_point(anchor.as_deref()));
        let (x, y) = if let Some((ax, ay)) = anchored.flatten() {
            (ax, ay)
        } else {
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
            (x, y)
        };
        self.last_x = x;
        self.last_y = y;

        let scale = if kind.is_fly() {
            0.75 + rng.gen::<f32>() * 0.7
        } else if kind.hits_body() {
            1.0
        } else {
            0.65 + rng.gen::<f32>() * 1.15
        };
        let rot0 = match kind {
            ActionKind::Thrust | ActionKind::Shot | ActionKind::Poke => {
                if rng.gen_bool(0.5) {
                    0.0
                } else {
                    std::f32::consts::PI
                }
            }
            ActionKind::Slash => -0.5 + rng.gen::<f32>() * 1.0,
            _ => rng.gen::<f32>() * std::f32::consts::TAU,
        };
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
        } else if kind.hits_body() {
            Duration::from_millis(780)
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
            from_label,
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

    /// Chest of the named resident, else the first walker, else the foot line.
    fn hit_point(&self, anchor: Option<&str>) -> Option<(f32, f32)> {
        let named = anchor.and_then(|id| self.residents.iter().find(|r| r.profile_id == id));
        if let Some(resident) = named.or_else(|| self.residents.first()) {
            let ps = crate::comm_overlay::avatar::display_pixel_size(&resident.kit, resident.scale);
            let half = (crate::comm_overlay::avatar::COMPOSE_H as f32) * 0.35 * ps;
            return Some((resident.x, resident.y - half));
        }
        let (x, y, w, h) = self.resident_walk_span();
        if w < 64.0 || h < 64.0 {
            return None;
        }
        Some((x + w * 0.5, y + h - 96.0))
    }

    fn fly_count(&self) -> usize {
        self.sprites.iter().filter(|s| s.kind.is_fly()).count()
    }

    pub fn clear(&mut self) {
        self.sprites.clear();
        self.residents.clear();
        self.bubbles.clear();
        self.tool = OverlayTool::None;
        self.last_tick = None;
    }

    pub fn is_empty(&self) -> bool {
        self.sprites.is_empty() && self.residents.is_empty() && self.bubbles.is_empty()
    }

    /// Sleep between blits. Walking stays ~30fps. A lunge is ~60fps so the dash
    /// is not a few big jumps. An empty overlay waits.
    pub fn frame_sleep_ms(&self) -> u64 {
        if self.resident_strike_active() {
            16
        } else if !self.sprites.is_empty() || !self.bubbles.is_empty() || !self.residents.is_empty()
        {
            33
        } else {
            200
        }
    }

    pub(crate) fn take_dt(&mut self, now: Instant) -> f32 {
        let dt = self
            .last_tick
            .map(|prev| now.saturating_duration_since(prev).as_secs_f32())
            .unwrap_or(1.0 / 30.0);
        self.last_tick = Some(now);
        dt.clamp(1.0 / 120.0, 0.05)
    }

    pub fn has_catchables(&self) -> bool {
        self.sprites.iter().any(|s| s.catchable)
    }

    fn arm_chip_center(width: f32, height: f32) -> (f32, f32) {
        (width - 78.0, height - 52.0)
    }

    /// Zones that should receive mouse (everything else stays click-through).
    pub fn hit_zones(
        &self,
        width: f32,
        height: f32,
        cursor: Option<(f32, f32)>,
    ) -> Vec<(f32, f32, f32)> {
        if !self.has_catchables() {
            return Vec::new();
        }
        match self.tool {
            OverlayTool::Spray => cursor
                .map(|(x, y)| vec![(x, y, SPRAY_RADIUS)])
                .unwrap_or_default(),
            OverlayTool::None => {
                let (cx, cy) = Self::arm_chip_center(width, height);
                vec![(cx, cy, 52.0)]
            }
        }
    }

    pub fn on_click(&mut self, x: f32, y: f32, width: f32, height: f32) -> bool {
        if !self.has_catchables() {
            self.tool = OverlayTool::None;
            return false;
        }
        match self.tool {
            OverlayTool::None => {
                let (cx, cy) = Self::arm_chip_center(width, height);
                let dx = x - cx;
                let dy = y - cy;
                if dx * dx + dy * dy <= 52.0 * 52.0 {
                    self.tool = OverlayTool::Spray;
                    true
                } else {
                    false
                }
            }
            OverlayTool::Spray => {
                let hit = self.try_spray(x, y, SPRAY_RADIUS);
                if !self.has_catchables() {
                    self.tool = OverlayTool::None;
                }
                hit
            }
        }
    }

    /// Returns true if any catchable in radius was removed.
    pub fn try_spray(&mut self, x: f32, y: f32, radius: f32) -> bool {
        let r2 = radius * radius;
        let before = self.sprites.len();
        self.sprites.retain(|s| {
            if !s.catchable {
                return true;
            }
            let dx = s.x - x;
            let dy = s.y - y;
            dx * dx + dy * dy > r2
        });
        self.sprites.len() != before
    }

    pub fn set_screen_origin(&mut self, x: f32, y: f32) {
        self.bounds_x = x;
        self.bounds_y = y;
    }

    /// Confine resident wandering to one monitor. `w`/`h` below 64 keep the fallback
    /// (the whole screen passed to `tick`), which tests and non-Windows presenters use.
    pub fn set_walk_bounds(&mut self, x: f32, y: f32, w: f32, h: f32) {
        self.walk_x = x;
        self.walk_y = y;
        self.walk_w = w;
        self.walk_h = h;
    }

    pub(crate) fn resident_walk_span(&self) -> (f32, f32, f32, f32) {
        if self.walk_w >= 64.0 && self.walk_h >= 64.0 {
            return (self.walk_x, self.walk_y, self.walk_w, self.walk_h);
        }
        (
            self.bounds_x,
            self.bounds_y,
            self.bounds_w.max(1.0),
            self.bounds_h.max(1.0),
        )
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
        let dt = self.take_dt(now);

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
                    let len = ease_out((t * 1.6).min(1.0)) * 34.0 * sc;
                    cmds.push(DrawCmd::Ray {
                        x: s.x,
                        y: s.y,
                        len,
                        width: 2.2 * sc,
                        rot: s.rot0,
                        rgba: [236, 240, 245, a(fade, 230.0)],
                    });
                    let tip = t.max(0.45);
                    cmds.push(DrawCmd::Ring {
                        x: s.x + s.rot0.cos() * len,
                        y: s.y + s.rot0.sin() * len,
                        r: 6.0 + (tip - 0.45) * 18.0,
                        stroke: 1.6 * sc,
                        rgba: [210, 216, 224, a(fade * tip, 180.0)],
                    });
                }
                ActionKind::Slash => {
                    let sweep = -1.05 + ease_out(t) * 2.1;
                    for i in 0..6 {
                        let along = (i as f32 - 2.5) * 0.11;
                        let rot = s.rot0 + sweep + along;
                        let len = (28.0 + i as f32 * 8.0) * sc * (0.35 + ease_out(t) * 0.65);
                        let core = i == 3;
                        cmds.push(DrawCmd::Ray {
                            x: s.x,
                            y: s.y,
                            len,
                            width: if core { 3.4 } else { 1.5 } * sc,
                            rot,
                            rgba: if core {
                                [248, 250, 255, a(fade, 240.0)]
                            } else {
                                [176, 186, 204, a(fade, 190.0)]
                            },
                        });
                    }
                }
                ActionKind::Thrust => {
                    let len = ease_out((t * 1.35).min(1.0)) * 86.0 * sc;
                    cmds.push(DrawCmd::Ray {
                        x: s.x,
                        y: s.y,
                        len,
                        width: 2.4 * sc,
                        rot: s.rot0,
                        rgba: [220, 228, 238, a(fade, 235.0)],
                    });
                    if t > 0.4 {
                        let tip_x = s.x + s.rot0.cos() * len;
                        let tip_y = s.y + s.rot0.sin() * len;
                        let hit = ease_out(((t - 0.4) / 0.6).min(1.0));
                        cmds.push(DrawCmd::Ring {
                            x: tip_x,
                            y: tip_y,
                            r: 5.0 + hit * 16.0,
                            stroke: 2.0 * sc,
                            rgba: [255, 244, 220, a(fade, 210.0)],
                        });
                    }
                }
                ActionKind::Blunt => {
                    let hit = ease_out(t);
                    cmds.push(DrawCmd::Circle {
                        x: s.x,
                        y: s.y,
                        r: (8.0 + hit * 10.0) * sc,
                        rgba: [255, 214, 140, a(fade, 230.0)],
                    });
                    cmds.push(DrawCmd::Ring {
                        x: s.x,
                        y: s.y,
                        r: (6.0 + hit * 28.0) * sc,
                        stroke: 3.2 * sc,
                        rgba: [196, 132, 64, a(fade, 220.0)],
                    });
                    cmds.push(DrawCmd::Ring {
                        x: s.x,
                        y: s.y,
                        r: (4.0 + hit * 46.0) * sc,
                        stroke: 1.6 * sc,
                        rgba: [120, 84, 48, a(fade * (1.0 - hit * 0.4), 160.0)],
                    });
                }
                ActionKind::Shot => {
                    let dist = ease_out(t) * 120.0 * sc;
                    let tip_x = s.x + s.rot0.cos() * dist;
                    let tip_y = s.y + s.rot0.sin() * dist;
                    cmds.push(DrawCmd::Ray {
                        x: s.x,
                        y: s.y,
                        len: dist.max(8.0),
                        width: 1.7 * sc,
                        rot: s.rot0,
                        rgba: [92, 64, 40, a(fade, 220.0)],
                    });
                    cmds.push(DrawCmd::Circle {
                        x: tip_x,
                        y: tip_y,
                        r: 3.2 * sc,
                        rgba: [245, 245, 250, a(fade, 240.0)],
                    });
                }
                ActionKind::Cast => {
                    let dist = ease_out(t) * 64.0 * sc;
                    let ox = s.x + s.rot0.cos() * dist;
                    let oy = s.y + s.rot0.sin() * dist;
                    cmds.push(DrawCmd::Glow {
                        x: ox,
                        y: oy,
                        r: (18.0 + fade * 10.0) * sc,
                        rgba: [168, 120, 255, a(fade, 140.0)],
                        layers: 4,
                    });
                    cmds.push(DrawCmd::Circle {
                        x: ox,
                        y: oy,
                        r: 5.5 * sc,
                        rgba: [236, 220, 255, a(fade, 240.0)],
                    });
                    cmds.push(DrawCmd::Ring {
                        x: s.x,
                        y: s.y,
                        r: (8.0 + ease_out(t) * 22.0) * sc,
                        stroke: 1.5 * sc,
                        rgba: [140, 90, 220, a(fade, 160.0)],
                    });
                    for i in 0..4 {
                        let rot = s.rot0 + i as f32 * std::f32::consts::FRAC_PI_2 + t * 1.2;
                        cmds.push(DrawCmd::Ray {
                            x: ox,
                            y: oy,
                            len: 16.0 * fade * sc,
                            width: 1.3 * sc,
                            rot,
                            rgba: [210, 180, 255, a(fade, 180.0)],
                        });
                    }
                }
                ActionKind::Guard => {
                    let flash = (1.0 - t * 0.35).clamp(0.0, 1.0);
                    cmds.push(DrawCmd::Ring {
                        x: s.x,
                        y: s.y,
                        r: 26.0 * sc,
                        stroke: 4.0 * sc,
                        rgba: [150, 186, 214, a(fade * flash, 210.0)],
                    });
                    for i in -2..=2 {
                        let rot = -0.5 + i as f32 * 0.22;
                        cmds.push(DrawCmd::Ray {
                            x: s.x,
                            y: s.y,
                            len: 22.0 * sc,
                            width: 2.6 * sc,
                            rot,
                            rgba: [214, 228, 240, a(fade * flash, 200.0)],
                        });
                    }
                }
                ActionKind::Light => {
                    let grow = 0.55 + ease_out(t) * 0.45;
                    cmds.push(DrawCmd::Glow {
                        x: s.x,
                        y: s.y,
                        r: 54.0 * grow * sc,
                        rgba: [255, 176, 64, a(fade, 120.0)],
                        layers: 5,
                    });
                    cmds.push(DrawCmd::Glow {
                        x: s.x,
                        y: s.y,
                        r: 18.0 * sc,
                        rgba: [255, 236, 190, a(fade, 200.0)],
                        layers: 3,
                    });
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
                        let dist =
                            (18.0 + t * 50.0 + (hash_u64(s.seed + i as u64) % 40) as f32) * sc;
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
                            rgba: [
                                100 + k * 40,
                                200,
                                255,
                                a(fade * (1.0 - k as f32 * 0.2), 200.0),
                            ],
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
                    let phase =
                        now.duration_since(s.born).as_secs_f32() * 40.0 + (s.seed % 20) as f32;
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

        let mut banners = Vec::new();
        if self.has_catchables() {
            let mut labels: Vec<(String, usize)> = Vec::new();
            for s in &self.sprites {
                if !s.catchable {
                    continue;
                }
                let name = s
                    .from_label
                    .as_deref()
                    .map(str::trim)
                    .filter(|v| !v.is_empty())
                    .unwrap_or("누군가");
                if let Some((_, n)) = labels.iter_mut().find(|(l, _)| l == name) {
                    *n += 1;
                } else {
                    labels.push((name.to_string(), 1));
                }
            }
            let mut y = 28.0;
            for (name, n) in labels {
                let text = if n > 1 {
                    format!("{name} · 똥파리 ×{n}")
                } else {
                    format!("{name} · 똥파리")
                };
                banners.push(Banner::label(text, width * 0.5, y));
                y += 28.0;
            }
        }

        match self.tool {
            OverlayTool::Spray => {
                if let Some((cx, cy)) = cursor.filter(|_| self.has_catchables()) {
                    cmds.push(DrawCmd::SprayCloud {
                        x: cx,
                        y: cy,
                        r: SPRAY_RADIUS,
                        alpha: 90,
                    });
                    cmds.push(DrawCmd::Swatter {
                        x: cx + 18.0,
                        y: cy + 10.0,
                        scale: 0.95,
                        rot: -0.55,
                        alpha: 210,
                    });
                }
            }
            OverlayTool::None if self.has_catchables() => {
                let (cx, cy) = Self::arm_chip_center(width, height);
                cmds.push(DrawCmd::ArmChip {
                    x: cx,
                    y: cy,
                    w: 120.0,
                    h: 44.0,
                });
                banners.push(Banner::label("스프레이", cx, cy));
            }
            _ => {}
        }

        if !self.has_catchables() {
            self.tool = OverlayTool::None;
        }

        self.tick_presence(now, width, height, dt, &mut cmds, &mut banners);

        Frame { cmds, banners }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fly_count(engine: &Engine) -> usize {
        engine.sprites.iter().filter(|s| s.kind.is_fly()).count()
    }

    #[test]
    fn fly_burst_clamps_and_draws() {
        let mut e = Engine::default();
        e.spawn_n(
            ActionKind::Fly,
            Some(7),
            800.0,
            600.0,
            99,
            Some("실험실".into()),
            None,
        );
        assert_eq!(fly_count(&e), MAX_FLY_BURST as usize);
        assert!(e.has_catchables());
        assert_eq!(e.frame_sleep_ms(), 33);
        let frame = e.tick(Instant::now(), 800.0, 600.0, None);
        let flies = frame
            .cmds
            .iter()
            .filter(|c| matches!(c, DrawCmd::Fly { .. }))
            .count();
        assert_eq!(flies, MAX_FLY_BURST as usize);
        assert!(frame
            .cmds
            .iter()
            .any(|c| matches!(c, DrawCmd::ArmChip { .. })));
        assert!(frame.banners.iter().any(|b| b.text.contains("똥파리")));
    }

    #[test]
    fn fly_cap_drops_oldest() {
        let mut e = Engine::default();
        for _ in 0..4 {
            e.spawn_n(ActionKind::Fly, Some(1), 800.0, 600.0, MAX_FLY_BURST, None, None);
        }
        assert_eq!(fly_count(&e), MAX_FLIES);
    }

    #[test]
    fn spray_removes_flies_in_radius() {
        let mut e = Engine::default();
        e.spawn_n(ActionKind::Fly, Some(3), 400.0, 400.0, 8, None, None);
        assert_eq!(fly_count(&e), 8);
        assert!(e.try_spray(200.0, 200.0, 1000.0));
        assert_eq!(fly_count(&e), 0);
        assert!(!e.has_catchables());
    }

    #[test]
    fn spray_chip_click_arms_tool() {
        let mut e = Engine::default();
        e.spawn_n(ActionKind::Fly, Some(3), 800.0, 600.0, 2, None, None);
        let (cx, cy) = Engine::arm_chip_center(800.0, 600.0);
        assert!(e.on_click(cx, cy, 800.0, 600.0));
        assert_eq!(e.tool(), OverlayTool::Spray);
    }

    #[test]
    fn weapon_swings_are_not_hearts() {
        assert_eq!(ActionKind::parse("slash"), ActionKind::Slash);
        assert_eq!(ActionKind::parse("blunt"), ActionKind::Blunt);
        assert_eq!(ActionKind::parse("shot"), ActionKind::Shot);
        let mut e = Engine::default();
        e.spawn_n(ActionKind::Slash, Some(1), 800.0, 600.0, 1, None, None);
        let frame = e.tick(std::time::Instant::now(), 800.0, 600.0, None);
        assert!(frame.cmds.iter().any(|cmd| matches!(cmd, DrawCmd::Ray { .. })));
        assert!(frame.cmds.iter().all(|cmd| !matches!(cmd, DrawCmd::Heart { .. } | DrawCmd::Cat { .. })));
    }
}
