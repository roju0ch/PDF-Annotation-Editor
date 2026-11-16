//! PDF staging and atomic destination replacement. No Tauri or GUI dependency.
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
};

pub const MAX_PDF_BYTES: usize = 150 * 1024 * 1024;
pub const MAX_CHUNK_BYTES: usize = 256 * 1024;
const IO_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone)]
pub struct SaveError {
    pub code: &'static str,
    pub message: &'static str,
}
type Result<T> = std::result::Result<T, SaveError>;

pub fn unavailable() -> SaveError {
    SaveError {
        code: "unavailable",
        message: "Die PDF konnte nicht sicher gespeichert werden. Bitte Speicherplatz und Speicherort prüfen und erneut versuchen. Die Änderungen bleiben ungesichert.",
    }
}
pub fn invalid() -> SaveError {
    SaveError {
        code: "invalid",
        message: "Der PDF-Speicherauftrag ist unvollständig oder ungültig. Bitte erneut speichern.",
    }
}
fn verification() -> SaveError {
    SaveError {
        code: "verification",
        message: "Die gespeicherte PDF konnte nicht vollständig bestätigt werden. Bitte die Datei prüfen und erneut speichern. Die Änderungen bleiben ungesichert.",
    }
}

pub fn valid_token(token: &str) -> bool {
    token.len() == 36
        && token.bytes().enumerate().all(|(i, b)| {
            if [8, 13, 18, 23].contains(&i) {
                b == b'-'
            } else {
                b.is_ascii_hexdigit()
            }
        })
}

fn valid_name(name: &str) -> bool {
    !name.trim().is_empty()
        && name.encode_utf16().count() <= 255
        && !name
            .chars()
            .any(|c| c.is_control() || c == '/' || c == '\\')
}

/// A temporary file never replaces an existing pathname while being written.
struct Temporary {
    path: PathBuf,
    file: Option<File>,
    armed: bool,
}
impl Temporary {
    fn create(path: PathBuf) -> Result<Self> {
        let mut options = OpenOptions::new();
        options.read(true).write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let file = options.open(&path).map_err(|_| unavailable())?;
        Ok(Self {
            path,
            file: Some(file),
            armed: true,
        })
    }
    fn file(&mut self) -> &mut File {
        self.file.as_mut().expect("owned temporary file")
    }
    fn persist(mut self, destination: &Path) -> Result<()> {
        // Close every handle before rename: required for replacement on Windows.
        self.file.take();
        fs::rename(&self.path, destination).map_err(|_| unavailable())?;
        self.armed = false; // The temporary pathname is no longer ours.
        Ok(())
    }
}
impl Drop for Temporary {
    fn drop(&mut self) {
        self.file.take();
        if self.armed {
            let _ = fs::remove_file(&self.path);
        }
    }
}

#[derive(PartialEq)]
enum Phase {
    Upload,
    Picker,
}
struct Upload {
    token: String,
    file_name: String,
    expected: usize,
    received: usize,
    temporary: Temporary,
    phase: Phase,
    cancelled: bool,
}
pub struct Sessions {
    directory: PathBuf,
    active: Option<Upload>,
}

impl Sessions {
    pub fn new(directory: PathBuf) -> Result<Self> {
        fs::create_dir_all(&directory).map_err(|_| unavailable())?;
        clean_orphans(&directory)?;
        Ok(Self {
            directory,
            active: None,
        })
    }

    pub fn begin(&mut self, token: String, file_name: String, byte_length: usize) -> Result<()> {
        if self.active.is_some() {
            return Err(SaveError { code: "busy", message: "Eine PDF wird bereits gespeichert. Bitte zuerst den laufenden Vorgang abschließen." });
        }
        if !valid_token(&token)
            || !valid_name(&file_name)
            || !(5..=MAX_PDF_BYTES).contains(&byte_length)
        {
            return Err(invalid());
        }
        clean_orphans(&self.directory)?;
        let temporary = Temporary::create(self.directory.join(format!("pdf-export-{token}.tmp")))?;
        self.active = Some(Upload {
            token,
            file_name,
            expected: byte_length,
            received: 0,
            temporary,
            phase: Phase::Upload,
            cancelled: false,
        });
        Ok(())
    }

    fn require(&self, token: &str, phase: Phase) -> Result<()> {
        let upload = self.active.as_ref().ok_or_else(invalid)?;
        if upload.token != token || upload.phase != phase {
            return Err(invalid());
        }
        Ok(())
    }

