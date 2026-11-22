//! Codec used by Journal's ink.ts. Coordinates are note-local quarter pixels.
use crate::{InkDocument, InkShape};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::fmt::Write;

pub type Point = [f32; 3];
fn unpack([x, y, pressure]: [i64; 3]) -> Point {
    [x as f32 / 4., y as f32 / 4., pressure as f32 / 1000.]
}

// Preview exactly the samples a Journal reader will recover, including subdivision
// when a jump is too large for a signed 16-bit delta.
fn journal_samples(points: &[Point], mut visit: impl FnMut([i64; 3])) {
    let mut previous = [0i64; 3];
    for &[x, y, p] in points {
        let dest = [
            (x * 4.).round() as i32 as i64,
            (y * 4.).round() as i32 as i64,
            (p.clamp(0., 1.) * 1000.).round() as i64,
        ];
        let dx = dest[0] - previous[0];
        let dy = dest[1] - previous[1];
        let steps = (dx.unsigned_abs().max(dy.unsigned_abs()).div_ceil(32767) as i64).max(1);
        for i in 1..steps {
            visit([
                previous[0] + (dx as f64 * i as f64 / steps as f64).round() as i64,
                previous[1] + (dy as f64 * i as f64 / steps as f64).round() as i64,
                dest[2],
            ]);
        }
        visit(dest);
        previous = dest;
    }
}

