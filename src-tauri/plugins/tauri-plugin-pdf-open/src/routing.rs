//! Window ownership and routing without native UI calls. The caller holds the
//! broker mutex while reserving a route, before creating or loading a WebView.
use crate::intake::{OpenError, Source};
use serde::Deserialize;
use std::{
    collections::{BTreeMap, VecDeque},
    time::{Duration, Instant},
};
use uuid::Uuid;

pub const MAX_WINDOWS: usize = 16;
const RECENT_WINDOW: Duration = Duration::from_secs(2);
const MAX_RECENT: usize = MAX_WINDOWS * 4;

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowReport {
    pub has_document: bool,
    pub unsaved: bool,
    pub busy: bool,
    pub file_name: String,
    #[serde(default)]
    pub page_count: usize,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Route {
    /// An outstanding or very recent identical delivery already owns a window.
    Existing(String),
    Reuse(String),
    Create(String),
}

#[derive(Default)]
struct WindowRecord {
    report: WindowReport,
    closing: bool,
    reserved: bool,
    // A cold WebView has not reported its document yet. This reservation must
    // survive frontend loading and cannot be cleared by an early empty report.
    source: Option<Source>,
}

pub struct Routes {
    windows: BTreeMap<String, WindowRecord>,
    recent: VecDeque<(Source, String, Instant)>,
    quitting: bool,
}

impl Default for Routes {
    fn default() -> Self {
        let mut windows = BTreeMap::new();
        windows.insert("main".into(), WindowRecord::default());
        Self {
            windows,
            recent: VecDeque::new(),
            quitting: false,
        }
    }
}

fn window_limit() -> OpenError {
    OpenError {
        code: "window_limit",
        message: "Es sind bereits 16 PDF-Fenster geöffnet. Bitte zuerst ein Fenster schließen.",
    }
}

impl Routes {
    pub fn registered(&self, label: &str) -> bool {
        self.windows.contains_key(label)
    }

    pub fn labels(&self) -> Vec<String> {
        self.windows.keys().cloned().collect()
    }

    pub fn window_report(&self, label: &str) -> Option<&WindowReport> {
        self.windows.get(label).map(|record| &record.report)
    }

    fn allocate(&mut self) -> Result<String, OpenError> {
        if self.windows.len() >= MAX_WINDOWS {
            return Err(window_limit());
        }
        let label = loop {
            let candidate = format!("pdf-{}", Uuid::new_v4());
            if !self.windows.contains_key(&candidate) {
                break candidate;
            }
        };
        self.windows.insert(label.clone(), WindowRecord::default());
        Ok(label)
    }

    /// Reserve an explicit new, empty window. Failure to create its native UI
    /// must call remove(), which also releases its capacity and dedup records.
    pub fn register_empty(&mut self) -> Result<String, OpenError> {
        self.allocate()
    }

    pub fn route(&mut self, source: &Source, now: Instant) -> Result<Route, OpenError> {
        self.recent.retain(|(_, label, time)| {
            self.windows
                .get(label)
                .is_some_and(|record| !record.closing)
                && now.saturating_duration_since(*time) < RECENT_WINDOW
        });
        // Pending requests remain deduplicated even when a provider is slow or
        // a user has left a confirmation open longer than the recent window.
        if let Some((label, _)) = self
            .windows
            .iter()
            .find(|(_, record)| !record.closing && record.source.as_ref() == Some(source))
        {
            return Ok(Route::Existing(label.clone()));
        }
        if let Some((_, label, _)) = self
            .recent
            .iter()
            .find(|(previous, _, _)| previous == source)
        {
            return Ok(Route::Existing(label.clone()));
        }
        let available = self.windows.iter().find_map(|(label, record)| {
            (!record.report.has_document
                && !record.report.unsaved
                && !record.report.busy
                && !record.closing
                && !record.reserved)
                .then(|| label.clone())
        });
        let (label, create) = match available {
            Some(label) => (label, false),
            None => (self.allocate()?, true),
        };
        let record = self.windows.get_mut(&label).unwrap();
        record.reserved = true;
        record.source = Some(source.clone());
        self.recent.push_back((source.clone(), label.clone(), now));
        while self.recent.len() > MAX_RECENT {
            self.recent.pop_front();
        }
        Ok(if create {
            Route::Create(label)
        } else {
            Route::Reuse(label)
        })
    }

    pub fn report(&mut self, label: &str, report: WindowReport) -> Result<(), OpenError> {
        let record = self.windows.get_mut(label).ok_or_else(OpenError::invalid)?;
        record.report = report;
        if record.source.is_none() && record.report.has_document {
            record.reserved = false;
        }
        Ok(())
    }

    /// Completion clears source deduplication, but an empty/stale React report
    /// must not make a just-imported window available for a second document.
    /// Failed empty windows conservatively stay reserved until closed or until
    /// a successfully opened document is reported.
    pub fn release(&mut self, label: &str) {
        if let Some(record) = self.windows.get_mut(label) {
            record.source = None;
            if record.report.has_document {
                record.reserved = false;
            }
        }
    }

    /// Mark an approved close before the UI-thread destruction is scheduled.
    /// Incoming Finder events must not reserve a window that is about to leave.
    pub fn begin_close(&mut self, label: &str) -> Result<(), OpenError> {
        let record = self.windows.get_mut(label).ok_or_else(OpenError::invalid)?;
        if record.closing {
            return Err(OpenError::invalid());
        }
        record.closing = true;
        Ok(())
    }

    pub fn cancel_close(&mut self, label: &str) {
        if let Some(record) = self.windows.get_mut(label) {
            record.closing = false;
        }
    }

    /// Returns whether an approved quit has now closed its final owned window.
    pub fn remove(&mut self, label: &str) -> bool {
        let removed = self.windows.remove(label).is_some();
        self.recent.retain(|(_, owner, _)| owner != label);
        removed && self.quitting && self.windows.is_empty()
    }

    /// Native quit requests close each window through its own guarded handler.
    /// Repeated OS/menu quit notifications must not create duplicate prompts.
    pub fn request_quit(&mut self) -> Vec<String> {
        if self.quitting {
            return Vec::new();
        }
        self.quitting = true;
        self.windows
            .iter()
            .filter(|(_, record)| !record.closing)
            .map(|(label, _)| label.clone())
            .collect()
    }

    pub fn cancel_quit(&mut self) {
        self.quitting = false;
    }

    pub fn is_quitting(&self) -> bool {
        self.quitting
    }

    pub fn is_empty(&self) -> bool {
        self.windows.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn source(index: usize) -> Source {
        Source::Local(PathBuf::from(format!("Plan Süd {index}.pdf")))
    }

    fn occupied(dirty: bool) -> WindowReport {
        WindowReport {
            has_document: true,
            unsaved: dirty,
            busy: false,
            file_name: "Plan Süd.pdf".into(),
            page_count: 1,
        }
    }

    fn owner(route: Route) -> String {
        match route {
            Route::Existing(label) | Route::Reuse(label) | Route::Create(label) => label,
        }
    }

    #[test]
    fn first_cold_open_reserves_main_before_the_frontend_reports() {
        let mut routes = Routes::default();
        let now = Instant::now();
        assert_eq!(
            routes.route(&source(1), now).unwrap(),
            Route::Reuse("main".into())
        );
        routes.report("main", WindowReport::default()).unwrap();
        assert!(matches!(
            routes.route(&source(2), now).unwrap(),
            Route::Create(_)
        ));
        assert_eq!(routes.labels().len(), 2);
    }

    #[test]
    fn an_ack_before_react_reports_cannot_reuse_the_just_imported_window() {
        let mut routes = Routes::default();
        let now = Instant::now();
        routes.route(&source(1), now).unwrap();
        routes.release("main");
        routes.report("main", WindowReport::default()).unwrap();
        assert!(matches!(
            routes.route(&source(2), now).unwrap(),
            Route::Create(_)
        ));
        routes.report("main", occupied(false)).unwrap();
        assert!(matches!(
            routes.route(&source(3), now).unwrap(),
            Route::Create(_)
        ));
        // An acknowledged failed import is not a permanent Source binding.
        assert!(matches!(
            routes
                .route(&source(1), now + Duration::from_secs(3))
                .unwrap(),
            Route::Create(_)
        ));
        assert_eq!(routes.window_report("main").unwrap().page_count, 1);
    }

    #[test]
    fn occupied_dirty_busy_and_reserved_windows_are_never_reused() {
        let mut routes = Routes::default();
        routes.report("main", occupied(true)).unwrap();
        let next = owner(routes.route(&source(1), Instant::now()).unwrap());
        assert_ne!(next, "main");
        assert!(routes.window_report("main").unwrap().unsaved);
        routes.release(&next);
        routes
            .report(
                &next,
                WindowReport {
                    busy: true,
                    ..Default::default()
                },
            )
            .unwrap();
        let third = owner(routes.route(&source(2), Instant::now()).unwrap());
        assert_ne!(third, next);
        routes
            .report(
                &third,
                WindowReport {
                    unsaved: true,
                    ..Default::default()
                },
            )
            .unwrap();
        routes.release(&third);
        assert!(matches!(
            routes.route(&source(3), Instant::now()).unwrap(),
            Route::Create(_)
        ));
    }

    #[test]
    fn an_explicit_empty_window_is_reused_for_a_later_finder_open() {
        let mut routes = Routes::default();
        routes.report("main", occupied(false)).unwrap();
        let empty = routes.register_empty().unwrap();
        assert!(Uuid::parse_str(empty.strip_prefix("pdf-").unwrap()).is_ok());
        assert_eq!(
            routes.route(&source(1), Instant::now()).unwrap(),
            Route::Reuse(empty)
        );
    }

    #[test]
    fn duplicate_pending_and_recent_deliveries_focus_their_owner_only() {
        let mut routes = Routes::default();
        let now = Instant::now();
        routes.route(&source(1), now).unwrap();
        assert_eq!(
            routes
                .route(&source(1), now + Duration::from_secs(10))
                .unwrap(),
            Route::Existing("main".into())
        );
        routes.report("main", occupied(false)).unwrap();
        routes.release("main");
        assert!(matches!(
            routes
                .route(&source(1), now + Duration::from_secs(11))
                .unwrap(),
            Route::Create(_)
        ));

        let mut recent = Routes::default();
        recent.route(&source(2), now).unwrap();
        recent.release("main");
        assert_eq!(
            recent
                .route(&source(2), now + Duration::from_millis(500))
                .unwrap(),
            Route::Existing("main".into())
        );
        assert_eq!(recent.labels().len(), 1);
    }

    #[test]
    fn closing_one_window_does_not_remove_another_documents_state() {
        let mut routes = Routes::default();
        routes.report("main", occupied(true)).unwrap();
        let other = routes.register_empty().unwrap();
        routes.report(&other, occupied(true)).unwrap();
        assert!(!routes.remove("main"));
        assert!(routes.registered(&other));
        assert!(routes.window_report(&other).unwrap().unsaved);
        assert!(!routes.registered("main"));
    }

    #[test]
    fn removed_owners_do_not_absorb_duplicate_delivery_or_hold_capacity() {
        let mut routes = Routes::default();
        let now = Instant::now();
        routes.route(&source(1), now).unwrap();
        routes.remove("main");
        assert!(matches!(
            routes.route(&source(1), now).unwrap(),
            Route::Create(_)
        ));
        assert_eq!(routes.labels().len(), 1);
    }

    #[test]
    fn unregistered_windows_cannot_claim_or_report_another_window() {
        let mut routes = Routes::default();
        assert!(routes.report("untrusted", occupied(false)).is_err());
        routes.release("untrusted");
        assert!(!routes.remove("untrusted"));
        assert_eq!(routes.labels(), vec!["main"]);
        assert!(routes.begin_close("untrusted").is_err());
    }

    #[test]
    fn the_window_limit_is_bounded_and_failed_creation_can_be_rolled_back() {
        let mut routes = Routes::default();
        for _ in 1..MAX_WINDOWS {
            routes.register_empty().unwrap();
        }
        assert_eq!(routes.register_empty().unwrap_err().code, "window_limit");
        assert_eq!(routes.labels().len(), MAX_WINDOWS);
        let removed = routes.labels().pop().unwrap();
        routes.remove(&removed);
        routes.register_empty().unwrap();
        for label in routes.labels() {
            routes.report(&label, occupied(false)).unwrap();
        }
        assert_eq!(
            routes.route(&source(99), Instant::now()).unwrap_err().code,
            "window_limit"
        );
    }

    #[test]
    fn quit_requests_are_idempotent_and_only_exit_after_all_approved_closes() {
        let mut routes = Routes::default();
        let other = routes.register_empty().unwrap();
        assert_eq!(routes.request_quit().len(), 2);
        assert!(routes.is_quitting());
        assert!(routes.request_quit().is_empty());
        assert!(!routes.remove("main"));
        assert!(routes.remove(&other));
        assert!(routes.is_empty());
        assert!(!routes.remove(&other));
    }

    #[test]
    fn cancelling_one_close_cancels_application_quit_without_erasing_reports() {
        let mut routes = Routes::default();
        routes.report("main", occupied(true)).unwrap();
        routes.request_quit();
        routes.cancel_quit();
        assert!(!routes.is_quitting());
        assert!(routes.window_report("main").unwrap().unsaved);
        assert!(!routes.remove("main"));
        assert!(routes.is_empty());
        assert!(routes.request_quit().is_empty());
        assert!(routes.is_quitting());
    }

    #[test]
    fn a_closing_empty_window_is_not_reused_and_cancellation_restores_eligibility() {
        let mut routes = Routes::default();
        routes.begin_close("main").unwrap();
        assert!(routes.begin_close("main").is_err());
        routes.report("main", WindowReport::default()).unwrap();
        let created = owner(routes.route(&source(1), Instant::now()).unwrap());
        assert_ne!(created, "main");
        routes.cancel_close("main");
        assert_eq!(
            routes.route(&source(2), Instant::now()).unwrap(),
            Route::Reuse("main".into())
        );
    }

    #[test]
    fn duplicates_do_not_target_closing_owners_and_quit_skips_already_closing_windows() {
        let mut routes = Routes::default();
        let now = Instant::now();
        routes.route(&source(1), now).unwrap();
        routes.begin_close("main").unwrap();
        let created = owner(routes.route(&source(1), now).unwrap());
        assert_ne!(created, "main");
        assert_eq!(routes.request_quit(), vec![created]);
    }
}
