use serde::Serialize;
use std::{
    collections::VecDeque,
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::{Component, Path, PathBuf},
    time::{Duration, Instant},
};
use url::Url;
use uuid::Uuid;

pub const MAX_PDF_BYTES: usize = 100 * 1024 * 1024;
pub const CHUNK_BYTES: usize = 256 * 1024;
pub const MAX_STAGED_BYTES: usize = 200 * 1024 * 1024;
pub(crate) const MAX_PENDING: usize = 32;
const RECENT_WINDOW: Duration = Duration::from_secs(2);

#[derive(Clone, Debug, Serialize)]
pub struct OpenError {
    pub code: &'static str,
    pub message: &'static str,
}

impl OpenError {
    pub fn invalid() -> Self {
        Self {
            code: "invalid",
            message: "Bitte eine gültige PDF-Datei auswählen (maximal 100 MB).",
        }
    }
    pub fn unavailable() -> Self {
        Self {
            code: "unavailable",
            message: "Die übergebene PDF konnte nicht geöffnet werden. Bitte erneut über die Dateien-App öffnen.",
        }
    }
    pub fn from_code(code: &str) -> Self {
        match code {
            "invalid" => Self::invalid(),
            "too_large" | "too-large" => Self { code: "too_large", ..Self::invalid() },
            "denied" => Self {
                code: "denied",
                message: "Der Zugriff auf die übergebene PDF wurde nicht erlaubt. Bitte die Datei erneut über die Dateien-App öffnen.",
            },
            "queue_full" => Self::queue_full(),
            _ => Self::unavailable(),
        }
    }
    pub fn queue_full() -> Self {
        Self {
            code: "queue_full",
            message: "Zu viele PDFs gleichzeitig übergeben. Bitte die gewünschte Datei nach Abschluss erneut öffnen.",
        }
    }
    fn io(error: std::io::Error) -> Self {
        if error.kind() == std::io::ErrorKind::PermissionDenied {
            Self::from_code("denied")
        } else {
            Self::unavailable()
        }
    }
}

#[derive(Clone, Copy)]
pub enum UrlPolicy {
    Desktop,
    Android,
    Ios,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Source {
    Local(PathBuf),
    Mobile(String),
    Rejected(String),
}

fn normalize_path(path: PathBuf) -> PathBuf {
    let mut output = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                output.pop();
            }
            other => output.push(other.as_os_str()),
        }
    }
    output
}

impl Source {
    pub fn from_argument(argument: &str, cwd: &Path) -> Self {
        if argument.is_empty() || argument.len() > 64 * 1024 || argument.contains('\0') {
            return Self::Rejected("invalid-argument".into());
        }
        let path = Path::new(argument);
        if path.is_absolute() {
            return Self::Local(normalize_path(path.to_owned()));
        }
        if argument.contains("://") {
            return match Url::parse(argument) {
                Ok(url) => Self::from_url(&url, UrlPolicy::Desktop),
                Err(_) => Self::Rejected(argument.into()),
            };
        }
        Self::Local(normalize_path(cwd.join(path)))
    }

