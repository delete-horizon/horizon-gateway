use tiny_skia::{Color, FillRule, Paint, PathBuilder, Pixmap, Stroke, Transform};

use super::engine::{DrawCmd, Frame};

pub fn rasterize(frame: &Frame, width: u32, height: u32) -> Option<Pixmap> {
    let mut pixmap = Pixmap::new(width, height)?;
    rasterize_into(frame, &mut pixmap);
    Some(pixmap)
}

/// Reuse an existing pixmap buffer (avoids full-screen realloc every frame).
pub fn rasterize_into(frame: &Frame, pixmap: &mut Pixmap) {
    pixmap.fill(Color::from_rgba8(0, 0, 0, 0));

    for cmd in &frame.cmds {
        match *cmd {
            DrawCmd::Circle { x, y, r, rgba } => fill_circle(pixmap, x, y, r, rgba),
            DrawCmd::Ring {
                x,
                y,
                r,
                stroke,
                rgba,
            } => stroke_circle(pixmap, x, y, r, stroke, rgba),
            DrawCmd::Star {
                x,
                y,
                outer,
                inner,
                rot,
                rgba,
            } => fill_star(pixmap, x, y, outer, inner, rot, rgba),
            DrawCmd::Heart { x, y, size, rgba } => fill_heart(pixmap, x, y, size, rgba),
            DrawCmd::Cat {
                x,
                y,
                scale,
                rot,
                tint,
                alpha,
                mood,
            } => draw_cat(pixmap, x, y, scale, rot, tint, alpha, mood),
            DrawCmd::Glow {
                x,
                y,
                r,
                rgba,
                layers,
            } => draw_glow(pixmap, x, y, r, rgba, layers),
            DrawCmd::Ray {
                x,
                y,
                len,
                width,
                rot,
                rgba,
            } => draw_ray(pixmap, x, y, len, width, rot, rgba),
            DrawCmd::Coffee {
                x,
                y,
                scale,
                rot,
                alpha,
                offer,
            } => draw_coffee(pixmap, x, y, scale, rot, alpha, offer),
            DrawCmd::Fly {
                x,
                y,
                scale,
                rot,
                wing,
                alpha,
            } => draw_fly(pixmap, x, y, scale, rot, wing, alpha),
            DrawCmd::Swatter {
                x,
                y,
                scale,
                rot,
                alpha,
            } => draw_swatter(pixmap, x, y, scale, rot, alpha),
            DrawCmd::Mark {
                x,
                y,
                scale,
                kind,
                rgba,
            } => draw_mark(pixmap, x, y, scale, kind, rgba),
        }
    }
}

fn paint_rgba(rgba: [u8; 4]) -> Paint<'static> {
    let mut paint = Paint::default();
    paint.set_color_rgba8(rgba[0], rgba[1], rgba[2], rgba[3]);
    paint.anti_alias = true;
    paint
}

fn fill_path(pixmap: &mut Pixmap, path: tiny_skia::Path, rgba: [u8; 4]) {
    if rgba[3] == 0 {
        return;
    }
    pixmap.fill_path(
        &path,
        &paint_rgba(rgba),
        FillRule::Winding,
        Transform::identity(),
        None,
    );
}

fn fill_circle(pixmap: &mut Pixmap, x: f32, y: f32, r: f32, rgba: [u8; 4]) {
    if !r.is_finite() || r < 0.4 || rgba[3] == 0 {
        return;
    }
    let mut pb = PathBuilder::new();
    pb.push_circle(x, y, r);
    if let Some(path) = pb.finish() {
        fill_path(pixmap, path, rgba);
    }
}

fn stroke_circle(pixmap: &mut Pixmap, x: f32, y: f32, r: f32, stroke: f32, rgba: [u8; 4]) {
    if !r.is_finite() || r < 0.4 || !stroke.is_finite() || stroke <= 0.0 || rgba[3] == 0 {
        return;
    }
    let mut pb = PathBuilder::new();
    pb.push_circle(x, y, r);
    if let Some(path) = pb.finish() {
        let stroke = Stroke {
            width: stroke,
            ..Stroke::default()
        };
        pixmap.stroke_path(&path, &paint_rgba(rgba), &stroke, Transform::identity(), None);
    }
}

