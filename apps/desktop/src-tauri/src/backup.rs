//! Only encrypted v1 envelopes cross this boundary; paths come from an OS dialog.
use serde::Deserialize;
use std::{
    fs::OpenOptions,
    io::{Read, Write},
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
};
use tauri::{State, WebviewWindow};

pub const MAX_BYTES: usize = 10 * 1024 * 1024;
const INVALID: &str = "Not a supported encrypted Sovereignty backup.";

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Envelope {
    format: String,
    version: u32,
    id: String,
    kdf: Kdf,
    wrapped_vault_key: Payload,
    encrypted_document: Payload,
    created_at: String,
    updated_at: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Kdf {
    algorithm: String,
    salt: String,
    operations_limit: u64,
    memory_limit: u64,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Payload {
    algorithm: String,
    nonce: String,
    ciphertext: String,
}

fn base64(value: &str, min: usize, max: usize) -> bool {
    (min..=max).contains(&value.len())
        && value.len() % 4 != 1
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
}
fn timestamp(value: &str) -> bool {
    value.len() == 24
        && value.bytes().enumerate().all(|(i, c)| match i {
            4 | 7 => c == b'-',
            10 => c == b'T',
            13 | 16 => c == b':',
            19 => c == b'.',
            23 => c == b'Z',
            _ => c.is_ascii_digit(),
        })
}
pub fn validate(serialized: &str) -> Result<(), String> {
    if serialized.len() > MAX_BYTES {
        return Err(INVALID.into());
    }
    // Derived structs reject extra and duplicate keys, including plaintext fields.
    let e: Envelope = serde_json::from_str(serialized).map_err(|_| INVALID.to_string())?;
    let payload = |p: &Payload, min, max| {
        p.algorithm == "xchacha20-poly1305-ietf"
            && base64(&p.nonce, 32, 32)
            && base64(&p.ciphertext, min, max)
    };
    if e.format != "svrgn-encrypted-vault"
        || e.version != 1
        || e.id.is_empty()
        || e.id.len() > 128
        || !e
            .id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
        || !timestamp(&e.created_at)
        || !timestamp(&e.updated_at)
        || e.kdf.algorithm != "argon2id13"
        || !base64(&e.kdf.salt, 22, 22)
        || !(1..=10).contains(&e.kdf.operations_limit)
        || !(8192..=536_870_912).contains(&e.kdf.memory_limit)
        || !payload(&e.wrapped_vault_key, 64, 64)
        || !payload(&e.encrypted_document, 22, MAX_BYTES)
    {
        return Err(INVALID.into());
    }
    Ok(())
}

#[derive(Default)]
pub struct BackupState(pub AtomicBool);
struct BackupGuard<'a>(&'a AtomicBool);
impl Drop for BackupGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}
fn begin<'a>(
    label: &str,
    busy: &'a AtomicBool,
    closing: &AtomicBool,
) -> Result<BackupGuard<'a>, String> {
    if label != "main"
        || closing.load(Ordering::SeqCst)
        || busy
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
    {
        return Err("Backup unavailable while another operation is pending.".into());
    }
    Ok(BackupGuard(busy))
}
fn save_new(path: &Path, serialized: &str) -> Result<(), String> {
    validate(serialized)?;
    if path.extension().and_then(|s| s.to_str()) != Some("svrgn") {
        return Err("Choose a filename ending in .svrgn.".into());
    }
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    // create_new atomically refuses existing files and symlinks. Never truncate.
    let mut file = options
        .open(path)
        .map_err(|_| "Choose a new filename in a writable folder.".to_string())?;
    if file
        .write_all(serialized.as_bytes())
        .and_then(|_| file.sync_all())
        .is_err()
    {
        // Leave the partial encrypted file in place; don't race a path replacement.
        return Err("Backup write failed. Choose another filename and retry.".into());
    }
    Ok(())
}
fn read_selected(path: &Path) -> Result<String, String> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let file = options
        .open(path)
        .map_err(|_| "The selected file could not be read.".to_string())?;
    let metadata = file.metadata().map_err(|_| INVALID.to_string())?;
    if !metadata.is_file() || metadata.len() > MAX_BYTES as u64 {
        return Err(INVALID.into());
    }
    let mut serialized = String::new();
    file.take(MAX_BYTES as u64 + 1)
        .read_to_string(&mut serialized)
        .map_err(|_| INVALID.to_string())?;
    validate(&serialized)?;
    Ok(serialized)
}

