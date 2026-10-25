mod backend;
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
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_websocket::init())
        .setup(|app| {
            app.manage(backend::BackendHttp::new()?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            runtime_info,
            backend::backend_request
        ])
        .run(tauri::generate_context!())
        .expect("Hermes Cockpit could not start");
}