fn draw_glow(pixmap: &mut Pixmap, x: f32, y: f32, r: f32, rgba: [u8; 4], layers: u8) {
    if !r.is_finite() || r < 0.5 || layers == 0 {
        return;
    }
    let n = layers.max(1) as f32;
    for i in 0..layers {
        let k = (i as f32 + 1.0) / n;
        let rr = r * k;
        let aa = (rgba[3] as f32 * (1.0 - k * 0.85)).round().clamp(0.0, 255.0) as u8;
        fill_circle(pixmap, x, y, rr, [rgba[0], rgba[1], rgba[2], aa]);
    }
}

fn fill_star(
    pixmap: &mut Pixmap,
    cx: f32,
    cy: f32,
    outer: f32,
    inner: f32,
    rot: f32,
    rgba: [u8; 4],
) {
    if outer < 0.5 || rgba[3] == 0 {
        return;
    }
    let mut pb = PathBuilder::new();
    let points = 5usize;
    for i in 0..(points * 2) {
        let radius = if i % 2 == 0 { outer } else { inner.max(0.2) };
        let ang = rot + i as f32 * std::f32::consts::PI / points as f32 - std::f32::consts::FRAC_PI_2;
        let x = cx + ang.cos() * radius;
        let y = cy + ang.sin() * radius;
        if i == 0 {
            pb.move_to(x, y);
        } else {
            pb.line_to(x, y);
        }
    }
    pb.close();
    if let Some(path) = pb.finish() {
        fill_path(pixmap, path, rgba);
    }
}

fn fill_heart(pixmap: &mut Pixmap, cx: f32, cy: f32, size: f32, rgba: [u8; 4]) {
    if size < 0.8 || rgba[3] == 0 {
        return;
    }
    // Simple heart from two circles + triangle-ish bottom via cubic approx.
    let s = size;
    let mut pb = PathBuilder::new();
    pb.move_to(cx, cy + s * 0.35);
    pb.cubic_to(
        cx + s * 1.1,
        cy - s * 0.25,
        cx + s * 0.55,
        cy - s * 1.05,
        cx,
        cy - s * 0.35,
    );
    pb.cubic_to(
        cx - s * 0.55,
        cy - s * 1.05,
        cx - s * 1.1,
        cy - s * 0.25,
        cx,
        cy + s * 0.35,
    );
    pb.close();
    if let Some(path) = pb.finish() {
        fill_path(pixmap, path, rgba);
    }
}

fn draw_ray(pixmap: &mut Pixmap, x: f32, y: f32, len: f32, width: f32, rot: f32, rgba: [u8; 4]) {
    if len < 1.0 || width < 0.3 || rgba[3] == 0 {
        return;
    }
    let c = rot.cos();
    let s = rot.sin();
    let hw = width * 0.5;
    // Tapered quad from center outward.
    let tip_x = x + c * len;
    let tip_y = y + s * len;
    let px = -s * hw;
    let py = c * hw;
    let tip_hw = hw * 0.15;
    let tpx = -s * tip_hw;
    let tpy = c * tip_hw;

    let mut pb = PathBuilder::new();
    pb.move_to(x + px, y + py);
    pb.line_to(tip_x + tpx, tip_y + tpy);
    pb.line_to(tip_x - tpx, tip_y - tpy);
    pb.line_to(x - px, y - py);
    pb.close();
    if let Some(path) = pb.finish() {
        fill_path(pixmap, path, rgba);
    }
}

fn rot2(cx: f32, cy: f32, x: f32, y: f32, rot: f32) -> (f32, f32) {
    let dx = x - cx;
    let dy = y - cy;
    let c = rot.cos();
    let s = rot.sin();
    (cx + dx * c - dy * s, cy + dx * s + dy * c)
}

