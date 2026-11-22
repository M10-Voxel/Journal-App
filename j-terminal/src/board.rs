//! A period board shares card records with the Journal notebook. Coordinates are in board pixels.
use crate::{
    notebook::{synced_copies, text},
    texts::Language,
};
use chrono::{Datelike, Days, Months, NaiveDate};
use journal_core::{board as db, storage::Store};
use serde_json::{json, Value};
use std::collections::{BTreeSet, HashMap};
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Eq, PartialEq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Period {
    Day,
    Week,
    Month,
    Quarter,
    Year,
}
impl Period {
    pub const ALL: [Self; 5] = [Self::Day, Self::Week, Self::Month, Self::Quarter, Self::Year];
    pub fn command(self, lang: Language) -> &'static str {
        let names = if lang == Language::De {
            [
                "/Pinnwand-Tag",
                "/Pinnwand-Woche",
                "/Pinnwand-Monat",
                "/Pinnwand-Quartal",
                "/Pinnwand-Jahr",
            ]
        } else {
            [
                "/Board-Day",
                "/Board-Week",
                "/Board-Month",
                "/Board-Quarter",
                "/Board-Year",
            ]
        };
        names[self as usize]
    }
    pub fn start(self, date: NaiveDate) -> NaiveDate {
        let month = |m| NaiveDate::from_ymd_opt(date.year(), m, 1).unwrap();
        match self {
            Self::Day => date,
            Self::Week => date
                .checked_sub_days(Days::new(date.weekday().num_days_from_monday().into()))
                .unwrap_or(date),
            Self::Month => month(date.month()),
            Self::Quarter => month((date.month0() / 3) * 3 + 1),
            Self::Year => month(1),
        }
    }
    pub fn key(self, date: NaiveDate) -> String {
        let date = self.start(date);
        match self {
            Self::Day => date.to_string(),
            Self::Week => format!("week:{date}"),
            Self::Month => date.format("month:%Y-%m").to_string(),
            Self::Quarter => format!("quarter:{}-Q{}", date.year(), date.month0() / 3 + 1),
            Self::Year => format!("year:{}", date.year()),
        }
    }
    pub fn step(self, date: NaiveDate, forward: bool) -> NaiveDate {
        let d = self.start(date);
        match self {
            Self::Day | Self::Week => {
                let days = Days::new(if self == Self::Day { 1 } else { 7 });
                if forward {
                    d.checked_add_days(days)
                } else {
                    d.checked_sub_days(days)
                }
            }
            _ => {
                let months = Months::new(match self {
                    Self::Month => 1,
                    Self::Quarter => 3,
                    _ => 12,
                });
                if forward {
                    d.checked_add_months(months)
                } else {
                    d.checked_sub_months(months)
                }
            }
        }
        .unwrap_or(d)
    }
}

