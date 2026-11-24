//! The tag editor in the window: opened on a tag just made in a picker (day view, form, notepad, board), drawn from
//! `tag_edit::Editor`, and kept with Enter; Esc takes the new tag away again.
use super::*;
use tag_edit::{Editor, Key as EditKey, Part, SWATCHES};

impl App {
    /// The editor opens on the tag (the journal's latest state of it).
    pub(super) fn open_tag_editor(&mut self, id: &str) {
        let Some(journal) = self.state.journal.as_ref() else { return };
        let Some(tag) = journal.store.tags().ok().and_then(|tags| tags.into_iter().find(|t| t.id == id)) else { return };
        self.tag_editor = Some(Editor::new(&tag));
        { let ui = self.bar.global::<TagEditorUi>(); ui.set_reset(ui.get_reset().wrapping_add(1)); }
        self.draw_tag_editor();
        self.bar.global::<TagEditorUi>().set_open(true);
    }

    pub(super) fn draw_tag_editor(&mut self) {
        let Some(editor) = &self.tag_editor else { return };
        let ui = self.bar.global::<TagEditorUi>();
        let lang = self.state.language;
        let theme = self.bar.global::<Theme>();
        let scale = self.bar.window().scale_factor();
        ui.set_heading(texts::tags::heading(lang).into());
        ui.set_name_label(texts::tags::name(lang).into());
        ui.set_color_label(texts::tags::color(lang).into());
        ui.set_icon_label(texts::tags::icon(lang).into());
        ui.set_icon_placeholder(texts::tags::icon_search(lang).into());
        ui.set_name(editor.name.clone().into());
        ui.set_hue(editor.hue);
        ui.set_saturation(editor.saturation);
        ui.set_value(editor.value);
        let [r, g, b] = calendar::parse_color(&editor.color()).unwrap_or([0, 0, 0]);
        ui.set_color(slint::Color::from_rgb_u8(r, g, b));
        ui.set_hex(editor.hex.clone().into());
        ui.set_swatches(std::rc::Rc::new(slint::VecModel::from(SWATCHES.iter().map(|s| { let [r, g, b] = calendar::parse_color(s).unwrap_or([0, 0, 0]); slint::Color::from_rgb_u8(r, g, b) }).collect::<Vec<_>>())).into());
        ui.set_swatch(editor.swatch().map_or(-1, |i| i as i32));
        let mut icons: Vec<TagIcon> = editor.icons().into_iter().enumerate().map(|(i, icon)| TagIcon {
            has_icon: icon.is_some(),
            icon: icon.map(|name| icon_image(name, theme.get_icon_size(), scale)).unwrap_or_default(),
            label: icon.unwrap_or_default().into(),
            selected: i == editor.pick,
        }).collect();
        // „…“ after the common icons: every icon.
        if editor.more() {
            icons.push(TagIcon { has_icon: true, icon: icon_image("ellipsis", theme.get_icon_size(), scale), label: texts::day_texts(lang).icon_more.into(), selected: false });
        }
        ui.set_icons(std::rc::Rc::new(slint::VecModel::from(icons)).into());
        ui.set_icon_pick(editor.pick as i32);
        ui.set_icon_name(editor.icon.clone().unwrap_or_else(|| texts::tags::no_icon(lang).into()).into());
        ui.set_error(editor.error.clone().unwrap_or_default().into());
        ui.set_part(match editor.part { Part::Name => 0, Part::Field => 1, Part::Swatches => 2, Part::Hex => 3, Part::Icons => 4 });
    }

    /// Enter: the name, colour and icon are kept; everything showing the tag is drawn anew.
    fn keep_tag(&mut self) {
        let lang = self.state.language;
        let Some(editor) = self.tag_editor.clone() else { return };
        let Some(journal) = self.state.journal.as_mut() else { return };
        let tags = journal.store.tags().unwrap_or_default();
        let result = editor.checked(&tags, texts::tags::bad_name(lang))
            .and_then(|(name, color)| tag_edit::update(&mut journal.store, &editor.id, &name, &color, editor.icon.as_deref()));
        match result {
            Ok(()) => self.close_tag_editor(),
            Err(error) => {
                if let Some(editor) = &mut self.tag_editor { editor.error = Some(error); editor.part = Part::Name; }
                self.draw_tag_editor();
            }
        }
    }

    /// Esc: the tag was only just made in a picker and is not kept, so it goes again (whatever got it keeps no tag).
    fn discard_tag(&mut self) {
        let Some(editor) = self.tag_editor.clone() else { return };
        if let Some(journal) = self.state.journal.as_mut() {
            if let Err(error) = tag_edit::delete(&mut journal.store, &editor.id) { self.notice = Some(error); }
        }
        self.state.forget_tag(&editor.id);
        self.close_tag_editor();
    }

    /// Esc (or kept): the editor closes; the tag shows as it is now wherever it is used.
    fn close_tag_editor(&mut self) {
        self.tag_editor = None;
        self.bar.global::<TagEditorUi>().set_open(false);
        self.state.reload_tags();
        if let (Some(b), Some(journal)) = (self.board.as_mut(), self.state.journal.as_ref()) {
            if let Ok(tags) = journal.store.tags() { b.tags = tags; }
        }
        if self.board.is_some() { self.draw_board(); board_ui::focus_board(&self.bar); }
        else { self.draw(); self.bar.invoke_focus_line(); }
    }

    fn with_tag_editor(&mut self, change: impl FnOnce(&mut Editor)) {
        if let Some(editor) = &mut self.tag_editor { change(editor); }
        self.draw_tag_editor();
    }
}

pub(super) fn connect(bar: &Bar) {
    let ui = bar.global::<TagEditorUi>();
    ui.on_name_edited(|text| with_app(|a| a.with_tag_editor(|e| e.set_name(&text))));
    ui.on_field(|x, y| with_app(|a| a.with_tag_editor(|e| e.set_field(x, y))));
    ui.on_hue_at(|hue| with_app(|a| a.with_tag_editor(|e| e.set_hue(hue))));
    ui.on_pick_swatch(|i| with_app(|a| a.with_tag_editor(|e| e.set_swatch(i.max(0) as usize))));
    ui.on_hex_edited(|text| with_app(|a| a.with_tag_editor(|e| e.set_hex(&text))));
    ui.on_query_edited(|text| with_app(|a| a.with_tag_editor(|e| e.set_query(&text))));
    ui.on_pick_icon(|i| with_app(|a| a.with_tag_editor(|e| e.set_icon(i.max(0) as usize))));
    ui.on_focus_part(|part| with_app(|a| a.with_tag_editor(|e| e.focus([Part::Name, Part::Field, Part::Swatches, Part::Hex, Part::Icons][part.clamp(0, 4) as usize]))));
    ui.on_key(|key, shift| with_app(|a| {
        use slint::platform::Key as K;
        let is = |k: K| key.as_str() == String::from(char::from(k));
        if is(K::Return) { return a.keep_tag(); }
        if is(K::Escape) { return a.discard_tag(); }
        let key = if is(K::Tab) { if shift { EditKey::BackTab } else { EditKey::Tab } }
            else if is(K::UpArrow) { EditKey::Up } else if is(K::DownArrow) { EditKey::Down }
            else if is(K::LeftArrow) { EditKey::Left } else if is(K::RightArrow) { EditKey::Right } else { return };
        let shift = shift && !matches!(key, EditKey::Tab | EditKey::BackTab);
        a.with_tag_editor(|e| e.key(key, shift));
    }));
}