fn draw_cat(
    pixmap: &mut Pixmap,
    cx: f32,
    cy: f32,
    scale: f32,
    rot: f32,
    tint: [u8; 3],
    alpha: u8,
    mood: u8,
) {
    if scale < 4.0 || alpha == 0 {
        return;
    }
    let s = scale;
    let a = |k: f32| ((alpha as f32) * k).round().clamp(0.0, 255.0) as u8;
    let fur = [tint[0], tint[1], tint[2], a(1.0)];
    let ear = [
        tint[0].saturating_sub(20),
        tint[1].saturating_sub(25),
        tint[2].saturating_sub(15),
        a(1.0),
    ];
    let inner_ear = [255, 170, 190, a(0.85)];
    let eye_w = [40, 40, 50, a(1.0)];
    let nose = [255, 140, 170, a(0.95)];
    let blush = [255, 150, 170, a(if mood == 1 { 0.15 } else { 0.35 })];

    let p = |x: f32, y: f32| rot2(cx, cy, cx + x * s, cy + y * s, rot);

    // Ears
    for side in [-1.0_f32, 1.0] {
        let (tx, ty) = p(side * 0.55, -0.95);
        let (bx1, by1) = p(side * 0.15, -0.35);
        let (bx2, by2) = p(side * 0.85, -0.25);
        let mut pb = PathBuilder::new();
        pb.move_to(tx, ty);
        pb.line_to(bx1, by1);
        pb.line_to(bx2, by2);
        pb.close();
        if let Some(path) = pb.finish() {
            fill_path(pixmap, path, ear);
        }
        let (itx, ity) = p(side * 0.55, -0.78);
        let (ib1x, ib1y) = p(side * 0.32, -0.38);
        let (ib2x, ib2y) = p(side * 0.72, -0.32);
        let mut pb = PathBuilder::new();
        pb.move_to(itx, ity);
        pb.line_to(ib1x, ib1y);
        pb.line_to(ib2x, ib2y);
        pb.close();
        if let Some(path) = pb.finish() {
            fill_path(pixmap, path, inner_ear);
        }
    }

    let (hx, hy) = p(0.0, 0.0);
    fill_circle(pixmap, hx, hy, s * 0.72, fur);

    let (blx, bly) = p(-0.38, 0.18);
    let (brx, bry) = p(0.38, 0.18);
    fill_circle(pixmap, blx, bly, s * 0.14, blush);
    fill_circle(pixmap, brx, bry, s * 0.14, blush);

    // Eyes — mood changes expression
    let (elx, ely) = p(-0.26, if mood == 1 { 0.0 } else { -0.05 });
    let (erx, ery) = p(0.26, if mood == 1 { 0.0 } else { -0.05 });
    if mood == 2 {
        // derp: mismatched eyes
        fill_circle(pixmap, elx, ely, s * 0.18, eye_w);
        fill_circle(pixmap, erx, ery + s * 0.06, s * 0.12, eye_w);
        fill_circle(pixmap, elx, ely, s * 0.07, [30, 30, 40, a(1.0)]);
        fill_circle(pixmap, erx + s * 0.02, ery + s * 0.06, s * 0.05, [30, 30, 40, a(1.0)]);
    } else {
        fill_circle(pixmap, elx, ely, s * 0.16, eye_w);
        fill_circle(pixmap, erx, ery, s * 0.16, eye_w);
        let pupil = if mood == 1 { s * 0.1 } else { s * 0.08 };
        fill_circle(pixmap, elx, ely + if mood == 1 { s * 0.02 } else { 0.0 }, pupil, [30, 30, 40, a(1.0)]);
        fill_circle(pixmap, erx, ery + if mood == 1 { s * 0.02 } else { 0.0 }, pupil, [30, 30, 40, a(1.0)]);
        fill_circle(pixmap, elx - s * 0.04, ely - s * 0.04, s * 0.035, [255, 255, 255, a(0.95)]);
        fill_circle(pixmap, erx - s * 0.04, ery - s * 0.04, s * 0.035, [255, 255, 255, a(0.95)]);
    }

    // Angry brows
    if mood == 1 {
        let stroke = Stroke {
            width: (s * 0.07).max(1.5),
            ..Stroke::default()
        };
        let brow = paint_rgba([60, 40, 40, a(0.95)]);
        for side in [-1.0_f32, 1.0] {
            let (x0, y0) = p(side * 0.12, -0.28);
            let (x1, y1) = p(side * 0.42, -0.38);
            let mut pb = PathBuilder::new();
            pb.move_to(x0, y0);
            pb.line_to(x1, y1);
            if let Some(path) = pb.finish() {
                pixmap.stroke_path(&path, &brow, &stroke, Transform::identity(), None);
            }
        }
    }

    // Nose
    let mut pb = PathBuilder::new();
    let (n1x, n1y) = p(-0.08, 0.12);
    let (n2x, n2y) = p(0.08, 0.12);
    let (n3x, n3y) = p(0.0, 0.26);
    pb.move_to(n1x, n1y);
    pb.line_to(n2x, n2y);
    pb.line_to(n3x, n3y);
    pb.close();
    if let Some(path) = pb.finish() {
        fill_path(pixmap, path, nose);
    }

    // Whiskers
    let whisker = Stroke {
        width: (s * 0.04).max(1.0),
        ..Stroke::default()
    };
    let wcol = paint_rgba([90, 80, 90, a(0.55)]);
    for side in [-1.0_f32, 1.0] {
        for (oy, ol) in [(-0.02_f32, 0.55_f32), (0.08, 0.6), (0.18, 0.52)] {
            let (x0, y0) = p(side * 0.35, oy);
            let (x1, y1) = p(side * (0.35 + ol), oy + side * 0.02);
            let mut pb = PathBuilder::new();
            pb.move_to(x0, y0);
            pb.line_to(x1, y1);
            if let Some(path) = pb.finish() {
                pixmap.stroke_path(&path, &wcol, &whisker, Transform::identity(), None);
            }
        }
    }

    // Mouth
    let mut pb = PathBuilder::new();
    if mood == 1 {
        // flat annoyed mouth
        let (m0x, m0y) = p(-0.14, 0.38);
        let (m1x, m1y) = p(0.14, 0.36);
        pb.move_to(m0x, m0y);
        pb.line_to(m1x, m1y);
    } else if mood == 2 {
        let (m0x, m0y) = p(-0.1, 0.34);
        let (m1x, m1y) = p(0.05, 0.48);
        let (m2x, m2y) = p(0.16, 0.3);
        pb.move_to(m0x, m0y);
        pb.quad_to(m1x, m1y, m2x, m2y);
    } else {
        let (m0x, m0y) = p(-0.12, 0.32);
        let (m1x, m1y) = p(0.0, 0.40);
        let (m2x, m2y) = p(0.12, 0.32);
        pb.move_to(m0x, m0y);
        pb.quad_to(m1x, m1y, m2x, m2y);
    }
    if let Some(path) = pb.finish() {
        let smile = Stroke {
            width: (s * 0.05).max(1.0),
            ..Stroke::default()
        };
        pixmap.stroke_path(
            &path,
            &paint_rgba([120, 90, 100, a(0.75)]),
            &smile,
            Transform::identity(),
            None,
        );
    }
}

