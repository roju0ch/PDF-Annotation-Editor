//! Per-window save ownership, independent of Tauri and native dialog APIs.
use crate::{cache::CacheInstance, storage};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};

type Result<T> = std::result::Result<T, storage::SaveError>;

struct Backend {
    // Staging handles are dropped before their private cache directory.
    sessions: storage::Sessions,
    _cache: CacheInstance,
}

#[derive(Default)]
struct Owner {
    closed: AtomicBool,
    location: Mutex<Option<(String, PathBuf)>>,
    backend: Mutex<Option<Backend>>,
}

/// A handle is tied to one actual window lifetime, not merely its label. Keeping
/// it across the picker await cannot revive a destroyed or replaced window.
#[derive(Clone, Default)]
pub struct WindowSave(Arc<Owner>);

impl WindowSave {
    // Both keys originate in native code: an accepted open ID or a verified save token.
    pub fn remember_location(&self, id: String, path: &Path) {
        if let Some(parent) = path.parent().filter(|p| p.is_absolute()) {
            if let Ok(mut location) = self.0.location.lock() {
                *location = Some((id, parent.to_owned()));
            }
        }
    }

    pub fn initial_directory(&self, id: Option<&str>) -> Option<PathBuf> {
        let location = self.0.location.lock().ok()?;
        let (key, directory) = location.as_ref()?;
        (Some(key.as_str()) == id && directory.is_dir()).then(|| directory.clone())
    }

    pub fn is_open(&self) -> bool {
        !self.0.closed.load(Ordering::Acquire)
    }

    fn require_open(&self) -> Result<()> {
        if !self.is_open() {
            Err(storage::unavailable())
        } else {
            Ok(())
        }
    }

    fn with<T>(&self, task: impl FnOnce(&mut storage::Sessions) -> Result<T>) -> Result<T> {
        self.require_open()?;
        let mut guard = self.0.backend.lock().map_err(|_| storage::unavailable())?;
        self.require_open()?;
        let backend = guard.as_mut().ok_or_else(storage::invalid)?;
        task(&mut backend.sessions)
    }

    pub fn begin(&self, root: &Path, file_name: String, byte_length: usize) -> Result<String> {
        self.require_open()?;
        let mut guard = self.0.backend.lock().map_err(|_| storage::unavailable())?;
        self.require_open()?;
        if guard.is_none() {
            let cache = CacheInstance::new(root).map_err(|_| storage::unavailable())?;
            let sessions = storage::Sessions::new(cache.directory().join("uploads"))?;
            *guard = Some(Backend {
                sessions,
                _cache: cache,
            });
        }
        // Destroy can retire ownership without blocking the UI on cache I/O.
        // Recheck after lazy initialization so a queued begin cannot resurrect it.
        self.require_open()?;
        let token = uuid::Uuid::new_v4().to_string();
        guard
            .as_mut()
            .ok_or_else(storage::invalid)?
            .sessions
            .begin(token.clone(), file_name, byte_length)?;
        Ok(token)
    }

    pub fn append(&self, token: &str, offset: usize, bytes: &[u8]) -> Result<usize> {
        self.with(|sessions| sessions.append(token, offset, bytes))
    }

    pub fn prepare(&self, token: &str) -> Result<String> {
        self.with(|sessions| sessions.prepare(token))
    }

    pub fn finish(&self, token: &str, target: Option<&Path>) -> Result<Option<String>> {
        self.with(|sessions| {
            let result = sessions.finish(token, target)?;
            if let (Some(_), Some(path)) = (&result, target) {
                self.remember_location(token.to_owned(), path);
            }
            Ok(result)
        })
    }

    pub fn abort(&self, token: &str) -> Result<()> {
        self.with(|sessions| sessions.abort(token))
    }

    /// Fast retirement runs in the native Destroyed event, before asynchronous
    /// cleanup. Any picker response or upload arriving later fails closed.
    fn retire(&self) {
        self.0.closed.store(true, Ordering::Release);
    }

    /// Filesystem cleanup may wait for already-running file I/O, so callers run
    /// it on a background thread. No other window shares this backend or cache.
    pub fn cleanup(&self) {
        let backend = self
            .0
            .backend
            .lock()
            .ok()
            .and_then(|mut guard| guard.take());
        drop(backend);
    }
}

/// Only native window lifecycle callbacks register entries. IPC can resolve an
/// existing caller, but cannot create an owner by supplying an arbitrary label.
#[derive(Default)]
pub struct Windows {
    owners: HashMap<String, WindowSave>,
}

impl Windows {
    pub fn register(&mut self, label: &str) {
        self.owners.entry(label.to_owned()).or_default();
    }

    pub fn get(&self, label: &str) -> Result<WindowSave> {
        self.owners.get(label).cloned().ok_or_else(storage::invalid)
    }

    pub fn retire(&mut self, label: &str) -> Option<WindowSave> {
        let owner = self.owners.remove(label)?;
        owner.retire();
        Some(owner)
    }
}

#[cfg(test)]
#[path = "windows_tests.rs"]
mod tests;