    pub fn append(&mut self, token: &str, offset: usize, bytes: &[u8]) -> Result<usize> {
        self.require(token, Phase::Upload)?;
        let result = (|| {
            let upload = self.active.as_mut().ok_or_else(invalid)?;
            if offset != upload.received
                || bytes.is_empty()
                || bytes.len() > MAX_CHUNK_BYTES
                || bytes.len() > upload.expected - upload.received
            {
                return Err(invalid());
            }
            upload
                .temporary
                .file()
                .write_all(bytes)
                .map_err(|_| unavailable())?;
            upload.received += bytes.len();
            Ok(upload.received)
        })();
        if result.is_err() {
            self.active.take();
        }
        result
    }

    pub fn prepare(&mut self, token: &str) -> Result<String> {
        self.require(token, Phase::Upload)?;
        let result = (|| {
            let upload = self.active.as_mut().ok_or_else(invalid)?;
            if upload.received != upload.expected {
                return Err(invalid());
            }
            let file = upload.temporary.file();
            file.flush()
                .and_then(|_| file.sync_all())
                .map_err(|_| unavailable())?;
            file.seek(SeekFrom::Start(0)).map_err(|_| unavailable())?;
            let mut header = [0u8; 5];
            file.read_exact(&mut header).map_err(|_| invalid())?;
            if header != *b"%PDF-"
                || file.metadata().map_err(|_| unavailable())?.len() != upload.expected as u64
            {
                return Err(invalid());
            }
            upload.phase = Phase::Picker;
            Ok(upload.file_name.clone())
        })();
        if result.is_err() {
            self.active.take();
        }
        result
    }

    /// Must receive a path returned by the native picker, never from JavaScript.
    pub fn finish(&mut self, token: &str, target: Option<&Path>) -> Result<Option<String>> {
        self.require(token, Phase::Picker)?;
        // The plugin holds its mutex throughout this bounded I/O. Another
        // upload cannot race this commit or replace its staged document.
        let mut upload = self.active.take().ok_or_else(invalid)?;
        if upload.cancelled || target.is_none() {
            return Ok(None);
        }
        let target = target.ok_or_else(invalid)?;
        let name = target
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| valid_name(name))
            .ok_or_else(invalid)?
            .to_owned();
        if !target.is_absolute() || target.is_dir() {
            return Err(invalid());
        }
        let parent = target.parent().ok_or_else(invalid)?;
        let mut output = Temporary::create(parent.join(format!(".pdf-save-{}.tmp", upload.token)))?;
        let source = upload.temporary.file();
        source.seek(SeekFrom::Start(0)).map_err(|_| unavailable())?;
        let written = std::io::copy(&mut source.take(upload.expected as u64 + 1), output.file())
            .map_err(|_| unavailable())?;
        if written != upload.expected as u64 {
            return Err(verification());
        }
        output
            .file()
            .flush()
            .and_then(|_| output.file().sync_all())
            .map_err(|_| unavailable())?;
        verify_same(&upload.temporary.path, &output.path, upload.expected)?;
        output.persist(target)?;
        verify_same(&upload.temporary.path, target, upload.expected)?;
        Ok(Some(name))
    }

    pub fn abort(&mut self, token: &str) -> Result<()> {
        let Some(upload) = self.active.as_mut() else {
            return Ok(());
        };
        if upload.token != token {
            return Err(invalid());
        }
        if upload.phase == Phase::Picker {
            // Keep ownership until that picker returns, so its late result
            // can never be applied to a newer transaction.
            upload.cancelled = true;
        } else {
            self.active.take();
        }
        Ok(())
    }
}

fn clean_orphans(directory: &Path) -> Result<()> {
    for entry in fs::read_dir(directory).map_err(|_| unavailable())? {
        let entry = entry.map_err(|_| unavailable())?;
        if entry
            .file_name()
            .to_string_lossy()
            .starts_with("pdf-export-")
            && entry.file_type().map_err(|_| unavailable())?.is_file()
        {
            fs::remove_file(entry.path()).map_err(|_| unavailable())?;
        }
    }
    Ok(())
}

fn verify_same(source: &Path, destination: &Path, expected: usize) -> Result<()> {
    let mut a = File::open(source).map_err(|_| unavailable())?;
    let mut b = File::open(destination).map_err(|_| unavailable())?;
    if a.metadata().map_err(|_| unavailable())?.len() != expected as u64
        || b.metadata().map_err(|_| unavailable())?.len() != expected as u64
    {
        return Err(verification());
    }
    let mut left = [0u8; IO_BYTES];
    let mut right = [0u8; IO_BYTES];
    let mut remaining = expected;
    while remaining > 0 {
        let n = remaining.min(IO_BYTES);
        a.read_exact(&mut left[..n]).map_err(|_| unavailable())?;
        b.read_exact(&mut right[..n]).map_err(|_| unavailable())?;
        if left[..n] != right[..n] {
            return Err(verification());
        }
        remaining -= n;
    }
    Ok(())
}

#[cfg(test)]
#[path = "storage_tests.rs"]
mod tests;