fn draw_coffee(
    pixmap: &mut Pixmap,
    cx: f32,
    cy: f32,
    scale: f32,
    rot: f32,
    alpha: u8,
    offer: bool,
) {
    if scale < 4.0 || alpha == 0 {
        return;
    }
    let s = scale;
    let a = |k: f32| ((alpha as f32) * k).round().clamp(0.0, 255.0) as u8;
    let cup = if offer {
        [255, 236, 210, a(1.0)]
    } else {
        [240, 230, 255, a(1.0)]
    };
    let coffee = [90, 50, 30, a(0.95)];
    let steam = [200, 200, 210, a(0.45)];
    let p = |x: f32, y: f32| rot2(cx, cy, cx + x * s, cy + y * s, rot);

    // Cup body
    let mut pb = PathBuilder::new();
    let (tlx, tly) = p(-0.45, -0.15);
    let (trx, try_) = p(0.45, -0.15);
    let (brx, bry) = p(0.32, 0.55);
    let (blx, bly) = p(-0.32, 0.55);
    pb.move_to(tlx, tly);
    pb.line_to(trx, try_);
    pb.line_to(brx, bry);
    pb.line_to(blx, bly);
    pb.close();
    if let Some(path) = pb.finish() {
        fill_path(pixmap, path, cup);
    }
    // Coffee surface
    fill_circle(
        pixmap,
        p(0.0, -0.08).0,
        p(0.0, -0.08).1,
        s * 0.38,
        coffee,
    );
    // Handle
    let (hx, hy) = p(0.55, 0.15);
    stroke_circle(
        pixmap,
        hx,
        hy,
        s * 0.18,
        s * 0.07,
        [
            cup[0].saturating_sub(40),
            cup[1].saturating_sub(40),
            cup[2].saturating_sub(40),
            a(0.9),
        ],
    );
    // Steam
    for i in 0..3 {
        let ox = (i as f32 - 1.0) * 0.18;
        let (sx, sy) = p(ox, -0.35 - i as f32 * 0.08);
        fill_circle(pixmap, sx, sy, s * 0.06, steam);
        fill_circle(pixmap, sx + s * 0.04, sy - s * 0.12, s * 0.05, steam);
    }
    // Heart on offer
    if offer {
        let (hx, hy) = p(0.0, 0.2);
        fill_heart(pixmap, hx, hy, s * 0.14, [255, 120, 150, a(0.9)]);
    } else {
        // ask: small "?"
        draw_mark(pixmap, p(0.0, 0.18).0, p(0.0, 0.18).1, s * 0.2, 2, [80, 50, 40, a(0.85)]);
    }
}

