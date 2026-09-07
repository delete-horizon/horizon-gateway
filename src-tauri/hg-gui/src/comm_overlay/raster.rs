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
            DrawCmd::Circle { x, y, r, rgba } => {
                if !r.is_finite() || r < 0.5 {
                    continue;
                }
                let mut pb = PathBuilder::new();
                pb.push_circle(x, y, r);
                if let Some(path) = pb.finish() {
                    let mut paint = Paint::default();
                    paint.set_color_rgba8(rgba[0], rgba[1], rgba[2], rgba[3]);
                    paint.anti_alias = true;
                    pixmap.fill_path(
                        &path,
                        &paint,
                        FillRule::Winding,
                        Transform::identity(),
                        None,
                    );
                }
            }
            DrawCmd::Ring {
                x,
                y,
                r,
                stroke,
                rgba,
            } => {
                if !r.is_finite() || r < 0.5 || !stroke.is_finite() || stroke <= 0.0 {
                    continue;
                }
                let mut pb = PathBuilder::new();
                pb.push_circle(x, y, r);
                if let Some(path) = pb.finish() {
                    let mut paint = Paint::default();
                    paint.set_color_rgba8(rgba[0], rgba[1], rgba[2], rgba[3]);
                    paint.anti_alias = true;
                    let stroke = Stroke {
                        width: stroke,
                        ..Stroke::default()
                    };
                    pixmap.stroke_path(&path, &paint, &stroke, Transform::identity(), None);
                }
            }
        }
    }
}
