fn main() {
    // Include frontend changes and CI source identity in Cargo's cache inputs.
    println!("cargo:rerun-if-changed=../dist");
    for name in ["GITHUB_SHA", "GITHUB_RUN_NUMBER", "GITHUB_RUN_ATTEMPT"] {
        println!("cargo:rerun-if-env-changed={name}");
    }
    let commit = std::env::var("GITHUB_SHA").unwrap_or_else(|_| "local".into());
    let run = std::env::var("GITHUB_RUN_NUMBER").unwrap_or_else(|_| "local".into());
    println!("cargo:rustc-env=HERMES_BUILD_COMMIT={commit}");
    println!("cargo:rustc-env=HERMES_BUILD_RUN={run}");
    let attempt = std::env::var("GITHUB_RUN_ATTEMPT").unwrap_or_else(|_| "0".into());
    println!("cargo:rustc-env=HERMES_BUILD_ATTEMPT={attempt}");
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&["runtime_info", "backend_request", "android_update_check", "android_update_download", "android_update_install", "android_update_close"]),
    ))
    .expect("Tauri build configuration");
}
