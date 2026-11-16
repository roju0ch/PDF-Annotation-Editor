//! Instance locks distinguish abandoned staging data from another live editor.
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
    let file = lock_file(&base.join("init.lock"))?;
    file.lock_exclusive()?;
    Ok(file)
}

pub struct CacheInstance {
    base: PathBuf,
    directory: PathBuf,
    ownership: Option<File>,
}

impl CacheInstance {
    pub fn new(base: &Path) -> io::Result<Self> {
        // The root lock covers scanning AND mkdir+instance-lock acquisition.
        // A new directory can never look abandoned during its creation.
        let _root = root_lock(base)?;
        for entry in fs::read_dir(base)? {
            let entry = entry?;
            if !entry.file_type()?.is_dir()
                || !entry.file_name().to_string_lossy().starts_with("instance-")
            {
                continue;
            }
            let lock_path = entry.path().join("owner.lock");
            if lock_path.exists() {
                let owner = lock_file(&lock_path)?;
                if owner.try_lock_exclusive().is_err() {
                    continue;
                }
                // Windows requires the ownership handle closed before removal.
                drop(owner);
            }
            fs::remove_dir_all(entry.path())?;
        }
        let directory = base.join(format!("instance-{}", Uuid::new_v4()));
        fs::create_dir(&directory)?;
        let owner = match lock_file(&directory.join("owner.lock")) {
            Ok(file) => file,
            Err(error) => {
                let _ = fs::remove_dir_all(&directory);
                return Err(error);
            }
        };
        if let Err(error) = owner.lock_exclusive() {
            drop(owner);
            let _ = fs::remove_dir_all(&directory);
            return Err(error);
        }
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
        // Preserve the same lock order as creation and orphan scanning.
        if let Ok(_root) = root_lock(&self.base) {
            self.ownership.take();
            let _ = fs::remove_dir_all(&self.directory);
        } else {
            self.ownership.take(); // A future startup can clean the orphan.
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn live_instances_survive_other_editor_startup_and_orphans_are_cleaned() {
        let base = std::env::temp_dir().join(format!("pdf-cache-test-{}", Uuid::new_v4()));
        let first = CacheInstance::new(&base).unwrap();
        let original = first.directory().to_owned();
        fs::write(original.join("pdf-export-live.tmp"), b"live").unwrap();
        let orphan = base.join("instance-dead");
        fs::create_dir(&orphan).unwrap();
        fs::write(orphan.join("owner.lock"), b"").unwrap();
        fs::write(orphan.join("pdf-export-old.tmp"), b"old").unwrap();
        let second = CacheInstance::new(&base).unwrap();
        assert_eq!(
            fs::read(original.join("pdf-export-live.tmp")).unwrap(),
            b"live"
        );
        assert!(!orphan.exists());
        drop(second);
        assert!(original.exists());
        drop(first);
        assert!(!original.exists());
        fs::remove_dir_all(base).unwrap();
    }
}
