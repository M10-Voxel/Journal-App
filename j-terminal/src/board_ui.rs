use super::*;
use board::{members, Board, Period, Rect};
use journal_core::board as db;
use notebook::text;
use serde_json::{json, Value};
use slint::Model;
use std::{
    collections::{BTreeSet, HashMap},
    rc::Rc,
    time::Instant,
};
use texts::{board::label, Language};

pub fn projection_hint(lang: Language) -> &'static str {
    label("projection", lang)
}
fn model<T: 'static + Clone>(items: Vec<T>) -> slint::ModelRc<T> {
    Rc::new(slint::VecModel::from(items)).into()
}
pub(super) fn focus_board(bar: &Bar) {
    focus(&bar.global::<BoardUi>());
}
fn focus(ui: &BoardUi) {
    ui.set_focus_request(ui.get_focus_request().wrapping_add(1));
}
fn name(c: &Value, l: Language) -> String {
    let s = text(c, "title");
    if s.is_empty() {
        label(
            if c["kind"] == "note" {
                "untitled"
            } else {
                text(c, "kind")
            },
            l,
        )
        .into()
    } else {
        s.into()
    }
}
fn formatted(s: &str) -> slint::StyledText {
    slint::StyledText::from_markdown(s).unwrap_or_else(|_| slint::StyledText::from_plain_text(s))
}

