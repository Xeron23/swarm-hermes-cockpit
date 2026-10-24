#[derive(serde::Serialize)]
struct RuntimeInfo {
    app: &'static str,
    version: &'static str,
    platform: &'static str,
    mode: &'static str,
}

#[tauri::command]
fn runtime_info() -> RuntimeInfo {
    RuntimeInfo {
        app: "Hermes Cockpit",
        version: env!("CARGO_PKG_VERSION"),
        platform: std::env::consts::OS,
        mode: "demo",
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![runtime_info])
        .run(tauri::generate_context!())
        .expect("Hermes Cockpit could not start");
}
