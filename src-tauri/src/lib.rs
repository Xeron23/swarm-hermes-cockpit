mod backend;
mod app_updates;
#[cfg(any(target_os = "android", test))]
mod update_signature;
use tauri::Manager;

#[derive(serde::Serialize)]
struct RuntimeInfo {
    app: &'static str,
    version: &'static str,
    platform: &'static str,
    mode: &'static str,
    commit: &'static str,
    build_run: &'static str,
}

#[tauri::command]
fn runtime_info() -> RuntimeInfo {
    RuntimeInfo {
        app: "Hermes Cockpit",
        version: env!("CARGO_PKG_VERSION"),
        platform: std::env::consts::OS,
        mode: "live",
        commit: env!("HERMES_BUILD_COMMIT"),
        build_run: env!("HERMES_BUILD_RUN"),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_websocket::init())
        .setup(|app| {
            app.manage(backend::BackendHttp::new()?);
            Ok(())
        });
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new()
        .default_version_comparator(|current, release| app_updates::newer(&current, &release.version,
            env!("HERMES_BUILD_RUN").parse().unwrap_or(0), env!("HERMES_BUILD_ATTEMPT").parse().unwrap_or(0)))
        .build());
    #[cfg(target_os = "android")]
    let builder = builder.plugin(tauri_plugin_hermes_updates::init()).invoke_handler(tauri::generate_handler![
        runtime_info, backend::backend_request, app_updates::android_update_check, app_updates::android_update_download,
        app_updates::android_update_install, app_updates::android_update_close
    ]);
    #[cfg(not(target_os = "android"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
            runtime_info,
            backend::backend_request
        ]);
    builder
        .run(tauri::generate_context!())
        .expect("Hermes Cockpit could not start");
}
