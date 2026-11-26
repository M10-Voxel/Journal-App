//! The analysis over the whole window (`/Auswertung`, `ui/analysis.slint`): which period it shows, the day chosen for
//! details and the chart's hidden lines; `analysis.rs` computes what it shows.
//!
//! Keys: ← / → the period before or after, Tab / Shift+Tab week → month → quarter → year, ↑ / ↓ the graph before or
//! after (the chart, then each activity's card), Alt+← / → a day for the details in that graph only, Alt+H or Home the
//! period of today, 1–9 a line of the chart on or off, Esc back. The page keys and End scroll (in the view itself).
//! The mouse on a graph makes it the graph in focus, its day the chosen one.
use super::*;
use crate::analysis::{CardKind, Mode};
use crate::texts::analysis as tx;
use chrono::NaiveDate;
use slint::{Color, ModelRc, VecModel};
use std::{collections::BTreeSet, rc::Rc};

/// What stays while J-TerminaL runs: the last kind of period and the hidden lines (as the app keeps them on a device).
#[derive(Default)]
pub struct State {
    pub open: bool,
    pub mode: Mode,
    pub date: Option<NaiveDate>,
    pub cursor: Option<NaiveDate>,
    /// The graph in focus: 0 the chart, 1… the activities' cards. Only it shows the chosen day.
    pub focus: usize,
    /// How many graphs there are (the chart and the cards).
    graphs: usize,
    pub hidden: BTreeSet<String>,
    /// The chart's lines in their order (`toggle:N`, the digits).
    keys: Vec<String>,
}

fn model<T: 'static + Clone>(items: Vec<T>) -> ModelRc<T> { Rc::new(VecModel::from(items)).into() }
fn color([r, g, b]: calendar::Rgb) -> Color { Color::from_rgb_u8(r, g, b) }

impl App {
    pub(super) fn open_analysis(&mut self) {
        let date = self.state.day_shown();
        self.analysis.open = true;
        self.analysis.date = Some(date);
        self.analysis.cursor = None;
        self.analysis.focus = 0;
        self.bar.invoke_dismiss_preview();
        self.draw_analysis();
        let ui = self.bar.global::<AnalysisUi>();
        ui.set_focus_request(ui.get_focus_request().wrapping_add(1));
    }

    pub(super) fn close_analysis(&mut self) {
        self.analysis.open = false;
        let ui = self.bar.global::<AnalysisUi>();
        ui.set_opened(false);
        // The models go with the view (the window stays small in the background).
        ui.set_legend(ModelRc::default());
        ui.set_ticks(ModelRc::default());
        ui.set_lines(ModelRc::default());
        ui.set_points(ModelRc::default());
        ui.set_columns(ModelRc::default());
        ui.set_labels(ModelRc::default());
        ui.set_cards(ModelRc::default());
        self.draw();
        self.bar.invoke_focus_search();
    }

    /// Reads again when the journal changed; true when the view was drawn anew.
    pub(super) fn refresh_analysis(&mut self) -> bool {
        if !self.analysis.open || !self.state.refresh() { return false; }
        self.draw_analysis();
        true
    }