pub fn encode(points: &[Point]) -> String {
    let mut bytes = Vec::with_capacity(points.len() * 6);
    let mut last = [0; 3];
    journal_samples(points, |p| {
        for j in 0..3 {
            bytes.extend_from_slice(&((p[j] - last[j]) as i16).to_le_bytes());
        }
        last = p;
    });
    STANDARD.encode(bytes)
}
pub fn decode(s: &str) -> Vec<Point> {
    let mut p = [0i64; 3];
    STANDARD
        .decode(s)
        .unwrap_or_default()
        .chunks_exact(6)
        .map(|v| {
            for j in 0..3 {
                p[j] += i16::from_le_bytes([v[2 * j], v[2 * j + 1]]) as i64;
            }
            unpack(p)
        })
        .collect()
}
#[derive(Clone, serde::Deserialize, serde::Serialize)]
#[serde(default)]
pub struct Prefs {
    pub tool: String,
    pub color: String,
    pub size: f32,
    pub pressure: bool,
    pub presets: std::collections::BTreeMap<String, (f32, String)>,
    pub recent: Vec<String>,
}
impl Prefs {
    pub fn select(&mut self, tool: &str) {
        self.presets.insert(self.tool.clone(), (self.size, self.color.clone()));
        let defaults = match tool {
            "marker" => (14., "#ffe14d"),
            "eraser" => (18., ""),
            "pencil" => (2., ""),
            _ => (3., ""),
        };
        let (size, color) = self
            .presets
            .get(tool)
            .cloned()
            .unwrap_or_else(|| (defaults.0, defaults.1.into()));
        self.size = size;
        self.color = color;
        self.tool = tool.into();
    }
    pub fn remember(&mut self, value: String) {
        self.recent.retain(|c| *c != value);
        if !value.is_empty() {
            self.recent.insert(0, value.clone());
            self.recent.truncate(6);
        }
        self.color = value;
    }
}
impl Default for Prefs {
    fn default() -> Self {
        Self {
            tool: "pen".into(),
            color: String::new(),
            size: 3.,
            pressure: true,
            presets: Default::default(),
            recent: vec![],
        }
    }
}
#[derive(Default)]
pub struct Tools {
    pub prefs: Prefs,
    pub path: Vec<Point>,
    pub selected: BTreeSet<usize>,
    pub pan: [f32; 2],
    pub hardware_eraser: bool,
    pub down: bool,
    pub moving: bool,
}
fn points(s: &Value) -> Vec<Point> {
    decode(s["points"].as_str().unwrap_or(""))
}
fn stroke(s: &Value, p: &[Point]) -> Value {
    let mut n = s.clone();
    n["points"] = json!(encode(p));
    n
}
pub fn strokes(c: &Value) -> Vec<Value> {
    c["ink"]["strokes"].as_array().cloned().unwrap_or_default()
}
fn dist(a: Point, b: Point) -> f32 {
    (a[0] - b[0]).hypot(a[1] - b[1])
}
fn distance(p: Point, a: Point, b: Point) -> f32 {
    let (x, y) = (b[0] - a[0], b[1] - a[1]);
    let t = (((p[0] - a[0]) * x + (p[1] - a[1]) * y) / (x * x + y * y).max(0.0001)).clamp(0., 1.);
    (p[0] - a[0] - t * x).hypot(p[1] - a[1] - t * y)
}
fn inside(p: Point, polygon: &[Point]) -> bool {
    if polygon.len() < 3 {
        return false;
    }
    let mut yes = false;
    let mut a = polygon[polygon.len() - 1];
    for &b in polygon {
        if (a[1] > p[1]) != (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0] {
            yes = !yes;
        }
        a = b;
    }
    yes
}
impl Tools {
    pub fn start(&mut self, at: Point, card: &Value, eraser: bool) {
        self.path.clear();
        self.down = true;
        self.hardware_eraser = eraser;
        self.moving = false;
        if !eraser && matches!(self.prefs.tool.as_str(), "rect" | "lasso") {
            let strokes = strokes(card);
            let mut bounds = [f32::MAX, f32::MAX, f32::MIN, f32::MIN];
            for p in self.selected.iter().filter_map(|i| strokes.get(*i)).flat_map(points) {
                bounds = [
                    bounds[0].min(p[0]),
                    bounds[1].min(p[1]),
                    bounds[2].max(p[0]),
                    bounds[3].max(p[1]),
                ];
            }
            self.moving = at[0] >= bounds[0] - 3.
                && at[1] >= bounds[1] - 3.
                && at[0] <= bounds[2] + 3.
                && at[1] <= bounds[3] + 3.;
        }
    }
    pub fn pen(&self) -> Value {
        json!({"tool":self.prefs.tool,"size":self.prefs.size,"pressure":self.prefs.pressure,"color":self.prefs.color,"points":encode(&self.path)})
    }
    pub fn finish(&mut self, list: &[Value]) -> Option<Value> {
        if self.path.is_empty() {
            return None;
        }
        if self.moving {
            self.moving = false;
            let a = self.path[0];
            let z = self.path.last().unwrap();
            return Some(self.modify(list, "move", z[0] - a[0], z[1] - a[1]));
        }
        let mut out = vec![];
        let tool = if self.hardware_eraser {
            "eraser"
        } else {
            &self.prefs.tool
        };
        match tool {
            "rect" => {
                self.selected.clear();
                let a = self.path[0];
                let b = *self.path.last().unwrap();
                for (i, s) in list.iter().enumerate() {
                    let pts = points(s);
                    if !pts.is_empty()
                        && pts.iter().all(|p| {
                            p[0] >= a[0].min(b[0])
                                && p[0] <= a[0].max(b[0])
                                && p[1] >= a[1].min(b[1])
                                && p[1] <= a[1].max(b[1])
                        })
                    {
                        self.selected.insert(i);
                    }
                }
                return None;
            }
            "eraser" | "lasso" => {
                let lasso = tool == "lasso";
                self.selected.clear();
                for s in list {
                    let radius = (self.prefs.size / 2.).max(2.) + s["size"].as_f64().unwrap_or(3.) as f32 / 2.;
                    let mut run = vec![];
                    let mut prev = None;
                    let pts = points(s);
                    let mut pieces = vec![];
                    let hit = |p| {
                        if lasso {
                            inside(p, &self.path)
                        } else {
                            dist(p, self.path[0]) <= radius
                                || self.path.windows(2).any(|w| distance(p, w[0], w[1]) <= radius)
                        }
                    };
                    let mut sample = |p| {
                        let h = hit(p);
                        if prev.is_some_and(|v| v != h) {
                            pieces.push((prev.unwrap(), std::mem::take(&mut run)));
                        }
                        prev = Some(h);
                        run.push(p);
                    };
                    if let Some(first) = pts.first() {
                        sample(*first);
                    }
                    for pair in pts.windows(2) {
                        let (a, b) = (pair[0], pair[1]);
                        let n = (dist(a, b) / 2.).ceil().clamp(1., 2048.) as u32;
                        for j in 1..=n {
                            sample(std::array::from_fn(|k| a[k] + (b[k] - a[k]) * j as f32 / n as f32));
                        }
                    }
                    if let Some(h) = prev {
                        pieces.push((h, run));
                    }
                    if pieces.len() == 1 && (!pieces[0].0 || lasso) {
                        if pieces[0].0 {
                            self.selected.insert(out.len());
                        }
                        out.push(s.clone());
                    } else {
                        for (hit, piece) in pieces {
                            if hit && lasso {
                                self.selected.insert(out.len());
                            }
                            if !hit || lasso {
                                out.push(stroke(s, &piece));
                            }
                        }
                    }
                }
            }
            _ => {
                out.extend_from_slice(list);
                out.push(self.pen());
            }
        }
        (out != list).then(|| json!({"v":1,"strokes":out}))
    }
    pub fn modify(&self, list: &[Value], op: &str, dx: f32, dy: f32) -> Value {
        let mut out = vec![];
        let origin = self
            .selected
            .iter()
            .filter_map(|i| list.get(*i))
            .flat_map(points)
            .fold([f32::MAX; 2], |a, p| [a[0].min(p[0]), a[1].min(p[1])]);
        for (i, s) in list.iter().enumerate() {
            if !self.selected.contains(&i) {
                out.push(s.clone());
                continue;
            }
            let mut n = s.clone();
            match op {
                "delete" => continue,
                "color" => n["color"] = json!(self.prefs.color),
                "size" => n["size"] = json!(self.prefs.size),
                _ => {
                    let scale = if op == "scale" { dx } else { 1. };
                    let p: Vec<_> = points(s)
                        .into_iter()
                        .map(|p| {
                            [
                                origin[0] + (p[0] - origin[0]) * scale + if op == "move" { dx } else { 0. },
                                origin[1] + (p[1] - origin[1]) * scale + if op == "move" { dy } else { 0. },
                                p[2],
                            ]
                        })
                        .collect();
                    n = stroke(s, &p);
                }
            }
            out.push(n);
        }
        json!({"v":1,"strokes":out})
    }
}