fn draw_fly(pixmap: &mut Pixmap, cx: f32, cy: f32, scale: f32, rot: f32, wing: f32, alpha: u8) {
    if scale < 2.0 || alpha == 0 {
        return;
    }
    let s = scale;
    let a = |k: f32| ((alpha as f32) * k).round().clamp(0.0, 255.0) as u8;
    let body = [35, 30, 28, a(1.0)];
    let wing_c = [180, 190, 200, a(0.45)];
    let p = |x: f32, y: f32| rot2(cx, cy, cx + x * s, cy + y * s, rot);
    let flap = wing.sin().abs();

    // Wings
    for side in [-1.0_f32, 1.0] {
        let mut pb = PathBuilder::new();
        let (bx, by) = p(0.0, 0.0);
        let (wx, wy) = p(side * (0.9 + flap * 0.5), -0.5 - flap * 0.3);
        let (wx2, wy2) = p(side * 0.5, 0.2);
        pb.move_to(bx, by);
        pb.quad_to(wx, wy, wx2, wy2);
        pb.close();
        if let Some(path) = pb.finish() {
            fill_path(pixmap, path, wing_c);
        }
    }
    // Body
    let (bx, by) = p(0.0, 0.0);
    fill_circle(pixmap, bx, by, s * 0.45, body);
    let (hx, hy) = p(0.0, -0.45);
    fill_circle(pixmap, hx, hy, s * 0.28, body);
    // Eyes
    fill_circle(pixmap, p(-0.12, -0.5).0, p(-0.12, -0.5).1, s * 0.1, [255, 220, 80, a(1.0)]);
    fill_circle(pixmap, p(0.12, -0.5).0, p(0.12, -0.5).1, s * 0.1, [255, 220, 80, a(1.0)]);
}