    pub(super) fn draw_analysis(&mut self) {
        if !self.analysis.open { return; }
        let l = usize::from(self.state.language == texts::Language::En);
        let date = self.analysis.date.unwrap_or_else(|| self.state.today());
        let view = self.state.analysis(date, self.analysis.mode, self.analysis.cursor, self.analysis.focus, &self.analysis.hidden);
        self.analysis.graphs = 1 + view.cards.len();
        self.analysis.keys = view.chart.legend.iter().map(|item| item.key.clone()).collect();
        let ui = self.bar.global::<AnalysisUi>();
        ui.set_eyebrow(view.eyebrow.into());
        ui.set_heading(view.heading.into());
        ui.set_modes(model(tx::MODES[l].iter().map(|m| (*m).into()).collect()));
        ui.set_mode(view.mode.index() as i32);
        ui.set_ratings_title(tx::RATINGS[l].into());
        ui.set_ratings_hint(tx::RATINGS_HINT[l].into());
        ui.set_activities_title(tx::ACTIVITIES[l].into());
        ui.set_activities_hint(tx::ACTIVITIES_HINT[l].into());
        ui.set_no_activities(if view.no_activities { tx::NO_ACTIVITIES[l] } else { "" }.into());
        ui.set_all_hidden(tx::ALL_HIDDEN[l].into());
        ui.set_less(tx::LESS[l].into());
        ui.set_more(tx::MORE[l].into());
        ui.set_completed(tx::COMPLETED[l].into());

        let chart = view.chart;
        ui.set_legend(model(chart.legend.into_iter().map(|item| AnalysisLegend { label: item.label.into(), stat: item.stat.into(), color: color(item.color), hidden: item.hidden }).collect()));
        ui.set_left(chart.left as f32);
        ui.set_ticks(model(chart.ticks.into_iter().map(|t| AnalysisTick { y: t.y as f32, label: t.label.into(), grid: t.grid.into() }).collect()));
        ui.set_lines(model(chart.lines.into_iter().map(|line| AnalysisLine { color: color(line.color), commands: line.commands.into() }).collect()));
        ui.set_points(model(chart.points.into_iter().map(|p| AnalysisPoint { x: p.x as f32, y: p.y as f32, color: color(p.color), active: p.active }).collect()));
        ui.set_columns(model(chart.columns.into_iter().map(|c| AnalysisColumn { x: c.x as f32, w: c.width as f32, date: c.date.to_string().into() }).collect()));
        ui.set_labels(model(chart.labels.into_iter().map(|label| AnalysisLabel { x: label.x as f32, text: label.text.into() }).collect()));
        ui.set_guide(chart.guide.unwrap_or_default().into());
        ui.set_detail(chart.detail.into());
        ui.set_hint(chart.hint);
        ui.set_empty(chart.empty);

        ui.set_cards(model(view.cards.into_iter().map(|card| AnalysisCard {
            name: card.name.into(), color: color(card.color), total: card.total.unwrap_or_default().into(), days: card.days.into(),
            kind: match card.kind { CardKind::Bars => 0, CardKind::Calendar => 1, CardKind::Contributions => 2 },
            bars: model(card.bars.into_iter().map(|bar| AnalysisBar { date: bar.date.to_string().into(), value: bar.value.into(), fraction: bar.fraction as f32, label: bar.label.into(), active: bar.active }).collect()),
            cells: model(card.cells.into_iter().map(|cell| AnalysisCell {
                date: cell.date.to_string().into(), column: cell.column as i32, row: cell.row as i32, filled: cell.fill.is_some(),
                fill: cell.fill.map(color).unwrap_or_default(), text: cell.text.into(), ink: cell.ink.map(color).unwrap_or_default(), active: cell.active,
            }).collect()),
            heads: model(card.heads.into_iter().map(|head| AnalysisHead { column: head.column as i32, row: head.row as i32, text: head.text.into() }).collect()),
            columns: card.columns as i32, rows: card.rows as i32, detail: card.detail.into(), hint: card.hint,
            palette: model(card.palette.iter().copied().map(color).collect()), track: card.track, unit: card.unit.into(),
        }).collect()));
        ui.set_focus(self.analysis.focus as i32);
        ui.set_opened(true);
    }

    fn analysis_bounds(&self) -> (NaiveDate, NaiveDate) {
        self.analysis.mode.bounds(self.analysis.date.unwrap_or_else(|| self.state.today()))
    }

    /// The chosen day stays only while it lies in the period shown.
    fn keep_cursor(&mut self) {
        let (start, end) = self.analysis_bounds();
        if self.analysis.cursor.is_some_and(|day| day < start || day > end) { self.analysis.cursor = None; }
    }