pub fn members<'a>(c: &'a Value, key: &str) -> impl Iterator<Item = &'a str> {
    c[key].as_array().into_iter().flatten().filter_map(Value::as_str)
}
pub fn layout_mut<'a>(card: &'a mut Value, key: &str) -> &'a mut Value {
    if key.contains(':') {
        &mut card["boards"][key]
    } else {
        card
    }
}
pub fn on_board(c: &Value, key: &str) -> bool {
    members(c, "dates").any(|s| s == key) || c["boards"][key].is_object()
}
pub fn assign(c: &mut Value, key: &str, show: bool) {
    if key.contains(':') {
        c["boards"][key] = if show { json!({}) } else { Value::Null };
    } else {
        let mut dates: Vec<_> = members(c, "dates").filter(|s| *s != key).map(str::to_owned).collect();
        if show {
            dates.push(key.into());
        } else if dates.is_empty() {
            c["onDay"] = json!(false);
        }
        c["dates"] = json!(dates);
    }
}
#[derive(Clone, Copy)]
pub enum Geometry {
    Move { dx: f32, dy: f32, group: bool },
    Resize(f32, f32),
    ResetSize,
}
#[derive(Clone, Copy, Default)]
pub struct Rect {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}
#[derive(Clone)]
pub struct Placed {
    pub id: String,
    pub rect: Rect,
}
pub struct Board {
    pub period: Period,
    pub date: NaiveDate,
    pub cards: Vec<Value>,
    pub selected: String,
    pub source: Option<String>,
    pub editor: u8,
    pub title: String,
    pub body: String,
    pub original: Value,
    pub menu: Vec<(String, String)>,
    pub menu_at: usize,
    pub prompt: Option<String>,
    pub message: String,
    pub version: i64,
    pub restore: Option<(i32, i32, f32, f32)>,
    pub edge: Option<(String, String)>,
    pub ink: crate::board_ink::Tools,
    pub maximized: bool,
    pub width: f32,
    pub ink_shapes: std::cell::RefCell<HashMap<String, crate::board_ink::CachedInk>>,
    pub ink_dirty: bool,
    pub ink_zoom: f32,
    pub pending_ink: Option<Value>,
    pub changed: Option<std::time::Instant>,
    pub group_move: bool,
    pub pin_at: Option<(f32, f32)>,
    pub menu_page: String,
    pub menu_history: Vec<String>,
    pub tags: Vec<journal_core::storage::Tag>,
    pub menu_query: String,
    pub visible_choices: Vec<usize>,
}
impl Board {
    pub fn open(store: &Store, period: Period, date: NaiveDate) -> Result<Self, String> {
        let mut b = Self {
            period,
            date: period.start(date),
            cards: db::cards(&store.conn)?,
            selected: String::new(),
            source: None,
            editor: 0,
            title: String::new(),
            body: String::new(),
            original: Value::Null,
            menu: vec![],
            menu_at: 0,
            prompt: None,
            message: String::new(),
            version: -1,
            restore: None,
            edge: None,
            ink: Default::default(),
            maximized: false,
            width: 1000.,
            ink_shapes: Default::default(),
            ink_dirty: false,
            ink_zoom: 1.,
            pending_ink: None,
            changed: None,
            group_move: false,
            pin_at: None,
            menu_page: String::new(),
            menu_history: Vec::new(),
            tags: Vec::new(),
            menu_query: String::new(),
            visible_choices: Vec::new(),
        };
        b.ensure_selected();
        Ok(b)
    }
    pub fn key(&self) -> String {
        self.period.key(self.date)
    }
    pub fn card(&self, id: &str) -> Option<&Value> {
        self.cards.iter().find(|c| c["id"] == id)
    }
    pub fn selected_card(&self) -> Option<&Value> {
        self.card(&self.selected)
    }
    pub fn placed(&self) -> Vec<Placed> {
        let key = self.key();
        let mut placed = self.layout(&key);
        let levels: HashMap<_, _> = self
            .cards
            .iter()
            .map(|c| {
                (
                    text(c, "id"),
                    c["boards"][&key]["z"].as_i64().or(c["z"].as_i64()).unwrap_or(0),
                )
            })
            .collect();
        placed.sort_by_key(|p| levels[p.id.as_str()]);
        placed
    }
    fn layout(&self, key: &str) -> Vec<Placed> {
        let cols = ((self.width + 24.) / 264.).floor().max(1.) as usize;
        let mut cards: Vec<_> = self.cards.iter().filter(|c| on_board(c, &key)).collect();
        cards.sort_by_key(|c| (c["order"].as_i64().unwrap_or(0), text(c, "id")));
        cards
            .into_iter()
            .enumerate()
            .map(|(i, c)| {
                let num = |k: &str| c["boards"][key][k].as_f64().or_else(|| c[k].as_f64()).map(|x| x as f32);
                let w = num("w")
                    .unwrap_or(match text(c, "kind") {
                        "image" => 236.,
                        "link" => 260.,
                        _ => 232.,
                    })
                    .max(80.);
                let x = num("boardX").unwrap_or_else(|| {
                    8. + num("x").unwrap_or((i % cols) as f32 / (cols - 1).max(1) as f32)
                        * (self.width - w - 16.).max(0.)
                });
                Placed {
                    id: text(c, "id").into(),
                    rect: Rect {
                        x,
                        y: num("y").unwrap_or(18. + (i / cols) as f32 * 250.),
                        w,
                        h: num("h").filter(|n| *n > 0.).unwrap_or(174.),
                    },
                }
            })
            .collect()
    }
    pub fn ensure_selected(&mut self) {
        let placed = self.placed();
        if !placed.iter().any(|p| p.id == self.selected) {
            self.selected = placed.first().map(|p| p.id.clone()).unwrap_or_default();
        }
    }
    pub fn navigate(&mut self, dx: f32, dy: f32) {
        let cards = self.placed();
        let Some(from) = cards.iter().find(|p| p.id == self.selected) else {
            return;
        };
        let center = |r: Rect| (r.x + r.w / 2., r.y + r.h / 2.);
        let (x, y) = center(from.rect);
        let next = cards
            .iter()
            .filter(|p| p.id != from.id && self.source.as_ref() != Some(&p.id))
            .filter_map(|p| {
                let (qx, qy) = center(p.rect);
                let (a, b) = (qx - x, qy - y);
                let forward = a * dx + b * dy;
                (forward > 0.).then_some((a.hypot(b) + 2. * (a * dy - b * dx).abs(), p))
            })
            .min_by(|a, b| a.0.total_cmp(&b.0));
        if let Some((_, to)) = next {
            self.selected = to.id.clone();
        }
    }
    pub fn group(&self, id: &str) -> BTreeSet<String> {
        let mut set = BTreeSet::from([id.to_owned()]);
        loop {
            let size = set.len();
            for c in &self.cards {
                let src = text(c, "id");
                for dst in members(c, "links") {
                    if set.contains(src) || set.contains(dst) {
                        set.insert(src.into());
                        set.insert(dst.into());
                    }
                }
            }
            if size == set.len() {
                return set;
            }
        }
    }
    pub fn apply(&mut self, store: &mut Store, changes: Vec<(Value, Value)>) -> Result<(), String> {
        db::edit(store, &changes)?;
        self.cards = db::cards(&store.conn)?;
        self.ensure_selected();
        Ok(())
    }
    pub fn create(&mut self, store: &mut Store, kind: &str, url: &str) -> Result<(), String> {
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().timestamp_millis();
        let mut card = json!({"id":id,"kind":if kind=="ink" {"note"}else{kind},"title":"","text":"","paper":"yellow","dates":[],"notebook":true,
            "created":self.date.to_string(),"createdAt":now,"updatedAt":now,"order":self.cards.iter().filter_map(|c|c["order"].as_i64()).max().unwrap_or(0).saturating_add(1)});
        if kind == "ink" {
            card["mode"] = json!("ink");
        }
        if kind == "link" {
            card["url"] = json!(url);
            card["title"] = json!(url);
        }
        assign(&mut card, &self.key(), true);
        if let Some((x, y)) = self.pin_at {
            let layout = layout_mut(&mut card, &self.key());
            layout["boardX"] = json!(x);
            layout["y"] = json!(y);
        }
        self.apply(store, vec![(Value::Null, card)])?;
        self.selected = id;
        Ok(())
    }
    pub fn field(&mut self, store: &mut Store, k: &str, v: Value) -> Result<(), String> {
        let synced = synced_copies(&self.cards, &self.selected);
        let changes = self
            .cards
            .iter()
            .filter(|c| {
                c["id"] == self.selected
                    || ([
                        "mode",
                        "ink",
                        "inkPaper",
                        "title",
                        "text",
                        "paper",
                        "tag",
                        "url",
                        "groupName",
                    ]
                    .contains(&k)
                        && synced.contains(text(c, "id")))
            })
            .map(|c| {
                let mut n = c.clone();
                n[k] = v.clone();
                (c.clone(), n)
            })
            .collect();
        self.apply(store, changes)
    }
    pub fn geometry(&mut self, store: &mut Store, edit: Geometry) -> Result<(), String> {
        let key = self.key();
        let group = self.group(&self.selected);
        let (dx, dy, whole) = match edit {
            Geometry::Move { dx, dy, group } => (dx, dy, group),
            _ => (0., 0., false),
        };
        let size = match edit {
            Geometry::Resize(w, h) => Some((w.max(160.), h.max(120.))),
            Geometry::ResetSize => {
                let card = self.selected_card().ok_or("card")?;
                Some((
                    match text(card, "kind") {
                        "image" => 236.,
                        "link" => 260.,
                        _ => 232.,
                    },
                    0.,
                ))
            }
            Geometry::Move { .. } => None,
        };
        let mut changes = vec![];
        for p in self
            .placed()
            .into_iter()
            .filter(|p| p.id == self.selected || (whole && group.contains(&p.id)))
        {
            let c = self.card(&p.id).unwrap();
            let mut next = c.clone();
            let layout = if key.contains(':') {
                &mut next["boards"][&key]
            } else {
                &mut next
            };
            if let Some((w, h)) = size {
                layout["boardX"] = json!(p.rect.x);
                layout["w"] = json!(w);
                layout["h"] = json!(h);
            } else {
                layout["boardX"] = json!(p.rect.x + dx);
                layout["y"] = json!(p.rect.y + dy);
            }
            changes.push((c.clone(), next));
        }
        let current = self.placed();
        if current.iter().any(|p| p.id == self.selected) {
            let sync = synced_copies(&self.cards, &self.selected);
            let connected_here = current.iter().filter(|p| group.contains(&p.id)).count() > 1;
            for id in sync {
                if id == self.selected {
                    continue;
                }
                let Some(c) = self.card(&id) else { continue };
                let mut n = c.clone();
                if let Some((w, h)) = size {
                    n["w"] = json!(w);
                    n["h"] = json!(h);
                    if let Some(boards) = n["boards"].as_object_mut() {
                        for layout in boards.values_mut().filter(|v| v.is_object()) {
                            layout["w"] = json!(w);
                            layout["h"] = json!(h);
                        }
                    }
                } else if connected_here && !whole && !group.contains(&id) && self.group(&id).len() > 1 {
                    if let Some(day) = members(c, "dates").next() {
                        if let Some(p) = self.layout(day).iter().find(|p| p.id == id) {
                            n["boardX"] = json!(p.rect.x + dx);
                            n["y"] = json!(p.rect.y + dy);
                        }
                    }
                    if let Some(boards) = n["boards"].as_object_mut() {
                        for (k, layout) in boards.iter_mut().filter(|(_, v)| v.is_object()) {
                            if let Some(p) = self.layout(k).iter().find(|p| p.id == id) {
                                layout["boardX"] = json!(p.rect.x + dx);
                                layout["y"] = json!(p.rect.y + dy);
                            }
                        }
                    }
                }
                if n != *c {
                    changes.push((c.clone(), n));
                }
            }
        }
        self.apply(store, changes)
    }
    pub fn thread(&mut self, store: &mut Store, from: &str, to: &str, op: &str) -> Result<(), String> {
        if from == to {
            return Ok(());
        }
        let mut changes = vec![];
        let (Some(a), Some(b)) = (self.card(from), self.card(to)) else {
            return Err("conflict".into());
        };
        let pages = a["kind"] == "note" && b["kind"] == "note";
        if op == "tie" && members(a, "links").any(|s| s == to) && members(b, "links").any(|s| s == from) {
            return Ok(());
        }
        let direction = if op == "reverse" {
            !self.directed(from, to)
        } else {
            true
        };
        for (c, other, first) in [(a, to, true), (b, from, false)] {
            let mut n = c.clone();
            let mut links: Vec<_> = members(c, "links").filter(|s| *s != other).collect();
            if op != "cut" {
                links.push(other);
            }
            n["links"] = json!(links);
            if pages || op == "cut" {
                let mut outgoing: Vec<_> = members(c, "pageLinks").filter(|s| *s != other).collect();
                if pages && op != "cut" && first == direction {
                    outgoing.push(other);
                }
                n["pageLinks"] = json!(outgoing);
            }
            changes.push((c.clone(), n));
        }
        self.apply(store, changes)
    }
    fn note_distances(&self, start: &str) -> HashMap<String, usize> {
        let mut depths = HashMap::from([(start.to_string(), 0)]);
        let mut queue = std::collections::VecDeque::from([start.to_string()]);
        while let Some(id) = queue.pop_front() {
            let depth = depths[&id] + 1;
            let Some(card) = self.card(&id) else { continue };
            for other in self.cards.iter().filter(|n| n["kind"] == "note") {
                let next = text(other, "id");
                if !depths.contains_key(next)
                    && (members(card, "links").any(|s| s == next) || members(other, "links").any(|s| s == id))
                {
                    depths.insert(next.to_string(), depth);
                    queue.push_back(next.to_string());
                }
            }
        }
        depths
    }
    pub fn directed(&self, a: &str, b: &str) -> bool {
        let (Some(c), Some(d)) = (self.card(a), self.card(b)) else {
            return false;
        };
        let forward = members(c, "pageLinks").any(|s| s == b);
        let backward = members(d, "pageLinks").any(|s| s == a);
        if forward != backward {
            return forward;
        }
        let connected = self.note_distances(a);
        let root = self
            .cards
            .iter()
            .filter(|n| connected.contains_key(text(n, "id")))
            .min_by_key(|n| (n["primary"] != true, n["order"].as_i64().unwrap_or(0), text(n, "id")))
            .unwrap_or(c);
        let depths = self.note_distances(text(root, "id"));
        (depths.get(a), c["order"].as_i64().unwrap_or(0), a) < (depths.get(b), d["order"].as_i64().unwrap_or(0), b)
    }
    /// Map the paper point under the old pointer/centroid onto its new screen position.
    pub fn navigate_ink(&mut self, factor: f32, from: [f32; 2], to: [f32; 2], scale: f32) {
        if self.ink.down || self.editor != 2 || scale <= 0. || !factor.is_finite() || factor <= 0. {
            return;
        }
        let zoom = (self.ink_zoom * factor).clamp(0.125, 8.);
        let new_scale = scale * (zoom / self.ink_zoom);
        for axis in 0..2 {
            self.ink.pan[axis] += from[axis] / scale - to[axis] / new_scale;
        }
        self.ink_zoom = zoom;
    }
    pub fn edit(&mut self, mode: u8) {
        if let Some(c) = self.selected_card().cloned() {
            if mode == 2 && (self.editor != 2 || self.original["id"] != c["id"]) {
                self.ink.pan = [0., 0.];
                self.ink_zoom = 1.;
                self.ink.selected.clear();
            }
            self.original = c;
            self.title = text(&self.original, "title").into();
            self.body = text(&self.original, "text").into();
            self.editor = mode;
            self.changed = None;
        }
    }
    pub fn flush(&mut self, store: &mut Store) -> Result<(), String> {
        if self.editor == 2 {
            if self.ink.down {
                self.ink.down = false;
                let card = self.selected_card().cloned().ok_or("conflict")?;
                if !card["ink"].is_null() && (card["ink"]["v"] != 1 || !card["ink"]["strokes"].is_array()) {
                    return Err("ink-version".into());
                }
                self.pending_ink = self.ink.finish(&crate::board_ink::strokes(&card));
            }
            if let Some(ink) = self.pending_ink.clone() {
                self.field(store, "ink", ink)?;
                self.pending_ink = None;
            }
            self.ink.path.clear();
            return Ok(());
        }
        if self.editor != 1 || self.changed.is_none() {
            return Ok(());
        }
        let mut next = self.original.clone();
        let mut fields = vec![];
        for (k, v) in [("title", &self.title), ("text", &self.body)] {
            if text(&next, k) != v {
                next[k] = json!(v);
                fields.push(k);
            }
        }
        if !fields.is_empty() {
            let mut changes = vec![(self.original.clone(), next.clone())];
            for id in synced_copies(&self.cards, &self.selected) {
                if id == self.selected {
                    continue;
                }
                if let Some(c) = self.card(&id) {
                    let mut n = c.clone();
                    for k in &fields {
                        n[*k] = next[*k].clone();
                    }
                    changes.push((c.clone(), n));
                }
            }
            self.apply(store, changes)?;
        }
        self.edit(1);
        Ok(())
    }
    pub fn library(&self) -> Vec<&Value> {
        let key = self.key();
        let mut choices = std::collections::BTreeMap::<String, &Value>::new();
        for c in self.cards.iter().filter(|c| {
            c["kind"] == "note"
                && !on_board(c, &key)
                && (c["notebook"] == true
                    || members(c, "dates").next().is_some()
                    || c["boards"]
                        .as_object()
                        .is_some_and(|v| v.values().any(Value::is_object)))
        }) {
            let mut root = c;
            let mut seen = BTreeSet::new();
            while seen.insert(text(root, "id")) {
                let Some(parent) = self.card(text(root, "copyOf")) else {
                    break;
                };
                root = parent;
            }
            let family = if c["copyOf"].is_string() || self.cards.iter().any(|n| n["copyOf"] == c["id"]) {
                format!("id:{}", text(root, "id"))
            } else {
                format!("text:{}\0{}", text(c, "title").trim(), text(c, "text").trim())
            };
            let rank = |n: &Value| (self.card(text(n, "copyOf")).is_none(), n["order"].as_i64().unwrap_or(0));
            if choices.get(&family).is_none_or(|other| rank(c) > rank(other)) {
                choices.insert(family, c);
            }
        }
        choices.into_values().collect()
    }
    pub fn pin(&mut self, store: &mut Store, key: &str, whole: bool) -> Result<(), String> {
        let placed = self.placed();
        let group = self.group(&self.selected);
        let show = !self.selected_card().is_some_and(|c| on_board(c, key));
        let mut changes = vec![];
        for c in self.cards.iter().filter(|c| {
            if whole {
                group.contains(text(c, "id"))
            } else {
                c["id"] == self.selected
            }
        }) {
            if on_board(c, key) == show && !(show && whole && key.contains(':')) {
                continue;
            }
            let mut n = c.clone();
            assign(&mut n, key, show);
            if key.contains(':') && show {
                if let Some(p) = placed.iter().find(|p| p.id == text(c, "id")) {
                    n["boards"][key] = json!({"boardX":p.rect.x,"y":p.rect.y,"w":p.rect.w,"h":p.rect.h});
                }
            }
            changes.push((c.clone(), n));
        }
        self.apply(store, changes)
    }
    pub fn copy(&mut self, store: &mut Store, from: &str, group: bool) -> Result<(), String> {
        let ids = if group {
            self.group(from)
        } else {
            BTreeSet::from([from.to_string()])
        };
        let copies: HashMap<_, _> = self
            .cards
            .iter()
            .filter(|c| ids.contains(text(c, "id")) && c["kind"] != "image")
            .map(|c| (text(c, "id"), Uuid::new_v4().to_string()))
            .collect();
        let mut changes = vec![];
        let key = self.key();
        let source = self.card(from).and_then(|c| {
            members(c, "dates").next().or_else(|| {
                c["boards"]
                    .as_object()?
                    .iter()
                    .find(|(_, v)| v.is_object())
                    .map(|(k, _)| k.as_str())
            })
        });
        let layout = source.map(|k| self.layout(k)).unwrap_or_default();
        let order = self.cards.iter().filter_map(|c| c["order"].as_i64()).max().unwrap_or(0);
        for (old, id) in &copies {
            let c = self.card(old).unwrap();
            let mut n = c.clone();
            n["id"] = json!(id);
            n["copyOf"] = json!(old);
            n["copySync"] = json!(false);
            n["dates"] = json!([]);
            n["boards"] = json!({});
            n["notebook"] = json!(false);
            n["onDay"] = json!(false);
            n["created"] = json!(self.date.to_string());
            n["folder"] = Value::Null;
            for k in ["links", "pageLinks"] {
                n[k] = json!(members(c, k).filter_map(|s| copies.get(s)).collect::<Vec<_>>());
            }
            assign(&mut n, &key, true);
            let index = layout.iter().position(|p| p.id == *old);
            n["order"] = json!(order.saturating_add(1 + index.unwrap_or(changes.len()) as i64));
            if let Some(r) = index.map(|i| layout[i].rect) {
                let dst = if key.contains(':') {
                    &mut n["boards"][&key]
                } else {
                    &mut n
                };
                let anchor = layout.iter().find(|p| p.id == from).map(|p| p.rect).unwrap_or(r);
                let (x, y) = self.pin_at.unwrap_or((anchor.x, anchor.y));
                dst["boardX"] = json!(x + r.x - anchor.x);
                dst["y"] = json!(y + r.y - anchor.y);
                dst["w"] = json!(r.w);
                dst["h"] = json!(source
                    .and_then(|key| c["boards"][key]["h"].as_f64())
                    .or(c["h"].as_f64())
                    .unwrap_or(0.));
            }
            changes.push((Value::Null, n));
        }
        let selected = copies.get(from).cloned();
        self.apply(store, changes)?;
        if let Some(id) = selected {
            self.selected = id;
        }
        Ok(())
    }
}