fn draw_swatter(pixmap: &mut Pixmap, cx: f32, cy: f32, scale: f32, rot: f32, alpha: u8) {
    if scale < 0.4 || alpha == 0 {
        return;
    }
    let s = 42.0 * scale;
    let a = |k: f32| ((alpha as f32) * k).round().clamp(0.0, 255.0) as u8;
    let p = |x: f32, y: f32| rot2(cx, cy, cx + x * s, cy + y * s, rot);
    let handle = [120, 72, 40, a(0.95)];
    let head = [55, 120, 200, a(0.55)];
    let mesh = [40, 90, 170, a(0.75)];

    // Handle
    let mut pb = PathBuilder::new();
    let (h0x, h0y) = p(0.05, 0.15);
    let (h1x, h1y) = p(0.12, 0.95);
    let (h2x, h2y) = p(-0.02, 0.98);
    let (h3x, h3y) = p(-0.08, 0.18);
    pb.move_to(h0x, h0y);
    pb.line_to(h1x, h1y);
    pb.line_to(h2x, h2y);
    pb.line_to(h3x, h3y);
    pb.close();
    if let Some(path) = pb.finish() {
        fill_path(pixmap, path, handle);
    }

    // Head oval
    let (hx, hy) = p(0.0, -0.35);
    fill_circle(pixmap, hx, hy, s * 0.42, head);
    stroke_circle(pixmap, hx, hy, s * 0.42, 2.2, mesh);

    // Mesh grid
    for i in -2..=2 {
        let t = i as f32 * 0.14;
        let (ax, ay) = p(t, -0.68);
        let (bx, by) = p(t, -0.02);
        let mut line = PathBuilder::new();
        line.move_to(ax, ay);
        line.line_to(bx, by);
        if let Some(path) = line.finish() {
            let stroke = Stroke {
                width: 1.4,
                ..Stroke::default()
            };
            pixmap.stroke_path(&path, &paint_rgba(mesh), &stroke, Transform::identity(), None);
        }
        let (ax, ay) = p(-0.28, -0.35 + t);
        let (bx, by) = p(0.28, -0.35 + t);
        let mut line = PathBuilder::new();
        line.move_to(ax, ay);
        line.line_to(bx, by);
        if let Some(path) = line.finish() {
            let stroke = Stroke {
                width: 1.4,
                ..Stroke::default()
            };
            pixmap.stroke_path(&path, &paint_rgba(mesh), &stroke, Transform::identity(), None);
        }
    }
}

fn draw_mark(pixmap: &mut Pixmap, x: f32, y: f32, scale: f32, kind: u8, rgba: [u8; 4]) {
    if scale < 2.0 || rgba[3] == 0 {
        return;
    }
    match kind {
        0 => {
            // 💢-like vein burst
            for i in 0..4 {
                let ang = i as f32 * std::f32::consts::FRAC_PI_2 + 0.4;
                let mut pb = PathBuilder::new();
                pb.move_to(x, y);
                pb.line_to(x + ang.cos() * scale, y + ang.sin() * scale);
                if let Some(path) = pb.finish() {
                    let stroke = Stroke {
                        width: (scale * 0.22).max(1.5),
                        ..Stroke::default()
                    };
                    pixmap.stroke_path(&path, &paint_rgba(rgba), &stroke, Transform::identity(), None);
                }
            }
            fill_circle(pixmap, x, y, scale * 0.25, rgba);
        }
        1 => {
            // sweat drop
            let mut pb = PathBuilder::new();
            pb.move_to(x, y - scale * 0.6);
            pb.quad_to(x + scale * 0.45, y + scale * 0.1, x, y + scale * 0.55);
            pb.quad_to(x - scale * 0.45, y + scale * 0.1, x, y - scale * 0.6);
            pb.close();
            if let Some(path) = pb.finish() {
                fill_path(pixmap, path, rgba);
            }
        }
        _ => {
            // "ㅋ"-ish blob glyph (two arcs)
            let stroke = Stroke {
                width: (scale * 0.22).max(1.2),
                ..Stroke::default()
            };
            let mut pb = PathBuilder::new();
            pb.move_to(x - scale * 0.35, y - scale * 0.35);
            pb.quad_to(x, y - scale * 0.55, x + scale * 0.2, y - scale * 0.15);
            pb.line_to(x - scale * 0.05, y + scale * 0.35);
            if let Some(path) = pb.finish() {
                pixmap.stroke_path(&path, &paint_rgba(rgba), &stroke, Transform::identity(), None);
            }
            let mut pb = PathBuilder::new();
            pb.move_to(x + scale * 0.05, y - scale * 0.05);
            pb.quad_to(x + scale * 0.45, y + scale * 0.05, x + scale * 0.15, y + scale * 0.4);
            if let Some(path) = pb.finish() {
                pixmap.stroke_path(&path, &paint_rgba(rgba), &stroke, Transform::identity(), None);
            }
        }
    }
}