#[tauri::command]
pub async fn desktop_export_backup(
    window: WebviewWindow,
    state: State<'_, BackupState>,
    closing: State<'_, super::CloseState>,
    serialized: String,
) -> Result<bool, String> {
    let _guard = begin(window.label(), &state.0, &closing.0)?;
    validate(&serialized)?;
    let selected = rfd::AsyncFileDialog::new()
        .set_parent(&window)
        .set_title("Save encrypted Sovereignty backup")
        .add_filter("Sovereignty encrypted backup", &["svrgn"])
        .set_file_name("sovereignty-backup.svrgn")
        .save_file()
        .await;
    let Some(selected) = selected else {
        return Ok(false);
    };
    if closing.0.load(Ordering::SeqCst) {
        return Err("Backup cancelled because the window is closing.".into());
    }
    save_new(selected.path(), &serialized)?;
    Ok(true)
}

#[tauri::command]
pub async fn desktop_import_backup(
    window: WebviewWindow,
    state: State<'_, BackupState>,
    closing: State<'_, super::CloseState>,
) -> Result<Option<String>, String> {
    let _guard = begin(window.label(), &state.0, &closing.0)?;
    let selected = rfd::AsyncFileDialog::new()
        .set_parent(&window)
        .set_title("Open encrypted Sovereignty backup")
        .add_filter("Sovereignty encrypted backup", &["svrgn"])
        .pick_file()
        .await;
    let Some(selected) = selected else {
        return Ok(None);
    };
    if closing.0.load(Ordering::SeqCst) {
        return Err("Backup cancelled because the window is closing.".into());
    }
    read_selected(selected.path()).map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> String {
        // Public deterministic ciphertext vector; no real credentials.
        let vectors: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../packages/protocol-vectors/fixtures/vectors.json"
        ))
        .unwrap();
        vectors["v1"]["envelope"].to_string()
    }
    #[test]
    fn accepts_shared_envelope_and_rejects_malformed_plaintext_and_unbounded_data() {
        let serialized = fixture();
        assert!(validate(&serialized).is_ok());
        for bad in ["", "null", "{}", "[]", "synthetic password"] {
            assert!(validate(bad).is_err());
        }
        assert!(validate(&" ".repeat(MAX_BYTES + 1)).is_err());
        let original: serde_json::Value = serde_json::from_str(&serialized).unwrap();
        for (key, value) in [
            ("password", serde_json::json!("synthetic")),
            ("version", serde_json::json!(2)),
            ("id", serde_json::json!("../bad")),
        ] {
            let mut bad = original.clone();
            bad[key] = value;
            assert!(validate(&bad.to_string()).is_err());
        }
        let mut bad = original.clone();
        bad["kdf"]["memoryLimit"] = serde_json::json!(536870913u64);
        assert!(validate(&bad.to_string()).is_err());
        let mut bad = original.clone();
        bad["wrappedVaultKey"]["nonce"] = serde_json::json!("wrong");
        assert!(validate(&bad.to_string()).is_err());
        let duplicate = serialized.replacen('{', "{\"version\":1,", 1);
        assert!(validate(&duplicate).is_err());
    }
    #[test]
    fn writes_exact_ciphertext_without_overwrite_and_reads_only_bounded_files() {
        let dir = std::env::temp_dir().join(format!("svrgn-backup-test-{}", std::process::id()));
        std::fs::create_dir(&dir).unwrap();
        let path = dir.join("fixture.svrgn");
        let serialized = fixture();
        save_new(&path, &serialized).unwrap();
        assert_eq!(read_selected(&path).unwrap(), serialized);
        assert!(save_new(&path, &serialized).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), serialized);
        assert!(save_new(&dir.join("wrong.txt"), &serialized).is_err());
        assert!(save_new(&dir.join("plain.svrgn"), "plaintext").is_err());
        assert!(!dir.join("plain.svrgn").exists());
        assert!(read_selected(&dir).is_err());
        std::fs::write(dir.join("large.svrgn"), vec![b' '; MAX_BYTES + 1]).unwrap();
        assert!(read_selected(&dir.join("large.svrgn")).is_err());
        #[cfg(unix)]
        {
            use std::os::unix::fs::{symlink, PermissionsExt};
            assert_eq!(
                std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
            symlink(&path, dir.join("link.svrgn")).unwrap();
            assert!(read_selected(&dir.join("link.svrgn")).is_err());
            assert!(save_new(&dir.join("link.svrgn"), &serialized).is_err());
        }
        std::fs::remove_dir_all(&dir).unwrap();
    }
    #[test]
    fn only_main_can_begin_and_guard_serializes_operations_and_releases_after_cancel() {
        let busy = AtomicBool::new(false);
        let closing = AtomicBool::new(false);
        assert!(begin("other", &busy, &closing).is_err());
        let guard = begin("main", &busy, &closing).unwrap();
        assert!(begin("main", &busy, &closing).is_err());
        drop(guard);
        assert!(!busy.load(Ordering::SeqCst));
        closing.store(true, Ordering::SeqCst);
        assert!(begin("main", &busy, &closing).is_err());
    }
}