impl App {
    fn board_path(&self, file: &str) -> Option<PathBuf> {
        self.preferences_path.as_ref().map(|p| p.with_file_name(file))
    }
    pub(super) fn refresh_board_scopes(&mut self) -> bool {
        let scopes = self
            .board_path(db::SCOPES_FILE)
            .and_then(|p| match std::fs::read(p) {
                Ok(bytes) => serde_json::from_slice(&bytes).ok(),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Some(Period::ALL.to_vec()),
                Err(_) => None,
            });
        if scopes == self.state.board_scopes {
            return false;
        }
        // Until the switches are changed in F1, the boards follow the app's.
        if let (false, Some(boards)) = (self.state.preferences.features_set, &scopes) {
            self.state.preferences.features = self.state.preferences.features.with_boards(boards);
        }
        self.state.board_scopes = scopes;
        true
    }
    pub(super) fn open_board(&mut self, period: Period) {
        self.refresh_board_scopes();
        // F1 → Funktionen: the view's board switched off.
        let on = self.state.preferences.features.has(crate::features::View::ALL[period as usize], crate::features::Module::Board);
        if !on || self.state.board_scopes.is_none() {
            self.notice = Some(label("unavailable", self.state.language).into());
            self.draw();
            return;
        }
        let Some(j) = self.state.journal.as_ref() else { return };
        match Board::open(&j.store, period, self.state.day_shown()) {
            Err(e) => {
                self.notice = Some(e);
                self.draw();
            }
            Ok(mut b) => {
                #[cfg(windows)]
                super::board_pointer::configure(&self.bar, true);
                b.width = self.bar.get_content_width().max(260.);
                if let Some(p) = self.board_path("j-terminal-ink.json") {
                    if let Ok(bytes) = std::fs::read(p) {
                        b.ink.prefs = serde_json::from_slice(&bytes).unwrap_or_default();
                    }
                }
                self.board = Some(b);
                let bar = self.bar.clone_strong();
                let ui = bar.global::<BoardUi>();
                let pad = bar.global::<Theme>().get_padding();
                ui.set_zoom(1.);
                ui.set_left(-pad);
                ui.set_top(-pad);
                ui.set_hover(-1);
                ui.invoke_cancel_gesture();
                ui.set_keyboard_focus(false);
                ui.set_tools(model(
                    [
                        ("tag", "tag", "circle", true),
                        ("mode", "draw", "spline", true),
                        ("paper-next", "paper", "palette", true),
                        ("detach", "detach", "pin", true),
                        ("assign", "assign", "list-filter", false),
                        ("delete", "delete", "trash", false),
                    ]
                    .into_iter()
                    .map(|(cmd, key, n, note_only)| BoardTool {
                        command: cmd.into(),
                        label: label(key, self.state.language).into(),
                        icon: n.into(),
                        note_only,
                    })
                    .collect(),
                ));
                ui.set_back_icon(self.bar.global::<JournalIcons>().get_left_icon());
                self.bar.invoke_dismiss_preview();
                self.draw_board();
                ui.invoke_viewport("reveal".into());
                focus(&self.bar.global::<BoardUi>());
            }
        }
    }
    pub(super) fn board_error(&mut self, e: String) {
        let msg = if e == "ink-version" {
            label("ink-version", self.state.language).into()
        } else if e == "conflict" {
            label("conflict", self.state.language).into()
        } else {
            e
        };
        if let Some(b) = &mut self.board {
            b.message = msg.clone();
        }
        self.bar.global::<BoardUi>().set_message(msg.into());
    }
    pub(super) fn flush_board(&mut self) -> Result<(), String> {
        if let (Some(b), Some(j)) = (&mut self.board, &mut self.state.journal) {
            b.flush(&mut j.store)?;
        }
        Ok(())
    }
    pub(super) fn tick_board(&mut self) {
        let changed = self.refresh_board_scopes();
        let Some(b) = self.board.as_ref() else {
            if changed {
                self.draw();
            }
            return;
        };
        let disabled = !self.state.board_scopes.as_ref().is_some_and(|s| s.contains(&b.period));
        if !self.bar.global::<BoardUi>().get_operation().is_empty() && !disabled {
            return;
        }
        let due = b.changed.is_some_and(|t| t.elapsed() >= Duration::from_millis(400));
        if due || disabled {
            if let Err(e) = self.flush_board() {
                self.board_error(e);
                return;
            }
            if disabled {
                self.close_board();
                return;
            }
            self.draw_board();
        }
        let Some(j) = self.state.journal.as_ref() else { return };
        let version = j
            .store
            .conn
            .pragma_query_value(None, "data_version", |r| r.get::<_, i64>(0));
        if let (Ok(version), Some(b)) = (version, &mut self.board) {
            if b.version != version && b.pending_ink.is_none() && !b.ink.down {
                if let Ok(cards) = db::cards(&j.store.conn) {
                    b.version = version;
                    b.cards = cards;
                    if b.editor == 0 {
                        b.ensure_selected();
                    } else if b.changed.is_none() && b.selected_card().is_some() {
                        b.edit(b.editor);
                    }
                    self.draw_board();
                }
            }
        }
    }
    pub(super) fn close_board(&mut self) {
        #[cfg(windows)]
        super::board_pointer::configure(&self.bar, false);
        self.board_maximize(false);
        self.board = None;
        self.board_images.clear();
        let ui = self.bar.global::<BoardUi>();
        ui.invoke_cancel_gesture();
        ui.set_opened(false);
        ui.set_menu_open(false);
        ui.set_heights(Default::default());
        ui.set_editor(0);
        ui.set_tiles(Default::default());
        ui.set_threads(Default::default());
        ui.set_groups(Default::default());
        ui.set_options(Default::default());
        ui.set_draft(Default::default());
        ui.set_attachment(Default::default());
        ui.set_title("".into());
        ui.set_body("".into());
        self.draw();
        self.bar.invoke_focus_search();
    }
    fn board_maximize(&mut self, on: bool) {
        let Some(b) = &mut self.board else { return };
        if b.maximized == on {
            return;
        }
        b.maximized = on;
        self.bar.global::<BoardUi>().set_maximized(on);
        self.bar.window().with_winit_window(|win| {
            if on {
                if let (Ok(position), Some(m)) = (win.outer_position(), win.current_monitor()) {
                    b.restore = Some((
                        position.x,
                        position.y,
                        self.bar.get_screen_width(),
                        self.bar.get_screen_height(),
                    ));
                    let area = placement::work_area(screen_for_monitor(m));
                    self.bar.set_screen_width((area.width as f64 / area.scale) as f32);
                    self.bar.set_screen_height((area.height as f64 / area.scale) as f32);
                    win.set_outer_position(slint::winit_030::winit::dpi::PhysicalPosition::new(area.left, area.top));
                }
            } else if let Some((x, y, w, h)) = b.restore.take() {
                self.bar.set_screen_width(w);
                self.bar.set_screen_height(h);
                win.set_outer_position(slint::winit_030::winit::dpi::PhysicalPosition::new(x, y));
            }
        });
    }
    pub(super) fn render_canvas(&self) {
        let Some(b) = &self.board else { return };
        let ui = self.bar.global::<BoardUi>();
        ui.set_ink_zoom(b.ink_zoom);
        ui.set_ink_pan_x(b.ink.pan[0]);
        ui.set_ink_pan_y(b.ink.pan[1]);
        let delta = b
            .ink
            .path
            .first()
            .zip(b.ink.path.last())
            .filter(|_| b.ink.down && b.ink.moving)
            .map_or([0., 0.], |(a, z)| [z[0] - a[0], z[1] - a[1]]);
        ui.set_ink_move_x(delta[0]);
        ui.set_ink_move_y(delta[1]);
        ui.set_draft(b.ink.draft());
    }
    pub(super) fn draw_board(&mut self) {
        let Some(b) = &self.board else { return };
        let ui = self.bar.global::<BoardUi>();
        let t = self.bar.global::<Theme>();
        let l = self.state.language;
        ui.set_opened(true);
        ui.set_editor(b.editor.into());
        ui.set_heading(
            format!(
                "{}   {}",
                b.period.command(l).trim_start_matches('/'),
                b.key().split(':').next_back().unwrap_or("")
            )
            .into(),
        );
        ui.set_title_label(label("title", l).into());
        ui.set_body_label(label("body", l).into());
        ui.set_draw_label(label(if b.editor == 2 { "write" } else { "draw" }, l).into());
        ui.set_action_label(label(if b.editor == 2 { "tools" } else { "actions" }, l).into());
        if b.editor == 2 {
            let tool = b.ink.prefs.tool.as_str();
            ui.set_maximize_label(label(if b.maximized { "restore-canvas" } else { "maximize" }, l).into());
            ui.set_ink_tool(tool.into());
            ui.set_ink_color(
                calendar::parse_color(&b.ink.prefs.color)
                    .map_or(t.get_board_paper_ink(), |[r, g, b]| slint::Color::from_rgb_u8(r, g, b)),
            );
            ui.set_ink_size(b.ink.prefs.size);
            ui.set_ink_tools(model(
                [
                    (
                        "pens",
                        match tool {
                            "pencil" => "pencil",
                            "marker" => "highlighter",
                            _ => "pen-tool",
                        },
                    ),
                    ("eraser", "eraser"),
                    ("selects", if tool == "lasso" { "lasso" } else { "square-dashed" }),
                    ("color", "palette"),
                    ("size", "circle"),
                    ("pattern", "grid-2x2"),
                    ("actions", "ellipsis"),
                ]
                .into_iter()
                .map(|(cmd, icon)| BoardTool {
                    command: cmd.into(),
                    label: label(if cmd == "actions" { "tools" } else { cmd }, l).into(),
                    icon: icon.into(),
                    ..Default::default()
                })
                .collect(),
            ));
        }
        ui.set_message(b.message.clone().into());
        if ui.get_title().as_str() != b.title {
            ui.set_title(b.title.clone().into());
        }
        if ui.get_body().as_str() != b.body {
            ui.set_body(b.body.clone().into());
        }
        ui.set_pin_label(label("new-menu", l).into());
        ui.set_group_label(label("group-name", l).into());
        ui.set_move_group(b.group_move);
        ui.set_option_index(b.menu_at as i32);
        ui.set_prompt(
            b.prompt
                .as_deref()
                .map_or("", |s| label(s.split(':').next().unwrap_or(s), l))
                .into(),
        );
        let placed = b.placed();
        ui.set_hint(
            label(
                if b.source.is_some() {
                    "linking"
                } else if b.editor == 2 {
                    "inkhint"
                } else if b.editor == 1 {
                    "edithint"
                } else if placed.is_empty() {
                    "empty"
                } else {
                    "hint"
                },
                l,
            )
            .into(),
        );
        let indices: HashMap<_, _> = placed
            .iter()
            .enumerate()
            .map(|(i, p)| (p.id.as_str(), i as i32))
            .collect();
        b.ink_shapes
            .borrow_mut()
            .retain(|id, _| indices.contains_key(id.as_str()));
        let mut membership = HashMap::new();
        let mut groups = vec![];
        let mut seen = BTreeSet::new();
        for p in &placed {
            if seen.contains(&p.id) {
                continue;
            }
            let ids = b.group(&p.id);
            seen.extend(ids.iter().cloned());
            let visible: Vec<_> = ids.iter().filter_map(|id| indices.get(id.as_str()).copied()).collect();
            if visible.len() < 2 {
                continue;
            }
            for id in &ids {
                membership.insert(id.clone(), groups.len() as i32);
            }
            let title = ids
                .iter()
                .filter_map(|id| b.card(id))
                .map(|c| text(c, "groupName"))
                .find(|s| !s.is_empty())
                .unwrap_or("");
            groups.push(BoardGroup {
                members: model(visible),
                name: title.into(),
            });
        }
        let mut threads = vec![];
        let mut edges = BTreeSet::new();
        let mut tiles = vec![];
        for p in &placed {
            let Some(c) = b.card(&p.id) else { continue };
            let Rect { x, y, w, h } = p.rect;
            let selected = p.id == b.selected;
            let live = selected && b.editor == 1;
            let title = if live { &b.title } else { text(c, "title") };
            let body = if live { b.body.as_str() } else { text(c, "text") };
            let is_link = c["kind"] == "link";
            // A link pinned elsewhere (or before previews) gets its preview once per run.
            if is_link && c.get("site").is_none() && !LINK_ASKED.with_borrow(|asked| asked.contains(&p.id)) {
                if let Some(url) = notebook::web_address(text(c, "url")) { fetch_link_preview(p.id.clone(), url); }
            }
            let picture = if is_link {
                link_picture(text(c, "image"))
            } else if c["kind"] == "image" {
                let key = format!("{}:{}", text(c, "id"), text(c, "asset"));
                self.board_images
                    .entry(key)
                    .or_insert_with(|| {
                        self.state
                            .journal
                            .as_ref()
                            .and_then(|j| notebook::stored_image(c, &j.vault))
                            .and_then(|s| note_images::decode(&s, 720))
                            .or_else(|| note_images::inline(text(c, "image"), 720))
                            .map(|im| note_images::to_slint(&im))
                            .unwrap_or_default()
                    })
                    .clone()
            } else {
                Default::default()
            };
            if selected && b.editor == 3 {
                ui.set_attachment(picture.clone());
            }
            let is_ink = c["mode"] == "ink";
            let ink = if is_ink {
                b.ink_shapes
                    .borrow_mut()
                    .entry(p.id.clone())
                    .or_default()
                    .document(c, (selected && b.editor == 2).then_some(&b.ink.selected))
            } else {
                Default::default()
            };
            tiles.push(BoardTile {
                ink,
                is_ink,
                id: p.id.clone().into(),
                title: title.into(),
                rows: model(markdown_rows(body, true)),
                kind: text(c, "kind").into(),
                auto_height: (is_link || (c["kind"] == "note" && c["mode"] != "ink"))
                    && c["boards"][b.key()]["h"].as_f64().or(c["h"].as_f64()).unwrap_or(0.) <= 0.,
                group: *membership.get(&p.id).unwrap_or(&-1),
                pin: match text(c, "kind") {
                    "link" => t.get_board_green_pin(),
                    "image" => t.get_board_blue_pin(),
                    _ => t.get_board_pin(),
                },
                detail: if c["kind"] == "image" {
                    format!("AVIF · {} KB", c["size"].as_u64().unwrap_or(0).div_ceil(1024)).into()
                } else if is_link && !text(c, "site").is_empty() {
                    // Where the link leads, as the page names it: the site and (for videos) the channel.
                    [text(c, "site"), text(c, "author")].iter().filter(|s| !s.is_empty()).copied().collect::<Vec<_>>().join(" · ").into()
                } else {
                    text(c, "url").into()
                },
                left: x,
                top: y,
                w,
                h,
                selected,
                source: b.source.as_ref() == Some(&p.id),
                has_picture: c["kind"] == "image" || c["mode"] == "ink",
                picture,
                paper: match text(c, "paper") {
                    "blue" => t.get_board_blue(),
                    "green" => t.get_board_green(),
                    "pink" => t.get_board_pink(),
                    _ if c["kind"] == "note" => t.get_board_yellow(),
                    _ if c["kind"] == "image" => t.get_board_photo(),
                    _ => t.get_board_index(),
                },
            });
            for to in members(c, "links") {
                if !indices.contains_key(to) {
                    continue;
                }
                let mut pair = [p.id.as_str(), to];
                pair.sort();
                if edges.insert(pair) {
                    threads.push(thread(b, &indices, pair[0], pair[1], false));
                }
            }
        }
        if let Some(src) = &b.source {
            if src != &b.selected && indices.contains_key(src.as_str()) && indices.contains_key(b.selected.as_str()) {
                threads.push(thread(b, &indices, src, &b.selected, true));
            }
        }
        let old_tiles = ui.get_tiles();
        let old_heights = ui.get_heights();
        let heights = tiles
            .iter()
            .enumerate()
            .map(|(i, tile)| {
                if old_tiles.row_data(i).is_some_and(|old| old.id == tile.id) {
                    old_heights.row_data(i).unwrap_or(tile.h)
                } else {
                    tile.h
                }
            })
            .collect();
        ui.set_selected(indices.get(b.selected.as_str()).copied().unwrap_or(-1));
        ui.set_heights(model(heights));
        ui.set_tiles(model(tiles));
        ui.set_groups(model(groups));
        ui.set_threads(model(threads));
        self.draw_board_menu();
        self.render_canvas();
    }
    fn run_board(&mut self, cmd: &str) {
        let Some(b) = &mut self.board else { return };
        self.bar.global::<BoardUi>().invoke_cancel_gesture();
        let before = (b.editor, b.menu_page.clone(), b.prompt.clone());
        let parent = b.menu_page.clone();
        if cmd == "dismiss" {
            b.menu_history.clear();
        }
        let result = self.board_command(cmd);
        if let Err(err) = result {
            self.board_error(err);
        }
        let Some(b) = &mut self.board else { return };
        let opens_page =
            !b.menu.is_empty() || b.prompt.is_some() || matches!(cmd, "existing" | "existing-group" | "threads");
        if opens_page {
            if !parent.is_empty() && parent != cmd && cmd != "submit" {
                b.menu_history.push(parent.clone());
            }
            b.menu_page = if cmd == "submit" { parent } else { cmd.to_string() };
        } else {
            b.menu_page.clear();
            b.menu_history.clear();
            b.pin_at = None;
            self.bar.global::<BoardUi>().set_menu_compact(false);
        }
        b.menu_query.clear();
        let changed = before != (b.editor, b.menu_page.clone(), b.prompt.clone());
        let reveal = before.0 != b.editor || matches!(cmd, "prev" | "next") || (cmd == "reset-view" && b.editor != 2);
        self.draw_board();
        let ui = self.bar.global::<BoardUi>();
        if opens_page {
            ui.set_menu_reset(ui.get_menu_reset().wrapping_add(1));
        }
        if before.0 != 1 && ui.get_editor() == 1 {
            ui.set_title_focus(false);
        }
        if changed {
            focus(&ui);
        }
        if reveal {
            ui.invoke_viewport("reveal".into());
        }
        if let Some(id) = self.board.as_mut().and_then(|b| b.edit_tag.take()) {
            self.open_tag_editor(&id);
        }
    }
    fn board_menu_back(&mut self) {
        let Some(b) = &mut self.board else { return };
        let previous = b.menu_history.pop();
        b.menu_page.clear();
        b.prompt = None;
        self.run_board(previous.as_deref().unwrap_or("dismiss"));
        focus(&self.bar.global::<BoardUi>());
    }
    fn draw_board_menu(&mut self) {
        let Some(b) = &mut self.board else { return };
        let ui = self.bar.global::<BoardUi>();
        let lang = self.state.language;
        let theme = self.bar.global::<Theme>();
        let picking_tag = b.menu_page == "tag";
        ui.set_tag_open(picking_tag);
        ui.set_ink_picker(
            if b.prompt.is_none() && matches!(b.menu_page.as_str(), "color" | "size") {
                b.menu_page.as_str()
            } else {
                ""
            }
            .into(),
        );
        ui.set_menu_open(!b.menu_page.is_empty() && b.prompt.is_none());
        // The right click's card: smaller lines and no keys.
        let compact = ui.get_menu_compact();
        let line = if compact { theme.get_compact_row_height() } else { theme.get_side_row_height() };
        if picking_tag {
            let current = b
                .selected_card()
                .and_then(|c| c["tag"].as_str())
                .filter(|s| !s.is_empty());
            let choices = day::tag_indices(&b.tags, &b.menu_query);
            let rows = choices
                .iter()
                .enumerate()
                .map(|(row, index)| {
                    let data = day::tag_row(
                        index.map(|i| &b.tags[i]),
                        current,
                        row == b.menu_at,
                        texts::form_texts(lang).no_tag,
                    );
                    picker_row(&self.bar, &data, theme.get_label_icon_size())
                })
                .collect();
            b.visible_choices = choices.into_iter().map(|i| i.map_or(0, |n| n + 1)).collect();
            let mut rows: Vec<_> = rows;
            b.new_choice = crate::tag_edit::creatable(&b.tags, &b.menu_query).map(|name| {
                let selected = b.menu_at == rows.len();
                rows.push(picker_row(&self.bar, &day::new_row(texts::tags::make_tag(&name, lang), selected), theme.get_label_icon_size()));
                b.visible_choices.push(b.menu.len());
                format!("new-tag:{name}")
            });
            ui.set_tag_rows(model(rows));
            ui.set_tag_context(b.selected_card().map(|c| name(c, lang)).unwrap_or_default().into());
            ui.set_options(Default::default());
        } else {
            let words = b.menu_query.to_lowercase();
            b.visible_choices = b
                .menu
                .iter()
                .enumerate()
                .filter(|(_, (_, title))| title.to_lowercase().contains(words.trim()))
                .map(|(i, _)| i)
                .collect();
            let folders: Vec<(String, String)> = b.menu.iter().skip(1).map(|(_, name)| (String::new(), name.clone())).collect();
            b.new_choice = (b.menu_page == "folder").then(|| notebook::new_folder_name(&folders, &b.menu_query)).flatten().map(|name| format!("new-folder:{name}"));
            if b.new_choice.is_some() { b.visible_choices.push(b.menu.len()); }
            let rows = b
                .visible_choices
                .iter()
                .enumerate()
                .map(|(i, &source)| {
                    let new_line = b.new_choice.as_deref().and_then(|c| c.strip_prefix("new-folder:"))
                        .map(|name| ("new-folder".to_string(), texts::tags::make_folder(name, lang)));
                    let (cmd, name) = b.menu.get(source).cloned().or(new_line).unwrap_or_default();
                    let (cmd, name) = (&cmd, &name);
                    let key = cmd.split(':').next().unwrap_or(cmd);
                    let icon = match key {
                        "note" | "write" => "notebook-pen",
                        "ink" | "draw" | "pencil" => "pencil",
                        "pens" | "pen" => "pen-tool",
                        "marker" => "highlighter",
                        "rect" | "selects" => "square-dashed",
                        "lasso" => "lasso",
                        "eraser" => "eraser",
                        "size" => "sliders-horizontal",
                        "color" => "palette",
                        "image" => "image",
                        "link" | "tie" => "link",
                        "tag" => "tag",
                        "folder" => "folder",
                        "new-folder" | "new-tag" => "plus",
                        "detach" => "pin",
                        "assign" | "assign-group" => "list-filter",
                        "delete" | "delete-group" | "confirm" => "trash",
                        "reset-size" => "scaling",
                        "zoom-in" => "zoom-in",
                        "zoom-out" => "zoom-out",
                        "reset-view" => "scan",
                        "new-menu" => "pin",
                        "paper" => "palette",
                        "existing" | "existing-group" | "copy" => "copy",
                        "cut" | "unpin" => "unlink",
                        "threads" | "edge" => "spline",
                        "sync" | "reverse" => "repeat",
                        "group-name" => "type",
                        "front" => "bring-to-front",
                        "open" => "external-link",
                        _ => "circle",
                    };
                    let keys = match key {
                        "open" if b.editor == 0 => "Enter",
                        "tie" if b.editor == 0 => "Alt+L",
                        "new-menu" => "Ctrl+N",
                        _ => "",
                    };
                    let color = match key {
                        "recent" => Some(
                            calendar::parse_color(&cmd[7..]).map_or(theme.get_board_paper_ink(), |[r, g, b]| {
                                slint::Color::from_rgb_u8(r, g, b)
                            }),
                        ),
                        "yellow" => Some(theme.get_board_yellow()),
                        "pink" => Some(theme.get_board_pink()),
                        "blue" => Some(theme.get_board_blue()),
                        "green" => Some(theme.get_board_green()),
                        _ => None,
                    };
                    MenuRow {
                        top: i as f32 * (line + theme.get_choice_spacing()),
                        label: name.as_str().into(),
                        on: match key {
                            "recent" => b.ink.prefs.color.eq_ignore_ascii_case(&cmd[7..]),
                            "width" => cmd[6..].parse::<f32>() == Ok(b.ink.prefs.size),
                            _ => cmd == &b.ink.prefs.tool || (cmd == "pressure" && b.ink.prefs.pressure),
                        },
                        value: if key == "width" { cmd[6..].into() } else { "".into() },
                        has_icon: true,
                        icon: icon_image(icon, theme.get_label_icon_size(), self.bar.window().scale_factor()),
                        caps: if compact { Default::default() } else { strings(shortcuts::caps(keys)) },
                        danger: matches!(key, "delete" | "delete-group" | "confirm" | "unpin"),
                        has_color: color.is_some(),
                        color: color.unwrap_or_default(),
                        ..Default::default()
                    }
                })
                .collect();
            ui.set_options(model(rows));
        }
        let heading = match b.menu_page.as_str() {
            "actions" if b.editor == 2 => label("tools", lang).to_owned(),
            "actions" | "card-actions" => b
                .selected_card()
                .map(|c| name(c, lang))
                .unwrap_or_else(|| ui.get_heading().to_string()),
            "tag" => texts::day_texts(lang).tag.to_owned(),
            page => label(page.split(':').next().unwrap_or(page), lang).to_owned(),
        };
        ui.set_can_back(!b.menu_history.is_empty());
        ui.set_menu_title(heading.into());
        ui.set_menu_search(
            if picking_tag {
                texts::day_texts(lang).tag_search
            } else {
                texts::action_texts(lang).search
            }
            .into(),
        );
        ui.set_menu_empty(texts::action_texts(lang).nothing.into());
        ui.set_option_index(b.menu_at as i32);
    }
    fn board_command(&mut self, cmd: &str) -> Result<(), String> {
        let l = self.state.language;
        let Some(b) = &mut self.board else { return Ok(()) };
        let Some(j) = &mut self.state.journal else {
            return Ok(());
        };
        let store = &mut j.store;
        let select = b.selected.clone();
        let c = b.selected_card().cloned().unwrap_or(Value::Null);
        let labels = |ids: &[&str]| ids.iter().map(|s| (s.to_string(), label(s, l).to_string())).collect();
        let value = self.bar.global::<BoardUi>().get_value().to_string();
        b.menu.clear();
        b.menu_at = 0;
        b.message.clear();
        if cmd == "back" {
            if b.prompt.take().is_some() {
                return Ok(());
            }
            if b.source.take().is_some() {
                return Ok(());
            }
            if !b.ink.selected.is_empty() {
                b.ink.selected.clear();
                return Ok(());
            }
            if b.maximized {
                self.board_maximize(false);
                return Ok(());
            }
            if b.editor > 0 {
                b.flush(store)?;
                b.editor = 0;
                return Ok(());
            }
            self.close_board();
            return Ok(());
        }
        if !matches!(cmd, "keep-draft" | "reload" | "actions" | "dismiss") && (b.editor == 1 || b.editor == 2) {
            b.flush(store)?;
        }
        if cmd == "actions" && (b.changed.is_some() || b.pending_ink.is_some()) {
            if let Err(e) = b.flush(store) {
                b.message = if e == "conflict" {
                    label("conflict", l).into()
                } else {
                    e
                };
                b.menu = labels(&["retry", "keep-draft", "reload"]);
                return Ok(());
            }
        }
        match cmd {
            "dismiss" => {
                b.prompt = None;
            }
            "prev" | "next" => {
                if b.maximized {
                    self.board_maximize(false);
                    return self.board_command(cmd);
                }
                b.editor = 0;
                b.source = None;
                b.date = b.period.step(b.date, cmd == "next");
                b.ensure_selected();
            }
            "new-menu" => {
                // The surface picker supplies the precise world coordinate. The footer places the note
                // in the nearest free spot inside the currently visible part of the board.
                let ui = self.bar.global::<BoardUi>();
                if b.pin_at.is_none() && self.bar.get_board_viewport_w() > 0. {
                    let pad = self.bar.global::<Theme>().get_padding();
                    let left = ui.get_left() + pad;
                    let top = ui.get_top() + pad;
                    let columns = ((self.bar.get_board_viewport_w() / ui.get_zoom()) / 264.)
                        .floor()
                        .max(1.) as usize;
                    let boxes: Vec<_> = (0..ui.get_tiles().row_count())
                        .map(|i| ui.invoke_box_at(i as i32))
                        .collect();
                    let mut y = top;
                    'rows: loop {
                        let mut next_y = f32::INFINITY;
                        for col in 0..columns {
                            let x = left + col as f32 * 264.;
                            let mut free = true;
                            for r in &boxes {
                                if x < r.x + r.w + pad
                                    && x + 232. + pad > r.x
                                    && y < r.y + r.h + pad
                                    && y + 164. + pad > r.y
                                {
                                    free = false;
                                    next_y = next_y.min(r.y + r.h + pad);
                                }
                            }
                            if free {
                                b.pin_at = Some((x, y));
                                break 'rows;
                            }
                        }
                        if !next_y.is_finite() || next_y <= y {
                            break;
                        }
                        y = next_y;
                    }
                }
                b.menu = labels(&["note", "ink", "image", "link", "existing", "existing-group"]);
            }
            "note" | "ink" => {
                b.create(store, cmd, "")?;
                b.edit(if cmd == "ink" { 2 } else { 1 });
            }
            "image" => choose_image(b.pin_at),
            "copy-url" if c["kind"] == "link" => {
                let ui = self.bar.global::<BoardUi>();
                ui.set_copy_value(text(&c, "url").into());
                ui.set_copy_request(ui.get_copy_request().wrapping_add(1));
            }
            "open" if b.source.is_some() => {
                let src = b.source.take().unwrap();
                b.thread(store, &src, &select, "tie")?;
            }
            "open" if c["kind"] == "link" => {
                if let Some(url) = notebook::web_address(text(&c, "url")) {
                    open_notepad_link(url);
                }
            }
            "open" if !c.is_null() => {
                b.edit(if c["kind"] == "image" {
                    3
                } else if c["mode"] == "ink" {
                    2
                } else {
                    1
                });
            }
            "mode" | "draw" | "write" if c["kind"] == "note" => {
                if b.maximized {
                    self.board_maximize(false);
                    return self.board_command(cmd);
                }
                let ink = cmd == "draw" || (cmd == "mode" && b.editor != 2);
                b.field(store, "mode", json!(if ink { "ink" } else { "text" }))?;
                b.edit(if ink { 2 } else { 1 });
            }
            "maximize" if b.editor == 2 => {
                let on = !b.maximized;
                self.board_maximize(on);
            }
            "tie" => {
                if b.placed().len() > 1 {
                    b.source = Some(select);
                    b.editor = 0;
                } else {
                    b.message = label("two", l).into();
                }
            }
            "keep-draft" if b.pending_ink.is_some() => {
                b.cards = db::cards(&store.conn)?;
                b.flush(store)?;
            }
            "keep-draft" => {
                let current = db::cards(&store.conn)?
                    .into_iter()
                    .find(|c| c["id"] == select)
                    .ok_or("conflict")?;
                if b.title == text(&b.original, "title") {
                    b.title = text(&current, "title").into();
                }
                if b.body == text(&b.original, "text") {
                    b.body = text(&current, "text").into();
                }
                b.original = current;
                b.flush(store)?;
            }
            "reload" => {
                b.cards = db::cards(&store.conn)?;
                b.pending_ink = None;
                b.ink.path.clear();
                b.edit(b.editor);
            }
            "pens" => b.menu = labels(&["pen", "pencil", "marker"]),
            "selects" => b.menu = labels(&["rect", "lasso"]),
            "color" => {
                let colors: &[(&str, &str)] = if b.ink.prefs.tool == "marker" {
                    &[
                        ("#ffe14d", "yellow"),
                        ("#7ee07e", "green"),
                        ("#ff7ac8", "pink"),
                        ("#6cc4ff", "blue"),
                        ("#ffb347", "orange"),
                    ]
                } else {
                    &[
                        ("#1f1f1f", "black"),
                        ("#2457c5", "blue"),
                        ("#c9302c", "red"),
                        ("#2e8b57", "green"),
                        ("#7b3fb3", "purple"),
                        ("#7a4b28", "brown"),
                        ("#7d7d7d", "grey"),
                        ("#e07b1a", "orange"),
                    ]
                };
                b.menu.push(("recent:".into(), label("ink-default", l).into()));
                b.menu.extend(
                    colors
                        .iter()
                        .map(|(hex, key)| (format!("recent:{hex}"), label(key, l).into())),
                );
                for value in &b.ink.prefs.recent {
                    if !colors.iter().any(|(hex, _)| value.eq_ignore_ascii_case(hex)) {
                        b.menu.push((format!("recent:{value}"), value.clone()));
                    }
                }
                b.menu_at = b
                    .menu
                    .iter()
                    .position(|(cmd, _)| cmd[7..].eq_ignore_ascii_case(&b.ink.prefs.color))
                    .unwrap_or(0);
                b.menu.extend(labels(&["custom-color"]));
            }
            "size" => {
                let widths = match b.ink.prefs.tool.as_str() {
                    "pencil" => [1., 2., 4.],
                    "marker" => [8., 14., 24.],
                    "eraser" => [8., 18., 36.],
                    _ => [1.5, 3., 6.],
                };
                b.menu = widths
                    .into_iter()
                    .map(|n| (format!("width:{n}"), n.to_string()))
                    .collect();
                b.menu_at = b
                    .menu
                    .iter()
                    .position(|(_, size)| size.parse::<f32>() == Ok(b.ink.prefs.size))
                    .unwrap_or(3);
                b.menu.extend(labels(&["custom-size"]));
            }
            cmd if cmd.starts_with("width:") => {
                b.ink.prefs.size = cmd[6..]
                    .parse::<f32>()
                    .map_err(|_| label("invalid", l))?
                    .clamp(0.5, 96.);
                b.modify_ink(store, "size", 0., 0.)?;
            }
            "actions" if b.editor == 2 => {
                b.menu = labels(&[
                    "pens", "eraser", "selects", "color", "size", "pressure", "pattern", "spacing",
                    "zoom-in", "zoom-out", "reset-view",
                ]);
                if !b.ink.selected.is_empty() {
                    b.menu.extend(labels(&["scale-up", "scale-down", "delete-selection"]));
                }
            }
            "actions" | "card-actions" if !c.is_null() => {
                b.menu = labels(&["open", "tie"]);
                if c["kind"] == "link" {
                    b.menu.extend(labels(&["rename", "copy-url", "refresh-preview"]));
                } else if c["kind"] == "image" {
                    b.menu.extend(labels(&["rename"]));
                }
                if members(&c, "links").next().is_some()
                    || b.cards
                        .iter()
                        .any(|other| members(other, "links").any(|id| id == select))
                {
                    b.menu.extend(labels(&["threads"]));
                }
                if c["kind"] == "note" {
                    b.menu.extend(labels(&[
                        if c["mode"] == "ink" { "write" } else { "draw" },
                        "paper",
                        "tag",
                        "folder",
                        "detach",
                    ]));
                }
                b.menu.extend(labels(&[
                    "assign",
                    "front",
                    "reset-size",
                    "new-menu",
                    "zoom-in",
                    "zoom-out",
                    "reset-view",
                    "unpin",
                ]));
                if c["copyOf"].is_string() || b.cards.iter().any(|other| other["copyOf"] == select) {
                    b.menu.extend(labels(&["sync"]));
                }
                if b.group(&select).len() > 1 {
                    b.menu.extend(labels(&[
                        "group-name",
                        "assign-group",
                        if b.group_move { "single-move" } else { "group-move" },
                    ]));
                }
                // Deleting last, the smallest at the very bottom (↑ from the first line reaches it).
                if b.group(&select).len() > 1 {
                    b.menu.extend(labels(&["delete-group"]));
                }
                b.menu.extend(labels(&["delete"]));
            }
            "actions" => {
                b.menu = labels(&[
                    "note",
                    "ink",
                    "image",
                    "link",
                    "existing",
                    "existing-group",
                    "zoom-in",
                    "zoom-out",
                    "reset-view",
                ])
            }
            "reset-size" => b.geometry(store, board::Geometry::ResetSize)?,
            "front" => {
                let key = b.key();
                let z = b
                    .cards
                    .iter()
                    .map(|c| c["boards"][&key]["z"].as_i64().or(c["z"].as_i64()).unwrap_or(0))
                    .max()
                    .unwrap_or(0);
                let mut next = c.clone();
                board::layout_mut(&mut next, &key)["z"] = json!(z.saturating_add(1));
                b.apply(store, vec![(c, next)])?;
            }
            "zoom-in" | "zoom-out" | "reset-view" if b.editor == 2 => {
                if !b.ink.down {
                    if cmd == "reset-view" {
                        b.ink.pan = [0., 0.];
                        b.ink_zoom = 1.;
                    } else {
                        let center = [self.bar.get_board_canvas_w() / 2., self.bar.get_board_canvas_h() / 2.];
                        b.navigate_ink(if cmd == "zoom-in" { 1.2 } else { 1. / 1.2 }, center, center, self.bar.get_board_canvas_scale());
                    }
                }
            }
            "zoom-in" | "zoom-out" | "reset-view" => self.bar.global::<BoardUi>().invoke_viewport(cmd.into()),
            "paper-next" => {
                let next = match text(&c, "paper") {
                    "blue" => "green",
                    "green" => "pink",
                    "pink" => "yellow",
                    _ => "blue",
                };
                b.field(store, "paper", json!(next))?;
            }
            "group-move" | "single-move" => b.group_move = cmd == "group-move",
            "threads" => {
                for other in &b.cards {
                    let id = text(other, "id");
                    if members(&c, "links").any(|s| s == id) || members(other, "links").any(|s| s == select) {
                        b.menu.push((format!("edge:{id}"), name(other, l)));
                    }
                }
            }
            "cut" | "reverse" => {
                if let Some((a, z)) = b.edge.take() {
                    b.thread(store, &a, &z, cmd)?;
                }
            }
            "paper" => b.menu = labels(&["yellow", "blue", "green", "pink"]),
            "yellow" | "pink" | "blue" | "green" => b.field(store, "paper", json!(cmd))?,
            "tag" => {
                b.tags = store.tags().map_err(|e| e.to_string())?;
                b.menu = vec![("tag:".into(), texts::form_texts(l).no_tag.into())];
                b.menu
                    .extend(b.tags.iter().map(|t| (format!("tag:{}", t.id), t.name.clone())));
            }
            "folder" => {
                b.menu = vec![("folder:".into(), label("none", l).into())];
                b.menu.extend(
                    notebook::folders(store)
                        .map_err(|e| format!("{e:?}"))?
                        .into_iter()
                        .map(|(id, n)| (format!("folder:{id}"), n)),
                );
            }
            "assign" | "assign-group" => {
                for p in self.state.board_scopes.iter().flatten() {
                    b.menu.push((
                        format!("scope:{}:{}", *p as usize, cmd == "assign-group"),
                        p.command(l)[1..].into(),
                    ));
                }
            }
            "unpin" => {
                let mut n = c.clone();
                board::assign(&mut n, &b.key(), false);
                b.apply(store, vec![(c, n)])?;
                b.editor = 0;
            }
            "existing" | "existing-group" => {
                b.menu = b
                    .library()
                    .into_iter()
                    .map(|note| {
                        (
                            format!("copy:{}:{}", cmd == "existing-group", text(note, "id")),
                            name(note, l),
                        )
                    })
                    .collect();
                b.menu.sort_by(|a, z| a.1.cmp(&z.1));
            }
            "sync" => b.toggle_sync(store)?,
            "delete" | "delete-group" => {
                b.menu = vec![
                    ("dismiss".into(), label("cancel", l).into()),
                    (format!("confirm:{cmd}"), label("confirm", l).into()),
                ]
            }
            "undo" | "redo" => {
                journal_core::history::step(store, cmd == "redo").map_err(|e| e.to_string())?;
                b.cards = db::cards(&store.conn)?;
                b.ensure_selected();
                if b.selected_card().is_some() {
                    b.edit(b.editor);
                } else {
                    b.editor = 0;
                }
            }
            "refresh-preview" if c["kind"] == "link" => fetch_link_preview(select.clone(), text(&c, "url").to_string()),
            "link" | "rename" | "group-name" | "custom-color" | "custom-size" | "spacing" => {
                if cmd == "link" { b.link_draft = None; }
                self.bar.global::<BoardUi>().set_value(match cmd {
                    "group-name" => text(&c, "groupName").into(),
                    "rename" => text(&c, "title").into(),
                    "custom-size" => b.ink.prefs.size.to_string().into(),
                    "custom-color" => b.ink.prefs.color.clone().into(),
                    "spacing" => c["inkPaper"]["step"].as_i64().unwrap_or(20).to_string().into(),
                    _ => "".into(),
                });
                b.prompt = Some(cmd.into());
            }
            "submit" => {
                let Some(prompt) = b.prompt.clone() else { return Ok(()) };
                match prompt.as_str() {
                    // First the address, then its title on a second line of its own.
                    "link" => {
                        let url = notebook::web_address(&value).ok_or(label("invalid", l))?;
                        b.link_draft = Some(url);
                        self.bar.global::<BoardUi>().set_value("".into());
                        b.prompt = Some("link-title".into());
                        return Ok(());
                    }
                    "link-title" => {
                        let Some(url) = b.link_draft.take() else { return Ok(()) };
                        b.create(store, "link", &url)?;
                        let title = value.trim();
                        if !title.is_empty() {
                            b.field(store, "title", json!(title))?;
                        }
                        b.editor = 0;
                        fetch_link_preview(b.selected.clone(), url);
                    }
                    "rename" => {
                        let title = value.trim();
                        if !title.is_empty() && title != text(&c, "title") {
                            b.field(store, "title", json!(title))?;
                        }
                    }
                    "group-name" => {
                        let ids = b.group(&select);
                        let changes = b
                            .cards
                            .iter()
                            .filter(|c| ids.contains(text(c, "id")))
                            .map(|c| {
                                let mut n = c.clone();
                                n["groupName"] = json!(value);
                                (c.clone(), n)
                            })
                            .collect();
                        b.apply(store, changes)?;
                    }
                    "custom-color" => {
                        if !(value.is_empty()
                            || value.len() == 7
                                && value.starts_with('#')
                                && value[1..].bytes().all(|c| c.is_ascii_hexdigit()))
                        {
                            return Err(label("invalid", l).into());
                        }
                        b.ink.prefs.remember(value);
                        b.modify_ink(store, "color", 0., 0.)?;
                    }
                    "custom-size" => {
                        b.ink.prefs.size = value
                            .replace(',', ".")
                            .parse::<f32>()
                            .ok()
                            .filter(|n| (0.5..=96.).contains(n))
                            .ok_or(label("invalid", l))?;
                        b.modify_ink(store, "size", 0., 0.)?;
                    }
                    "spacing" => {
                        let n = value
                            .parse::<u32>()
                            .ok()
                            .filter(|v| (4..=200).contains(v))
                            .ok_or(label("invalid", l))?;
                        let kind = c["inkPaper"]["kind"].as_str().unwrap_or("lines");
                        b.field(store, "inkPaper", json!({"kind":kind,"step":n}))?;
                    }
                    _ => {
                        let date =
                            chrono::NaiveDate::parse_from_str(&value, "%Y-%m-%d").map_err(|_| label("invalid", l))?;
                        let (index, whole) = prompt["date:".len()..].split_once(':').ok_or("period")?;
                        let p = *Period::ALL
                            .get(index.parse::<usize>().map_err(|_| "period")?)
                            .ok_or("period")?;
                        if !self.state.board_scopes.as_ref().is_some_and(|s| s.contains(&p)) {
                            return Err(label("unavailable", l).into());
                        }
                        b.pin(store, &p.key(date), whole == "true")?;
                        if b.selected != select {
                            b.editor = 0;
                        }
                    }
                }
                b.prompt = None;
            }
            "pattern" => b.menu = labels(&["blank", "lines", "grid", "dots"]),
            "blank" | "lines" | "grid" | "dots" => b.field(
                store,
                "inkPaper",
                if cmd == "blank" {
                    Value::Null
                } else {
                    json!({"kind":cmd,"step":c["inkPaper"]["step"].as_i64().unwrap_or(20)})
                },
            )?,
            "pen" | "pencil" | "marker" | "eraser" | "rect" | "lasso" => {
                b.ink.prefs.select(cmd);
                b.ink.selected.clear();
            }
            _ if cmd.starts_with("recent:") => {
                b.ink.prefs.remember(cmd[7..].into());
                b.modify_ink(store, "color", 0., 0.)?;
            }
            "pressure" => b.ink.prefs.pressure = !b.ink.prefs.pressure,
            "delete-selection" => {
                b.modify_ink(store, "delete", 0., 0.)?;
                b.ink.selected.clear();
            }
            "scale-up" | "scale-down" => {
                b.modify_ink(store, "scale", if cmd == "scale-up" { 1.2 } else { 1. / 1.2 }, 0.)?
            }
            "detach" => {
                self.float_board_note()?;
            }
            _ if cmd.starts_with("scope:") => {
                b.prompt = Some(format!("date:{}", &cmd[6..]));
                self.bar.global::<BoardUi>().set_value(b.date.to_string().into());
            }
            _ if cmd.starts_with("copy:") => {
                if let Some((group, id)) = cmd[5..].split_once(':') {
                    b.copy(store, id, group == "true")?;
                    b.editor = 0;
                }
            }
            _ if cmd.starts_with("edge:") => {
                let other = &cmd[5..];
                b.edge = Some((select, other.into()));
                b.menu = labels(&["cut"]);
                if c["kind"] == "note" && b.card(other).is_some_and(|v| v["kind"] == "note") {
                    b.menu.extend(labels(&["reverse"]));
                }
            }
            _ if cmd.starts_with("new-tag:") => {
                let tag = crate::tag_edit::create(store, &cmd[8..])?;
                b.tags = store.tags().map_err(|e| e.to_string())?;
                b.field(store, "tag", json!(tag.id))?;
                b.edit_tag = Some(tag.id);
            }
            _ if cmd.starts_with("new-folder:") => {
                let id = notebook::create_folder(store, &cmd[11..], None).map_err(|e| format!("{e:?}"))?;
                b.field(store, "folder", json!(id))?;
            }
            _ if cmd.starts_with("tag:") || cmd.starts_with("folder:") => {
                let (k, v) = cmd.split_once(':').unwrap();
                b.field(store, k, if v.is_empty() { Value::Null } else { json!(v) })?;
            }
            _ if cmd.starts_with("confirm:") => {
                b.remove(store, cmd == "confirm:delete-group")?;
                b.editor = 0;
            }
            _ => {}
        }
        if matches!(cmd, "threads" | "existing" | "existing-group")
            && self.board.as_ref().is_some_and(|b| b.menu.is_empty())
        {
            self.board.as_mut().unwrap().message = label("empty-list", l).into();
        }
        if cmd.starts_with("recent:")
            || cmd.starts_with("width:")
            || matches!(
                cmd,
                "submit" | "pressure" | "pen" | "pencil" | "marker" | "eraser" | "rect" | "lasso"
            )
        {
            if let (Some(path), Some(b)) = (self.board_path("j-terminal-ink.json"), self.board.as_ref()) {
                let tmp = path.with_extension("tmp");
                std::fs::write(&tmp, serde_json::to_vec(&b.ink.prefs).map_err(|e| e.to_string())?)
                    .and_then(|_| std::fs::rename(tmp, path))
                    .map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }
}
fn thread(b: &Board, indices: &HashMap<&str, i32>, a: &str, z: &str, preview: bool) -> BoardThread {
    let arrow = b.card(a).is_some_and(|c| c["kind"] == "note") && b.card(z).is_some_and(|c| c["kind"] == "note");
    let (first, second) = if arrow && !preview && !b.directed(a, z) {
        (z, a)
    } else {
        (a, z)
    };
    BoardThread {
        first: indices[first],
        second: indices[second],
        arrow,
        preview,
        a: a.into(),
        b: z.into(),
    }
}

impl App {
    fn select_board(&mut self, id: &str) -> Result<(), String> {
        self.flush_board()?;
        let Some(b) = &mut self.board else { return Ok(()) };
        if b.maximized {
            return Ok(());
        }
        if b.source.is_some() {
            let from = b.source.take().unwrap();
            if let Some(j) = &mut self.state.journal {
                b.thread(&mut j.store, &from, id, "tie")?;
            }
        }
        b.selected = id.into();
        b.editor = 0;
        b.menu.clear();
        b.menu_page.clear();
        b.menu_history.clear();
        b.ink.selected.clear();
        self.draw_board();
        focus(&self.bar.global::<BoardUi>());
        Ok(())
    }
    fn board_key(&mut self, raw: &str, mask: i32, repeat: bool) -> bool {
        use day::K;
        let Some(b) = &mut self.board else { return false };
        let key = day_key(raw);
        let escape = matches!(key, Some(K::Escape));
        let enter = matches!(key, Some(K::Enter));
        if repeat && (escape || enter) {
            return true;
        }
        let bar = self.bar.clone_strong();
        let ui = bar.global::<BoardUi>();
        if escape && !ui.get_operation().is_empty() {
            ui.invoke_cancel_gesture();
            return true;
        }
        if b.prompt.is_some() {
            if escape {
                self.board_menu_back();
            } else if enter {
                self.run_board("submit");
            } else {
                return false;
            }
            return true;
        }
        if !b.menu_page.is_empty() {
            let n = b.visible_choices.len();
            if escape {
                self.board_menu_back();
            } else if enter {
                if let Some(&i) = b.visible_choices.get(b.menu_at) {
                    if let Some(cmd) = b.menu.get(i).map(|r| r.0.clone()).or_else(|| b.new_choice.clone()) {
                        self.run_board(&cmd);
                    }
                }
            } else if matches!(b.menu_page.as_str(), "color" | "size")
                && matches!(
                    key,
                    Some(K::Up | K::Down | K::Left | K::Right | K::Home | K::End | K::Tab | K::BackTab)
                )
                && n > 0
            {
                let cols = if b.menu_page == "color" { 5 } else { 3 };
                b.menu_at = match key {
                    Some(K::Home) => 0,
                    Some(K::End) => n - 1,
                    Some(K::Up) => b.menu_at.saturating_sub(cols),
                    Some(K::Down) => (b.menu_at + cols).min(n - 1),
                    Some(K::Left | K::BackTab) => (b.menu_at + n - 1) % n,
                    Some(K::Tab) if mask == 1 => (b.menu_at + n - 1) % n,
                    _ => (b.menu_at + 1) % n,
                };
                ui.set_option_index(b.menu_at as i32);
            } else if matches!(key, Some(K::Up | K::Down | K::Tab | K::BackTab)) {
                if n > 0 {
                    let back = matches!(key, Some(K::Up | K::BackTab)) || mask == 1;
                    b.menu_at = (b.menu_at + if back { n - 1 } else { 1 }) % n;
                    ui.set_option_index(b.menu_at as i32);
                    if b.menu_page == "tag" {
                        self.draw_board_menu();
                    }
                }
            } else {
                return false;
            }
            return true;
        }
        if escape {
            self.run_board("back");
            return true;
        }
        if raw.chars().next() == Some(char::from(slint::platform::Key::F11)) {
            if !repeat {
                self.run_board("maximize");
            }
            return true;
        }
        if b.editor == 2 && matches!(mask, 2 | 3) {
            let camera = match raw {
                "+" | "=" => Some("zoom-in"),
                "-" => Some("zoom-out"),
                "0" => Some("reset-view"),
                _ => None,
            };
            if let Some(cmd) = camera {
                self.run_board(cmd);
                return true;
            }
        }
        if mask == 2 {
            let cmd = match raw.to_ascii_lowercase().as_str() {
                "k" => "actions",
                "n" => "new-menu",
                "s" => "retry",
                "z" if b.editor != 1 => "undo",
                "y" if b.editor != 1 => "redo",
                _ => "",
            };
            if !cmd.is_empty() {
                if !repeat {
                    if cmd == "new-menu" {
                        b.pin_at = None;
                    }
                    // From the keyboard the actions open in their usual place.
                    if matches!(cmd, "actions" | "new-menu") {
                        self.bar.global::<BoardUi>().set_menu_compact(false);
                    }
                    self.run_board(cmd);
                }
                return true;
            }
        }
        if mask == 4 && raw.eq_ignore_ascii_case("l") && b.editor == 0 {
            if !repeat {
                self.run_board("tie");
            }
            return true;
        }
        if matches!(key, Some(K::Left | K::Right)) && mask == 2 {
            self.run_board(if matches!(key, Some(K::Left)) { "prev" } else { "next" });
            return true;
        }
        if b.editor == 1 {
            if mask == 2 && matches!(key, Some(K::Tab)) {
                ui.set_title_focus(!ui.get_title_focus());
                focus(&ui);
                return true;
            }
            return false;
        }
        if enter && b.editor == 0 {
            self.run_board("open");
            return true;
        }
        if b.editor == 2 && matches!(key, Some(K::Delete)) {
            self.run_board("delete-selection");
            return true;
        }
        let (dx, dy) = match key {
            Some(K::Up) => (0., -1.),
            Some(K::Down) => (0., 1.),
            Some(K::Left) => (-1., 0.),
            Some(K::Right) => (1., 0.),
            _ => return true,
        };
        let Some(j) = &mut self.state.journal else { return true };
        let result = if b.editor == 2 {
            if b.ink.selected.is_empty() {
                self.ink_camera(1., [dx * 32., dy * 32.], [0., 0.]);
                return true;
            } else {
                b.modify_ink(&mut j.store, "move", dx * 8., dy * 8.)
            }
        } else if b.editor != 0 {
            Ok(())
        } else if mask == 0 {
            b.navigate(dx, dy);
            Ok(())
        } else if (mask == 1 || mask == 3) && b.source.is_none() {
            let shown = ui.invoke_box_at(ui.get_selected());
            let edit = if mask == 3 {
                board::Geometry::Resize(shown.w + dx * 12., shown.h + dy * 12.)
            } else {
                board::Geometry::Move {
                    dx: dx * 12.,
                    dy: dy * 12.,
                    group: b.group_move,
                }
            };
            b.geometry(&mut j.store, edit)
        } else {
            Ok(())
        };
        if let Err(e) = result {
            self.board_error(e)
        }
        ui.set_keyboard_focus(true);
        ui.set_hover(-1);
        self.draw_board();
        ui.invoke_viewport("reveal".into());
        true
    }
    pub(super) fn board_point(&mut self, phase: i32, x: f32, y: f32, pressure: f32, eraser: bool) {
        let Some(b) = self
            .board
            .as_mut()
            .filter(|b| b.editor == 2 && b.menu.is_empty() && b.prompt.is_none())
        else {
            return;
        };
        if phase == 3 {
            b.ink_dirty = false;
            b.ink.path.clear();
            b.ink.down = false;
            self.render_canvas();
            return;
        }
        let scale = self.bar.get_board_canvas_scale();
        let (x, y) = (x / scale, y / scale);
        if phase == 0 {
            if b.pending_ink.is_some() {
                return;
            }
            let Some(c) = b.cards.iter().find(|c| text(c, "id") == b.selected) else {
                return;
            };
            b.ink.start([x + b.ink.pan[0], y + b.ink.pan[1], pressure], c, eraser);
        }
        if !b.ink.down {
            return;
        }
        let p = [x + b.ink.pan[0], y + b.ink.pan[1], pressure];
        b.ink.sample(p);
        if phase == 2 {
            self.finish_board_stroke();
        } else if phase == 0 {
            self.render_canvas();
        } else if !b.ink_dirty {
            // Take the newest coalesced input immediately before the next native paint.
            b.ink_dirty = true;
            self.bar.window().request_redraw();
        }
    }
    pub(super) fn paint_pending_ink(&mut self) {
        if self.board.as_mut().is_some_and(|b| std::mem::take(&mut b.ink_dirty) && b.ink.down) {
            self.render_canvas();
        }
    }
    pub(super) fn ink_camera(&mut self, factor: f32, from: [f32; 2], to: [f32; 2]) {
        if let Some(b) = self.board.as_mut().filter(|b| b.editor == 2 && !b.ink.down && b.menu.is_empty() && b.prompt.is_none()) {
            b.navigate_ink(factor, from, to, self.bar.get_board_canvas_scale());
            self.render_canvas();
            self.bar.window().request_redraw();
        }
    }
    pub(super) fn finish_board_stroke(&mut self) {
        let Some(b) = self.board.as_mut().filter(|b| b.ink.down) else { return };
        b.ink_dirty = false;
        if let Some(j) = &mut self.state.journal {
            if let Err(e) = b.flush(&mut j.store) {
                self.board_error(e);
                return;
            }
        }
        self.draw_board();
    }
    fn float_board_note(&mut self) -> Result<(), String> {
        let Some(b) = self.board.as_ref() else { return Ok(()) };
        let Some(c) = b.selected_card() else { return Ok(()) };
        let id = text(c, "id").to_string();
        if let Some(w) = self.floating_notes.get(&id) {
            return w.show().map_err(|e| e.to_string());
        }
        let window = FloatingBoardNote::new().map_err(|e| e.to_string())?;
        let weak = window.as_weak();
        window.global::<BoardUi>().on_grid_image(move |pitch, color| {
            super::board_surface::grid_image(pitch, color, weak.unwrap().window().scale_factor(), None)
        });
        let weak = window.as_weak();
        window.global::<BoardUi>().on_paper_dots(move |pitch, color, diameter| {
            super::board_surface::grid_image(pitch, color, weak.unwrap().window().scale_factor(), Some(diameter))
        });
        let key = id.clone();
        window.on_dismiss(move || {
            let id = key.clone();
            slint::Timer::single_shot(Duration::ZERO, move || {
                with_app(|a| {
                    if let Some(w) = a.floating_notes.remove(&id) {
                        let _ = w.hide();
                    }
                })
            });
        });
        let weak = window.as_weak();
        window.on_drag(move || {
            if let Some(w) = weak.upgrade() {
                w.window().with_winit_window(|native| {
                    let _ = native.drag_window();
                });
            }
        });
        let (period, date) = (b.period, b.date);
        let key = id.clone();
        window.on_edit(move || {
            let id = key.clone();
            with_app(|a| {
                if a.flush_board().is_err() {
                    return;
                }
                if a.board.as_ref().is_none_or(|b| b.period != period || b.date != date) {
                    a.open_board(period);
                }
                if let Some(b) = &mut a.board {
                    if b.card(&id).is_none() {
                        return;
                    }
                    b.date = date;
                    b.selected = id;
                    let mode = if b.selected_card().is_some_and(|c| c["mode"] == "ink") {
                        2
                    } else {
                        1
                    };
                    b.edit(mode);
                    let _ = a.bar.show();
                    a.bar.window().with_winit_window(|w| w.focus_window());
                    a.draw_board();
                    focus(&a.bar.global::<BoardUi>());
                }
            });
        });
        let key = id.clone();
        window.window().on_close_requested(move || {
            let id = key.clone();
            slint::Timer::single_shot(Duration::ZERO, move || {
                with_app(|a| {
                    a.floating_notes.remove(&id);
                })
            });
            slint::CloseRequestResponse::HideWindow
        });
        self.floating_notes.insert(id, window.clone_strong());
        self.refresh_floating();
        window.show().map_err(|e| e.to_string())
    }
    pub(super) fn refresh_floating(&self) {
        if self.floating_notes.is_empty() {
            return;
        }
        let Some(j) = self.state.journal.as_ref() else { return };
        if let Ok(cards) = db::cards(&j.store.conn) {
            for (id, w) in &self.floating_notes {
                if let Some(c) = cards.iter().find(|c| c["id"] == *id) {
                    w.set_note_title(name(c, self.state.language).into());
                    w.set_body(formatted(text(c, "text")));
                    w.set_is_ink(c["mode"] == "ink");
                    if c["mode"] == "ink" {
                        w.set_ink(board_ink::CachedInk::default().document(c, None));
                    }
                } else {
                    let _ = w.hide();
                }
            }
        }
    }
}
pub fn connect(bar: &Bar) {
    let ui = bar.global::<BoardUi>();
    ui.on_glyph(|name| {
        let icons = icons::all();
        icons
            .binary_search_by_key(&name.as_str(), |(id, _)| *id)
            .ok()
            .map(|i| icons[i].1.into())
            .unwrap_or_default()
    });
    ui.on_indent_edit(|text, anchor, cursor, reverse| {
        let edit = super::note_markdown::tab(&text, anchor.max(0) as usize, cursor.max(0) as usize, reverse);
        NotepadIndent { text: edit.text.into(), anchor: edit.anchor as i32, cursor: edit.cursor as i32 }
    });
    ui.on_continue_list(|text, anchor, cursor| {
        super::note_markdown::continue_list(&text, anchor.max(0) as usize, cursor.max(0) as usize)
            .map(|edit| NotepadIndent { text: edit.text.into(), anchor: edit.anchor as i32, cursor: edit.cursor as i32 })
            .unwrap_or_else(|| NotepadIndent { text, anchor: -1, cursor: -1 })
    });
    ui.on_command(|s| {
        with_app(|a| {
            if s == "new-menu" {
                if let Some(b) = &mut a.board {
                    b.pin_at = None;
                }
                a.bar.global::<BoardUi>().set_menu_compact(false);
            }
            if s == "back" && a.board.as_ref().is_some_and(|b| !b.menu.is_empty()) {
                a.run_board("dismiss");
            } else {
                a.run_board(&s);
            }
        })
    });
    ui.on_key(|s, m, repeat| with_app_value(|a| a.board_key(&s, m, repeat)));
    ui.on_choose(|i| {
        with_app(|a| {
            if let Some(cmd) = a
                .board
                .as_ref()
                .and_then(|b| b.visible_choices.get(i as usize).and_then(|row| b.menu.get(*row).map(|r| r.0.clone()).or_else(|| b.new_choice.clone())))
            {
                a.run_board(&cmd);
            }
        })
    });
    ui.on_select(|id| {
        with_app(|a| {
            if let Err(e) = a.select_board(&id) {
                a.board_error(e);
            }
        })
    });
    ui.on_edge(|left, right| {
        with_app(|a| {
            if let Err(e) = a.select_board(&left) {
                a.board_error(e);
                return;
            }
            a.run_board(&format!("edge:{right}"));
        })
    });
    super::board_surface::connect(bar);
    ui.on_filter(|query| {
        with_app(|a| {
            if let Some(b) = &mut a.board {
                b.menu_query = query.into();
                b.menu_at = 0;
            }
            a.draw_board_menu();
        })
    });
    ui.on_menu_back(|| with_app(|a| a.board_menu_back()));
    ui.on_tool(|i, cmd| {
        with_app(|a| {
            let ui = a.bar.global::<BoardUi>();
            let Some(tile) = ui.get_tiles().row_data(i as usize) else {
                return;
            };
            if a.board.as_ref().is_some_and(|b| b.selected != tile.id.as_str()) {
                if let Err(e) = a.select_board(&tile.id) {
                    a.board_error(e);
                    return;
                }
            }
            a.run_board(&cmd);
        })
    });
    ui.on_surface_menu(|x, y| {
        with_app(|a| {
            if let Some(b) = &mut a.board {
                b.pin_at = Some((x, y));
            }
            a.run_board("new-menu");
        })
    });
    ui.on_edited(|body, s| {
        with_app(|a| {
            let Some(b) = a.board.as_mut().filter(|b| b.editor == 1) else {
                return;
            };
            let ui = a.bar.global::<BoardUi>();
            let i = ui.get_selected() as usize;
            let tiles = ui.get_tiles();
            let Some(mut tile) = tiles.row_data(i) else { return };
            if body {
                b.body = s.into();
                tile.rows = model(markdown_rows(&b.body, true));
            } else {
                b.title = s.to_string();
                tile.title = s;
            }
            b.changed = Some(Instant::now());
            tiles.set_row_data(i, tile);
        });
    });
    ui.on_ink_camera(|factor, x, y, nx, ny| with_app(|a| a.ink_camera(factor, [x,y], [nx,ny])));
    ui.on_point(|p, x, y| with_app(|a| a.board_point(p, x, y, 0.5, false)));
}
fn choose_image(position: Option<(f32, f32)>) {
    #[cfg(windows)]
    slint::Timer::single_shot(Duration::ZERO, move || {
        let Some((bar, period, date)) =
            with_app_value(|a| a.board.as_ref().map(|b| (a.bar.clone_strong(), b.period, b.date)))
        else {
            return;
        };
        PICKING_IMAGE.with(|p| p.set(true));
        let path = bar
            .window()
            .with_winit_window(|w| {
                rfd::FileDialog::new()
                    .set_parent(w)
                    .add_filter("PNG / JPEG / WebP", &["png", "jpg", "jpeg", "webp"])
                    .pick_file()
            })
            .flatten();
        super::picking_done();
        let Some(path) = path else { return };
        std::thread::spawn(move || {
            let image = notebook::Attachment::image(&path);
            let _ = slint::invoke_from_event_loop(move || {
                with_app(|a| {
                    let result = (|| {
                        let Some(j) = &mut a.state.journal else { return Ok(()) };
                        let attachment = image.map_err(|e| format!("{e:?}"))?;
                        let id = attachment.pin(&mut j.store, &j.vault, date, &period.key(date), position)?;
                        if let Some(b) = &mut a.board {
                            b.cards = db::cards(&j.store.conn)?;
                            if b.period == period && b.date == date {
                                b.selected = id;
                            }
                        }
                        Ok(())
                    })();
                    if let Err(e) = result {
                        a.board_error(e);
                    }
                    a.draw_board();
                })
            });
        });
    });
}

// ----- Web link previews -----

thread_local! {
    /// Pictures of link previews by address; None while one loads or when it failed. Kept while the app runs.
    static LINK_PICTURES: std::cell::RefCell<HashMap<String, Option<slint::Image>>> = Default::default();
    /// Cards whose preview was already asked for in this run, so a page without one is not asked again and again.
    static LINK_ASKED: std::cell::RefCell<BTreeSet<String>> = Default::default();
}

/// Width of a preview picture's longer side, in pixels.
const LINK_PICTURE_SIZE: u32 = 640;

/// Loads the page's preview off the UI thread and writes it into the card.
fn fetch_link_preview(id: String, url: String) {
    LINK_ASKED.with_borrow_mut(|asked| asked.insert(id.clone()));
    // Tests never reach the internet.
    if cfg!(test) { return; }
    std::thread::spawn(move || {
        let result = crate::link_preview::fetch(&url);
        let _ = slint::invoke_from_event_loop(move || with_app(|a| {
            match result {
                Ok(preview) => {
                    if let Err(e) = a.apply_link_preview(&id, &url, preview) { a.board_error(e); }
                }
                Err(e) => eprintln!("J-TerminaL: link preview {url}: {e}"),
            }
            a.draw_board();
        }));
    });
}

/// The preview picture of a link card: from the cache, or loading in the background (then drawn again).
fn link_picture(address: &str) -> slint::Image {
    if address.starts_with("data:") {
        return note_images::inline(address, LINK_PICTURE_SIZE).map(|im| note_images::to_slint(&im)).unwrap_or_default();
    }
    if cfg!(test) || !(address.starts_with("https://") || address.starts_with("http://")) { return Default::default(); }
    if let Some(known) = LINK_PICTURES.with_borrow(|pictures| pictures.get(address).cloned()) {
        return known.unwrap_or_default();
    }
    LINK_PICTURES.with_borrow_mut(|pictures| pictures.insert(address.to_string(), None));
    let address = address.to_string();
    std::thread::spawn(move || {
        let picture = crate::link_preview::image(&address, LINK_PICTURE_SIZE);
        let _ = slint::invoke_from_event_loop(move || {
            let Some(picture) = picture else { return };
            LINK_PICTURES.with_borrow_mut(|pictures| pictures.insert(address, Some(note_images::to_slint(&picture))));
            with_app(|a| a.draw_board());
        });
    });
    Default::default()
}

impl App {
    /// Writes a fetched preview into the card (and its synced copies). A title the user gave stays.
    pub(super) fn apply_link_preview(&mut self, id: &str, url: &str, preview: crate::link_preview::Preview) -> Result<(), String> {
        let Some(j) = &mut self.state.journal else { return Ok(()) };
        let cards = db::cards(&j.store.conn)?;
        let Some(card) = cards.iter().find(|c| c["id"] == id) else { return Ok(()) };
        if text(card, "url") != url { return Ok(()); }
        let mut next = card.clone();
        let current = text(card, "title");
        if (current.is_empty() || current == url) && !preview.title.is_empty() {
            next["title"] = json!(preview.title);
        }
        next["pageTitle"] = json!(preview.title);
        next["text"] = json!(preview.description);
        next["site"] = json!(preview.site);
        next["author"] = json!(preview.author);
        next["accent"] = json!(preview.accent);
        if preview.image.is_empty() {
            if let Some(o) = next.as_object_mut() { o.remove("image"); }
        } else {
            next["image"] = json!(preview.image);
        }
        if next == *card { return Ok(()); }
        db::edit(&mut j.store, &[(card.clone(), next)])?;
        if let Some(b) = &mut self.board { b.cards = db::cards(&j.store.conn)?; }
        Ok(())
    }
}