// Integrate a short piece of the centerline by distance. A single quarter-pixel
// grid step is too short to establish the direction of a pressure-sensitive nib.
fn ink_neighborhood<'a>(at: Point, neighbors: impl Iterator<Item = &'a Point>) -> ([f32; 2], [f32; 2], f32) {
    const SPAN: f32 = 1.;
    let mut end = [at[0], at[1]];
    let mut mean = [0.; 2];
    let mut length = 0.;
    for p in neighbors {
        let delta = [p[0] - end[0], p[1] - end[1]];
        let step = delta[0].hypot(delta[1]);
        let used = step.min(SPAN - length);
        for axis in 0..2 {
            let next = end[axis] + delta[axis] * (used / step);
            mean[axis] += ((end[axis] - at[axis]) + (next - at[axis])) * 0.5 * used;
            end[axis] = next;
        }
        length += used;
        if length >= SPAN {
            break;
        }
    }
    if length > 0. {
        mean = mean.map(|v| v / length);
    }
    (end, mean, length)
}

// Lay down flecks of graphite inside the same quadratic ribbon as the base mark.
// Sampling by distance keeps their density independent of pen packet frequency.
fn pencil_grain(left: &[[f32; 2]], right: &[[f32; 2]], size: f32) -> String {
    let pitch = (size * 0.12).clamp(0.18, 1.2);
    let mut grain = String::new();
    let mut seed = 7u32;
    let mut noise = || {
        seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
        (seed >> 8) as f32 / 16777216.
    };
    let mut skip = pitch * 0.5;
    let lerp = |a: [f32; 2], b: [f32; 2], t: f32| [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    let mut stripe = |l0: [f32; 2], r0: [f32; 2], l1: [f32; 2], r1: [f32; 2]| {
        let (start, end) = (lerp(l0, r0, 0.5), lerp(l1, r1, 0.5));
        let length = (end[0] - start[0]).hypot(end[1] - start[1]);
        if length < f32::EPSILON {
            return;
        }
        // Very large imported segments still have bounded texture geometry.
        let advance = pitch.max(length / 512.);
        while skip < length {
            let t = skip / length;
            let (l, r) = (lerp(l0, l1, t), lerp(r0, r1, t));
            let (dx, dy) = (l[0] - r[0], l[1] - r[1]);
            let width = dx.hypot(dy);
            let lanes = (width / pitch).ceil().clamp(1., 48.) as u32;
            for j in 0..lanes {
                let across = (j as f32 + 0.2 + noise() * 0.6) / lanes as f32;
                let along = (noise() - 0.5) * pitch;
                let nx = dx / width.max(0.001);
                let ny = dy / width.max(0.001);
                let x = r[0] + across * dx - ny * along;
                let y = r[1] + across * dy + nx * along;
                let a = pitch * (0.22 + noise() * 0.55);
                let b = (width / lanes as f32) * (0.12 + noise() * 0.32);
                write!(
                    grain,
                    "M{:.2} {:.2}l{:.2} {:.2} {:.2} {:.2}Z",
                    x - ny * a,
                    y + nx * a,
                    ny * a + nx * b,
                    -nx * a + ny * b,
                    ny * a - 2. * nx * b,
                    -nx * a - 2. * ny * b
                )
                .unwrap();
            }
            skip += advance;
        }
        skip -= length;
    };
    for i in 0..left.len() {
        let prev = i.saturating_sub(1);
        let next = (i + 1).min(left.len() - 1);
        let section = |edge: &[[f32; 2]], t: f32| -> [f32; 2] {
            std::array::from_fn(|k| {
                edge[i][k]
                    + 0.5 * ((1. - t).powi(2) * (edge[prev][k] - edge[i][k]) + t * t * (edge[next][k] - edge[i][k]))
            })
        };
        let (mut l, mut r) = (section(left, 0.), section(right, 0.));
        let length = (left[next][0] - left[prev][0]).hypot(left[next][1] - left[prev][1]);
        let subdivisions = (length / (pitch * 4.)).ceil().clamp(1., 16.) as usize;
        for part in 1..=subdivisions {
            let t = part as f32 / subdivisions as f32;
            let (nl, nr) = (section(left, t), section(right, t));
            stripe(l, r, nl, nr);
            (l, r) = (nl, nr);
        }
    }
    grain
}

/// Fit one closed quadratic outline in document coordinates. Both the live tip and
/// the stored stroke use this path, including identical pressure and end caps.
fn outline(samples: &[Point], tool: &str, size: f32, pressure: bool, color: &str) -> InkShape {
    let size = size.clamp(0.5, 100.);
    let mut points: Vec<Point> = Vec::with_capacity(samples.len());
    for &p in samples {
        if let Some(prev) = points.last_mut() {
            if dist(*prev, p) < 0.06 {
                prev[2] = p[2];
                continue;
            }
        }
        points.push(p);
    }
    if points.is_empty() {
        return Default::default();
    }
    let radius = |p: Point| {
        size * 0.5
            * if pressure && tool != "marker" {
                0.3 + 0.7 * p[2].clamp(0., 1.)
            } else {
                1.
            }
    };
    let mut bounds = [f32::MAX, f32::MAX, f32::MIN, f32::MIN];
    for &p in &points {
        let pad = radius(p) + 1.;
        bounds = [
            bounds[0].min(p[0] - pad),
            bounds[1].min(p[1] - pad),
            bounds[2].max(p[0] + pad),
            bounds[3].max(p[1] + pad),
        ];
    }
    let mut d = String::new();
    let mut grain = String::new();
    let a = points[0];
    if points.len() == 1 {
        let r = radius(a);
        let (x, y) = (a[0], a[1]);
        if tool == "pencil" {
            let mut left = Vec::new();
            let mut right = Vec::new();
            for i in 0..=12 {
                let offset = r * (i as f32 / 6. - 1.);
                let half = (r * r - offset * offset).max(0.).sqrt();
                left.push([x + offset, y + half]);
                right.push([x + offset, y - half]);
            }
            grain = pencil_grain(&left, &right, size);
        }
        write!(
            d,
            "M{:.3} {y:.3}a{r:.3} {r:.3} 0 1 0 {:.3} 0a{r:.3} {r:.3} 0 1 0 {:.3} 0Z",
            x - r,
            2. * r,
            -2. * r
        )
        .unwrap();
    } else {
        let mut left = Vec::with_capacity(points.len());
        let mut right = Vec::with_capacity(points.len());
        for (i, &p) in points.iter().enumerate() {
            let (before, left_mean, back) = ink_neighborhood(p, points[..i].iter().rev());
            let (after, right_mean, ahead) = ink_neighborhood(p, points[i + 1..].iter());
            // Balance the shorter side near a tip so both endpoints stay at the contact position.
            let center: [f32; 2] = std::array::from_fn(|k| {
                p[k] + (left_mean[k] * ahead + right_mean[k] * back) / (back + ahead)
            });
            let (mut dx, mut dy) = (after[0] - before[0], after[1] - before[1]);
            if dx.hypot(dy) < 0.001 {
                let prev = points[i.saturating_sub(1)];
                (dx, dy) = (p[0] - prev[0], p[1] - prev[1]);
            }
            let r = radius(p) / dx.hypot(dy).max(0.001);
            left.push([center[0] - dy * r, center[1] + dx * r]);
            right.push([center[0] + dy * r, center[1] - dx * r]);
        }
        fn side(d: &mut String, edge: &[[f32; 2]]) {
            for pair in edge.windows(2) {
                let [x, y] = pair[0];
                let [nx, ny] = pair[1];
                write!(d, "Q{x:.3} {y:.3} {:.3} {:.3}", (x + nx) * 0.5, (y + ny) * 0.5).unwrap();
            }
            let [x, y] = edge[edge.len() - 1];
            write!(d, "L{x:.3} {y:.3}").unwrap();
        }
        let [x, y] = left[0];
        write!(d, "M{x:.3} {y:.3}").unwrap();
        side(&mut d, &left);
        if tool == "pencil" {
            grain = pencil_grain(&left, &right, size);
        }
        right.reverse();
        let [ex, ey] = right[0];
        let r = radius(*points.last().unwrap());
        write!(d, "A{r:.3} {r:.3} 0 0 0 {ex:.3} {ey:.3}").unwrap();
        side(&mut d, &right);
        let r = radius(a);
        write!(d, "A{r:.3} {r:.3} 0 0 0 {x:.3} {y:.3}Z").unwrap();
    }
    let rgb = crate::calendar::parse_color(color);
    InkShape {
        commands: d.into(),
        grain: grain.into(),
        x: bounds[0],
        y: bounds[1],
        w: bounds[2] - bounds[0],
        h: bounds[3] - bounds[1],
        color: rgb
            .map(|[r, g, b]| slint::Color::from_rgb_u8(r, g, b))
            .unwrap_or_default(),
        custom: rgb.is_some(),
        alpha: match tool {
            "marker" => 0.36,
            "pencil" => 0.38,
            _ => 1.,
        },
        ..Default::default()
    }
}

impl Tools {
    pub fn sample(&mut self, mut p: Point) {
        if let Some(last) = self.path.last_mut() {
            if p[2] <= 0. {
                p[2] = last[2];
            }
            if last[..2] == p[..2] {
                last[2] = p[2];
                return;
            }
        }
        self.path.push(p);
    }
    pub fn draft(&self) -> InkShape {
        if !self.down || self.moving || self.path.is_empty() {
            return Default::default();
        }
        let tool = if self.hardware_eraser {
            "eraser"
        } else {
            &self.prefs.tool
        };
        let a = self.path[0];
        let z = *self.path.last().unwrap();
        let rect = [a, [z[0], a[1], 1.], z, [a[0], z[1], 1.], a];
        let guide = matches!(tool, "rect" | "lasso" | "eraser");
        let samples = if tool == "rect" { &rect[..] } else { &self.path };
        let mut canonical = Vec::with_capacity(samples.len());
        journal_samples(samples, |p| canonical.push(unpack(p)));
        let mut shape = outline(
            &canonical,
            tool,
            if matches!(tool, "rect" | "lasso") {
                1.
            } else {
                self.prefs.size
            },
            self.prefs.pressure && !guide,
            &self.prefs.color,
        );
        shape.selected = guide;
        if tool == "eraser" {
            shape.alpha = 0.35;
        }
        shape
    }
}

#[derive(Default)]
pub struct CachedInk {
    strokes: Vec<(Value, InkShape)>,
}

impl CachedInk {
    pub fn document(&mut self, card: &Value, selected: Option<&BTreeSet<usize>>) -> InkDocument {
        let saved = card["ink"]["strokes"].as_array().map(Vec::as_slice).unwrap_or(&[]);
        self.strokes.truncate(saved.len());
        let shapes = saved
            .iter()
            .enumerate()
            .map(|(i, stroke)| {
                if self.strokes.get(i).is_none_or(|(old, _)| old != stroke) {
                    let shape = outline(
                        &points(stroke),
                        stroke["tool"].as_str().unwrap_or("pen"),
                        stroke["size"].as_f64().unwrap_or(3.) as f32,
                        stroke["pressure"] == true,
                        stroke["color"].as_str().unwrap_or(""),
                    );
                    let pair = (stroke.clone(), shape);
                    if i == self.strokes.len() {
                        self.strokes.push(pair);
                    } else {
                        self.strokes[i] = pair;
                    }
                }
                let mut shape = self.strokes[i].1.clone();
                shape.selected = selected.is_some_and(|ids| ids.contains(&i));
                shape
            })
            .collect::<Vec<_>>();
        InkDocument {
            shapes: std::rc::Rc::new(slint::VecModel::from(shapes)).into(),
            pattern: card["inkPaper"]["kind"].as_str().unwrap_or("").into(),
            step: card["inkPaper"]["step"].as_f64().unwrap_or(20.).clamp(4., 200.) as f32,
        }
    }
}