    pub(super) fn analysis_command(&mut self, command: &str) {
        let date = self.analysis.date.unwrap_or_else(|| self.state.today());
        match command {
            "back" => { self.close_analysis(); return; }
            "prev" | "next" => { self.analysis.date = Some(self.analysis.mode.step(date, command == "next")); self.analysis.cursor = None; }
            "today" => { self.analysis.date = Some(self.state.today()); self.analysis.cursor = None; }
            "mode-next" | "mode-prev" => { self.analysis.mode = self.analysis.mode.cycle(command == "mode-next"); self.keep_cursor(); }
            _ => {
                if let Some(index) = command.strip_prefix("mode:").and_then(|n| n.parse::<usize>().ok()).filter(|n| *n < Mode::ALL.len()) {
                    self.analysis.mode = Mode::ALL[index];
                    self.keep_cursor();
                } else if let Some(key) = command.strip_prefix("toggle:").and_then(|n| n.parse::<usize>().ok()).and_then(|n| self.analysis.keys.get(n).cloned()) {
                    if !self.analysis.hidden.remove(&key) { self.analysis.hidden.insert(key); }
                } else {
                    return;
                }
            }
        }
        self.draw_analysis();
    }

    /// The mouse points at a day of the graph `graph` ("" when it leaves the chart): that graph comes into focus with
    /// the day; the others show none.
    pub(super) fn analysis_point(&mut self, graph: usize, date: &str) {
        let cursor = NaiveDate::parse_from_str(date, "%Y-%m-%d").ok();
        if cursor.is_none() && graph != self.analysis.focus { return; }
        if cursor == self.analysis.cursor && graph == self.analysis.focus { return; }
        self.analysis.cursor = cursor;
        if cursor.is_some() { self.analysis.focus = graph.min(self.analysis.graphs.saturating_sub(1)); }
        self.draw_analysis();
    }

    /// ↑ / ↓: the graph before or after; the chosen day goes with it.
    fn analysis_step_graph(&mut self, by: isize) {
        let last = self.analysis.graphs.saturating_sub(1);
        let next = self.analysis.focus.saturating_add_signed(by).min(last);
        if next == self.analysis.focus { return; }
        self.analysis.focus = next;
        self.draw_analysis();
    }

    /// Alt+← / →: the day for the details, inside the period (from today when it lies in it, else from its first day).
    fn analysis_step_day(&mut self, by: i64) {
        let (start, end) = self.analysis_bounds();
        let today = self.state.today();
        let next = match self.analysis.cursor {
            Some(day) => repeat::shift(day, by).clamp(start, end),
            None if today >= start && today <= end => today,
            None => if by < 0 { end } else { start },
        };
        self.analysis.cursor = Some(next);
        self.draw_analysis();
    }

    pub(super) fn analysis_key(&mut self, raw: &str, mask: i32, repeat: bool) -> bool {
        use day::K;
        let (shift, ctrl, alt) = (mask & 1 != 0, mask & 2 != 0, mask & 4 != 0);
        let Some(key) = day_key(raw) else { return false };
        match key {
            K::Escape if !repeat => self.analysis_command("back"),
            K::Escape => {}
            K::Left | K::Right if alt && !ctrl => self.analysis_step_day(if key == K::Left { -1 } else { 1 }),
            K::Left | K::Right if !shift => self.analysis_command(if key == K::Left { "prev" } else { "next" }),
            K::Up | K::Down if !ctrl && !alt && !shift => self.analysis_step_graph(if key == K::Up { -1 } else { 1 }),
            K::Tab if !ctrl && !alt => self.analysis_command(if shift { "mode-prev" } else { "mode-next" }),
            K::BackTab if !ctrl && !alt => self.analysis_command("mode-prev"),
            K::Home if !ctrl && !alt => self.analysis_command("today"),
            K::Char('h' | 'H') if alt && !ctrl => self.analysis_command("today"),
            K::Char(c @ '1'..='9') if !ctrl && !alt => self.analysis_command(&format!("toggle:{}", c as usize - '1' as usize)),
            _ => return false,
        }
        true
    }
}

pub fn connect(bar: &Bar) {
    let ui = bar.global::<AnalysisUi>();
    ui.on_command(|command| with_app(|app| app.analysis_command(&command)));
    ui.on_point(|graph, date| with_app(|app| app.analysis_point(graph.max(0) as usize, &date)));
    ui.on_key(|raw, mask, repeat| with_app_value(|app| app.analysis_key(&raw, mask, repeat)));
}
