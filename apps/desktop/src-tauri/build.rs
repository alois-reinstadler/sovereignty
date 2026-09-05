fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&["desktop_close_ready"]),
        ),
    )
    .expect("failed to build Sovereignty desktop permissions");
}