impl Board {
    pub fn modify_ink(&mut self, store: &mut Store, op: &str, dx: f32, dy: f32) -> Result<(), String> {
        if self.ink.selected.is_empty() {
            return Ok(());
        }
        let Some(c) = self.selected_card() else { return Ok(()) };
        let next = self.ink.modify(&crate::board_ink::strokes(c), op, dx, dy);
        self.field(store, "ink", next)
    }
    pub fn toggle_sync(&mut self, store: &mut Store) -> Result<(), String> {
        let ids = self.group(&self.selected);
        let peers: Vec<_> = self
            .cards
            .iter()
            .filter(|c| ids.contains(text(c, "id")) && c["copyOf"].is_string() || ids.contains(text(c, "copyOf")))
            .collect();
        let enable = peers.iter().any(|c| c["copySync"] != true);
        let changes = peers
            .into_iter()
            .map(|c| {
                let mut next = c.clone();
                next["copySync"] = json!(enable);
                if enable {
                    if let Some(parent) = self.card(text(c, "copyOf")) {
                        for field in [
                            "title",
                            "text",
                            "mode",
                            "ink",
                            "inkPaper",
                            "paper",
                            "tag",
                            "url",
                            "pixel",
                            "groupName",
                            "w",
                            "h",
                        ] {
                            next[field] = parent[field].clone();
                        }
                    }
                }
                (c.clone(), next)
            })
            .collect();
        self.apply(store, changes)
    }
    pub fn remove(&mut self, store: &mut Store, whole: bool) -> Result<(), String> {
        let ids = if whole {
            self.group(&self.selected)
        } else {
            BTreeSet::from([self.selected.clone()])
        };
        let mut remove = ids.clone();
        for c in &self.cards {
            if c["kind"] != "note"
                && c["notebook"] == true
                && members(c, "dates").next().is_none()
                && !c["boards"]
                    .as_object()
                    .is_some_and(|v| v.values().any(Value::is_object))
                && members(c, "links").all(|id| ids.contains(id))
                && self.cards.iter().any(|n| {
                    ids.contains(text(n, "id"))
                        && n["kind"] == "note"
                        && members(n, "links").any(|id| id == text(c, "id"))
                })
            {
                remove.insert(text(c, "id").into());
            }
        }
        let changes = self
            .cards
            .iter()
            .filter_map(|c| {
                if remove.contains(text(c, "id")) {
                    return Some((c.clone(), Value::Null));
                }
                let mut n = c.clone();
                for k in ["links", "pageLinks"] {
                    if members(c, k).any(|id| remove.contains(id)) {
                        n[k] = json!(members(c, k).filter(|id| !remove.contains(*id)).collect::<Vec<_>>());
                    }
                }
                (n != *c).then(|| (c.clone(), n))
            })
            .collect();
        self.apply(store, changes)
    }
}

#[cfg(test)]
#[path = "board_tests.rs"]
mod tests;
