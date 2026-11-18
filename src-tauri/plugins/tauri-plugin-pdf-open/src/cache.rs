//! Instance ownership prevents startup cleanup from deleting another live import.
use fs2::FileExt;
use std::{
    fs::{self, File, OpenOptions},
    io,
    path::{Path, PathBuf},
};
use uuid::Uuid;

fn lock_file(path: &Path) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)
}

fn root_lock(base: &Path) -> io::Result<File> {
    fs::create_dir_all(base)?;
    let lock = lock_file(&base.join("init.lock"))?;
    lock.lock_exclusive()?;
    Ok(lock)
}

pub struct CacheInstance {
    base: PathBuf,
    directory: PathBuf,
    ownership: Option<File>,
}

impl CacheInstance {
    pub fn new(base: &Path) -> io::Result<Self> {
        let _root = root_lock(base)?;
        for entry in fs::read_dir(base)? {
            let entry = entry?;
            if !entry.file_type()?.is_dir()
                || !entry.file_name().to_string_lossy().starts_with("instance-")
            {
                continue;
            }
            let owner = lock_file(&entry.path().join("owner.lock"))?;
            if owner.try_lock_exclusive().is_err() {
                continue;
            }
            drop(owner); // Close the Windows handle before deleting its directory.
            fs::remove_dir_all(entry.path())?;
        }
        let directory = base.join(format!("instance-{}", Uuid::new_v4()));
        fs::create_dir(&directory)?;
        let owner = lock_file(&directory.join("owner.lock"))?;
        owner.lock_exclusive()?;
        Ok(Self {
            base: base.to_owned(),
            directory,
            ownership: Some(owner),
        })
    }

    pub fn directory(&self) -> &Path {
        &self.directory
    }
}

impl Drop for CacheInstance {
    fn drop(&mut self) {
        if let Ok(_root) = root_lock(&self.base) {
            self.ownership.take();
            let _ = fs::remove_dir_all(&self.directory);
        } else {
            self.ownership.take();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn another_instance_preserves_live_imports_and_removes_abandoned_ones() {
        let base = std::env::temp_dir().join(format!("pdf-open-cache-{}", Uuid::new_v4()));
        let first = CacheInstance::new(&base).unwrap();
        let original = first.directory().to_owned();
        fs::write(original.join("pdf.tmp"), b"private").unwrap();
        let abandoned = base.join("instance-abandoned");
        fs::create_dir(&abandoned).unwrap();
        fs::write(abandoned.join("owner.lock"), []).unwrap();
        let second = CacheInstance::new(&base).unwrap();
        assert_eq!(fs::read(original.join("pdf.tmp")).unwrap(), b"private");
        assert!(!abandoned.exists());
        drop(second);
        assert!(original.exists());
        drop(first);
        assert!(!original.exists());
        fs::remove_dir_all(base).unwrap();
    }
}
