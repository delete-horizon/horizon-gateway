use tiny_skia::{Color, FillRule, Paint, PathBuilder, Pixmap, Stroke, Transform};

use super::engine::{DrawCmd, Frame};

pub fn rasterize(frame: &Frame, width: u32, height: u32) -> Option<Pixmap> {
    let mut pixmap = Pixmap::new(width, height)?;
    // fully transparent background
    pixmap.fill(Color::from_rgba8(0, 0, 0, 0));

    for cmd in &frame.cmds {
        match *cmd {
            DrawCmd::Circle { x, y, r, rgba } => {
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
    Some(pixmap)
}