    pub fn from_url(url: &Url, policy: UrlPolicy) -> Self {
        let raw = url.as_str();
        if raw.len() > 64 * 1024 || raw.contains('\0') || url.fragment().is_some() {
            return Self::Rejected("invalid-uri".into());
        }
        match (policy, url.scheme()) {
            (UrlPolicy::Android, "content") if url.host_str().is_some() => Self::Mobile(raw.into()),
            (UrlPolicy::Ios | UrlPolicy::Android, "file")
                if url.query().is_none()
                    && matches!(url.host_str(), None | Some("") | Some("localhost"))
                    && url.to_file_path().is_ok_and(|path| path.is_absolute()) =>
            {
                Self::Mobile(raw.into())
            }
            (UrlPolicy::Desktop, "file") if url.query().is_none() => match url.to_file_path() {
                Ok(path) if path.is_absolute() => Self::Local(normalize_path(path)),
                _ => Self::Rejected(raw.into()),
            },
            _ => Self::Rejected(raw.into()),
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Descriptor {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub byte_length: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<OpenError>,
}

pub struct Document {
    file: Option<File>,
    path: PathBuf,
    file_name: String,
    byte_length: usize,
}

fn file_name(name: &str) -> String {
    if !name.trim().is_empty()
        && name.encode_utf16().count() <= 255
        && !name
            .chars()
            .any(|c| c.is_control() || c == '/' || c == '\\')
    {
        name.into()
    } else {
        "Dokument.pdf".into()
    }
}

fn validate(file: &mut File) -> Result<usize, OpenError> {
    let metadata = file.metadata().map_err(OpenError::io)?;
    if !metadata.is_file() || metadata.len() < 5 {
        return Err(OpenError::invalid());
    }
    if metadata.len() > MAX_PDF_BYTES as u64 {
        return Err(OpenError::from_code("too_large"));
    }
    let length = metadata.len() as usize;
    file.seek(SeekFrom::Start(0)).map_err(OpenError::io)?;
    let mut header = vec![0; length.min(1024)];
    file.read_exact(&mut header).map_err(OpenError::io)?;
    if !header.windows(5).any(|part| part == b"%PDF-") {
        return Err(OpenError::invalid());
    }
    file.seek(SeekFrom::Start(0)).map_err(OpenError::io)?;
    Ok(length)
}

impl Document {
    /// Copies only an OS-supplied source; this path is never accepted from JS.
    pub fn stage(source: &Path, directory: &Path) -> Result<Self, OpenError> {
        if !fs::metadata(source).map_err(OpenError::io)?.is_file() {
            return Err(OpenError::invalid());
        }
        let mut input = File::open(source).map_err(OpenError::io)?;
        let byte_length = validate(&mut input)?;
        let name = file_name(&source.file_name().unwrap_or_default().to_string_lossy());
        let destination = directory.join(format!("pdf-{}.tmp", Uuid::new_v4()));
        let mut options = OpenOptions::new();
        options.read(true).write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let file = options.open(&destination).map_err(OpenError::io)?;
        let mut document = Self {
            file: Some(file),
            path: destination,
            file_name: name,
            byte_length,
        };
        let copied = std::io::copy(
            &mut (&mut input).take(byte_length as u64),
            document.file.as_mut().ok_or_else(OpenError::unavailable)?,
        )
        .map_err(OpenError::io)?;
        let mut extra = [0];
        if copied != byte_length as u64 || input.read(&mut extra).map_err(OpenError::io)? != 0 {
            return Err(OpenError::invalid());
        }
        document
            .file
            .as_mut()
            .unwrap()
            .flush()
            .map_err(OpenError::io)?;
        validate(document.file.as_mut().unwrap())?;
        Ok(document)
    }

    /// Takes ownership of a native mobile bridge's private cache copy.
    pub fn adopt_mobile(
        source: &Path,
        incoming_directory: &Path,
        directory: &Path,
        name: &str,
        reported_length: usize,
    ) -> Result<Self, OpenError> {
        let incoming = incoming_directory.canonicalize().map_err(OpenError::io)?;
        let actual = source.canonicalize().map_err(OpenError::io)?;
        if actual.parent() != Some(incoming.as_path())
            || fs::symlink_metadata(source)
                .map_err(OpenError::io)?
                .file_type()
                .is_symlink()
            || !owned_incoming_name(source)
        {
            return Err(OpenError::invalid());
        }
        let mut input = File::open(&actual).map_err(OpenError::io)?;
        let checked = validate(&mut input);
        let byte_length = match checked {
            Ok(length) if length == reported_length => length,
            _ => {
                drop(input);
                let _ = fs::remove_file(&actual);
                return Err(OpenError::invalid());
            }
        };
        drop(input);
        let destination = directory.join(format!("pdf-{}.tmp", Uuid::new_v4()));
        if let Err(error) = fs::rename(&actual, &destination) {
            let _ = fs::remove_file(&actual);
            return Err(OpenError::io(error));
        }
        match File::open(&destination) {
            Ok(file) => Ok(Self {
                file: Some(file),
                path: destination,
                file_name: file_name(name),
                byte_length,
            }),
            Err(error) => {
                let _ = fs::remove_file(destination);
                Err(OpenError::io(error))
            }
        }
    }

    pub fn read(&mut self, offset: usize) -> Result<Vec<u8>, OpenError> {
        if offset >= self.byte_length || offset % CHUNK_BYTES != 0 {
            return Err(OpenError::invalid());
        }
        let file = self.file.as_mut().ok_or_else(OpenError::unavailable)?;
        file.seek(SeekFrom::Start(offset as u64))
            .map_err(OpenError::io)?;
        let mut bytes = vec![0; CHUNK_BYTES.min(self.byte_length - offset)];
        file.read_exact(&mut bytes).map_err(OpenError::io)?;
        Ok(bytes)
    }
}

impl Drop for Document {
    fn drop(&mut self) {
        self.file.take();
        let _ = fs::remove_file(&self.path);
    }
}

fn owned_incoming_name(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .and_then(|name| name.strip_prefix("pdf-incoming-"))
        .and_then(|name| name.strip_suffix(".tmp"))
        .is_some_and(|id| {
            Uuid::parse_str(id).is_ok()
                || ((8..=32).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_digit()))
        })
}

pub fn clean_mobile_incoming(directory: &Path) -> Result<(), OpenError> {
    fs::create_dir_all(directory).map_err(OpenError::io)?;
    for entry in fs::read_dir(directory).map_err(OpenError::io)? {
        let entry = entry.map_err(OpenError::io)?;
        if entry.file_type().map_err(OpenError::io)?.is_file() && owned_incoming_name(&entry.path())
        {
            fs::remove_file(entry.path()).map_err(OpenError::io)?;
        }
    }
    Ok(())
}

enum Status {
    Pending,
    Loading,
    Ready(Result<Document, OpenError>),
}

struct Entry {
    id: String,
    source: Source,
    status: Status,
}

#[derive(Default)]
pub struct Queue {
    entries: VecDeque<Entry>,
    recent: VecDeque<(Source, Instant)>,
    overflow: bool,
}

pub struct Claim {
    pub id: String,
    pub source: Result<Source, OpenError>,
}

impl Queue {
    pub fn fail_pending(&mut self, error: OpenError) -> bool {
        let mut changed = false;
        for entry in &mut self.entries {
            if matches!(entry.status, Status::Pending | Status::Loading) {
                entry.status = Status::Ready(Err(error.clone()));
                changed = true;
            }
        }
        changed
    }

    pub fn push(&mut self, source: Source, now: Instant) {
        self.recent
            .retain(|(_, time)| now.saturating_duration_since(*time) < RECENT_WINDOW);
        if self.entries.iter().any(|entry| entry.source == source)
            || self.recent.iter().any(|(previous, _)| previous == &source)
        {
            return;
        }
        if self.entries.len() >= MAX_PENDING {
            self.overflow = true;
            return;
        }
        self.entries.push_back(Entry {
            id: Uuid::new_v4().to_string(),
            source,
            status: Status::Pending,
        });
    }

    pub fn push_picked(&mut self, source: Source, now: Instant) {
        // Reopening the same file explicitly is distinct from a repeated OS event.
        self.recent.retain(|(previous, _)| previous != &source);
        self.push(source, now);
    }

    pub fn next(&self) -> Option<Descriptor> {
        let entry = self.entries.front()?;
        match &entry.status {
            Status::Pending | Status::Loading => None,
            Status::Ready(result) => Some(match result {
                Ok(document) => Descriptor {
                    id: entry.id.clone(),
                    file_name: Some(document.file_name.clone()),
                    byte_length: Some(document.byte_length),
                    error: None,
                },
                Err(error) => Descriptor {
                    id: entry.id.clone(),
                    file_name: None,
                    byte_length: None,
                    error: Some(error.clone()),
                },
            }),
        }
    }

    /// A serial worker can snapshot later mobile grants before the frontend
    /// has acknowledged the first entry. Only ready-head consumption is public.
    pub fn claim(&mut self) -> Option<Claim> {
        if self
            .entries
            .iter()
            .any(|entry| matches!(entry.status, Status::Loading))
        {
            return None;
        }
        let used: usize = self
            .entries
            .iter()
            .map(|entry| match &entry.status {
                Status::Ready(Ok(document)) => document.byte_length,
                _ => 0,
            })
            .sum();
        let entry = self
            .entries
            .iter_mut()
            .find(|entry| matches!(entry.status, Status::Pending))?;
        entry.status = Status::Loading;
        let source = if matches!(entry.source, Source::Rejected(_)) {
            Err(OpenError::invalid())
        } else if used > MAX_STAGED_BYTES - MAX_PDF_BYTES {
            // Reserve one full maximum-sized copy before reading an arbitrary
            // provider. A provider cannot exceed the aggregate cache budget.
            Err(OpenError::queue_full())
        } else {
            Ok(entry.source.clone())
        };
        Some(Claim {
            id: entry.id.clone(),
            source,
        })
    }

    pub fn complete(
        &mut self,
        id: &str,
        result: Result<Document, OpenError>,
    ) -> Result<(), OpenError> {
        let entry = self
            .entries
            .iter_mut()
            .find(|entry| entry.id == id)
            .ok_or_else(OpenError::invalid)?;
        if !matches!(entry.status, Status::Loading) {
            return Err(OpenError::invalid());
        }
        entry.status = Status::Ready(result);
        Ok(())
    }

    pub fn read(&mut self, id: &str, offset: usize) -> Result<Vec<u8>, OpenError> {
        let entry = self.entries.front_mut().ok_or_else(OpenError::invalid)?;
        if entry.id != id {
            return Err(OpenError::invalid());
        }
        match &mut entry.status {
            Status::Ready(Ok(document)) => document.read(offset),
            _ => Err(OpenError::invalid()),
        }
    }

    pub fn finish(&mut self, id: &str, now: Instant) -> Result<Option<Source>, OpenError> {
        let entry = self.entries.front().ok_or_else(OpenError::invalid)?;
        if entry.id != id || !matches!(entry.status, Status::Ready(_)) {
            return Err(OpenError::invalid());
        }
        let entry = self.entries.pop_front().unwrap();
        let opened_source =
            matches!(entry.status, Status::Ready(Ok(_))).then(|| entry.source.clone());
        self.recent.push_back((entry.source, now));
        while self.recent.len() > MAX_PENDING * 2 {
            self.recent.pop_front();
        }
        if self.overflow && self.entries.len() < MAX_PENDING {
            self.overflow = false;
            self.entries.push_back(Entry {
                id: Uuid::new_v4().to_string(),
                source: Source::Rejected("overflow".into()),
                status: Status::Ready(Err(OpenError::queue_full())),
            });
        }
        Ok(opened_source)
    }
}

#[cfg(test)]
#[path = "intake_tests.rs"]
mod tests;
