#[cfg(target_os = "android")]
use std::collections::HashMap;
use semver::Version;
#[cfg(target_os = "android")]
use serde::{Deserialize, Serialize};

#[cfg(target_os = "android")]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateConfig {
    pub repository: String,
    pub public_key: String,
    pub endpoints: Vec<String>,
}

#[cfg(target_os = "android")]
pub(crate) fn config() -> UpdateConfig {
    serde_json::from_str(include_str!("../updater.json")).expect("checked updater configuration")
}

pub(crate) fn newer(current: &Version, remote: &Version, run: u64, attempt: u64) -> bool {
    match remote.cmp_precedence(current) {
        std::cmp::Ordering::Greater => true,
        std::cmp::Ordering::Less => false,
        std::cmp::Ordering::Equal => {
            let values: Vec<_> = remote.build.as_str().split('.').collect();
            if values.len() != 3 || values[0] != "build" { return false; }
            match (values[1].parse::<u64>(), values[2].parse::<u64>()) {
                (Ok(next_run), Ok(next_attempt)) if next_run > 0 && next_attempt > 0 => (next_run, next_attempt) > (run, attempt),
                _ => false,
            }
        }
    }
}

#[cfg(target_os = "android")]
pub(crate) fn available(version: &Version) -> bool {
    newer(&Version::parse(env!("CARGO_PKG_VERSION")).unwrap(), version,
        env!("HERMES_BUILD_RUN").parse().unwrap_or(0), env!("HERMES_BUILD_ATTEMPT").parse().unwrap_or(0))
}

#[cfg(target_os = "android")]
#[derive(Debug, Serialize)]
pub(crate) struct UpdateError { pub code: &'static str, pub message: &'static str }
#[cfg(target_os = "android")]
fn fail(code: &'static str, message: &'static str) -> UpdateError { UpdateError { code, message } }

#[cfg(target_os = "android")]
#[derive(Clone, Deserialize)]
pub(crate) struct Package { pub url: String, pub signature: String }

#[cfg(target_os = "android")]
#[derive(Deserialize)]
pub(crate) struct Feed {
    pub version: Version,
    pub notes: Option<String>,
    pub pub_date: Option<String>,
    pub platforms: HashMap<String, Package>,
}

#[cfg(any(target_os = "android", test))]
pub(crate) fn allowed_package(url: &str, repository: &str, extension: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(url) else { return false; };
    url.scheme() == "https" && url.host_str() == Some("github.com") && url.port_or_known_default() == Some(443)
        && url.username().is_empty() && url.password().is_none() && url.query().is_none() && url.fragment().is_none()
        && url.path().starts_with(&format!("/{repository}/releases/download/")) && url.path().ends_with(extension)
}

#[cfg(target_os = "android")]
pub(crate) fn verify(bytes: &[u8], signature: &str, public_key: &str, version: &str) -> Result<(), UpdateError> {
    super::update_signature::verify(bytes, signature, public_key, version)
        .map_err(|_| fail("UPDATE_VERIFICATION_FAILED", "Paket pembaruan gagal diverifikasi."))
}

#[cfg(target_os = "android")]
mod android {
    use super::*;
    use std::{path::PathBuf, sync::{atomic::{AtomicBool, Ordering}, Mutex, Arc}, time::{Duration, SystemTime, UNIX_EPOCH}};
    use tauri::{ipc::Channel, Manager, Resource, Webview, AppHandle};
    use tauri_plugin_hermes_updates::{InstallerExt, InstallResult};

    const MAX_APK: usize = 256 * 1024 * 1024;
    struct AndroidUpdate {
        version: String, package: Package, path: Mutex<Option<PathBuf>>, busy: AtomicBool, installing: AtomicBool,
    }
    impl Resource for AndroidUpdate {}
    impl Drop for AndroidUpdate {
        fn drop(&mut self) {
            if !self.installing.load(Ordering::Relaxed) {
                if let Ok(path) = self.path.get_mut() { if let Some(path) = path.take() { let _ = std::fs::remove_file(path); } }
            }
        }
    }
    struct Busy(Arc<AndroidUpdate>);
    impl Drop for Busy { fn drop(&mut self) { self.0.busy.store(false, Ordering::Release); } }
    fn busy(update: Arc<AndroidUpdate>) -> Result<Busy, UpdateError> {
        update.busy.compare_exchange(false, true, Ordering::AcqRel, Ordering::Relaxed)
            .map_err(|_| fail("UPDATE_BUSY", "Pembaruan masih diproses."))?;
        Ok(Busy(update))
    }
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    pub(crate) struct Metadata { rid: u32, current_version: String, version: String, body: Option<String>, date: Option<String> }
    #[derive(Clone, Serialize)]
    #[serde(tag = "event", content = "data")]
    pub(crate) enum Progress {
        Started { #[serde(rename = "contentLength")] content_length: Option<u64> },
        Progress { #[serde(rename = "chunkLength")] chunk_length: usize }, Finished,
    }
    fn client(timeout: u64) -> Result<reqwest::Client, UpdateError> {
        reqwest::Client::builder().connect_timeout(Duration::from_secs(10)).timeout(Duration::from_secs(timeout)).build()
            .map_err(|_| fail("UPDATE_NETWORK_ERROR", "Layanan pembaruan belum dapat dihubungi."))
    }
    fn network(_: reqwest::Error) -> UpdateError { fail("UPDATE_NETWORK_ERROR", "Unduhan pembaruan terputus. Periksa koneksi internet lalu coba lagi.") }
    fn file_error(_: std::io::Error) -> UpdateError { fail("UPDATE_STORAGE_ERROR", "Penyimpanan perangkat belum dapat menampung pembaruan.") }

    #[tauri::command]
    pub(crate) async fn android_update_check(webview: Webview) -> Result<Option<Metadata>, UpdateError> {
        let config = config();
        let response = client(20)?.get(&config.endpoints[0]).send().await.map_err(network)?;
        if response.status().as_u16() == 404 { return Err(fail("UPDATE_FEED_NOT_READY", "Belum tersedia paket pembaruan pada layanan release.")); }
        let feed: Feed = response.error_for_status().map_err(network)?.json().await.map_err(|_| fail("UPDATE_FEED_INVALID", "Informasi pembaruan tidak sesuai format."))?;
        if !available(&feed.version) { return Ok(None); }
        let platform = format!("android-{}", std::env::consts::ARCH);
        let package = feed.platforms.get(&platform).ok_or_else(|| fail("UPDATE_PLATFORM_UNAVAILABLE", "Belum tersedia APK untuk perangkat ini."))?.clone();
        if !allowed_package(&package.url, &config.repository, ".apk") || package.signature.is_empty() {
            return Err(fail("UPDATE_FEED_INVALID", "Alamat paket pembaruan tidak sesuai layanan release."));
        }
        let version = feed.version.to_string();
        let rid = webview.resources_table().add(AndroidUpdate { version: version.clone(), package, path: Mutex::new(None), busy: AtomicBool::new(false), installing: AtomicBool::new(false) });
        Ok(Some(Metadata { rid, current_version: env!("CARGO_PKG_VERSION").into(), version, body: feed.notes, date: feed.pub_date }))
    }

    #[tauri::command]
    pub(crate) async fn android_update_download(app: AppHandle, webview: Webview, rid: u32, on_event: Channel<Progress>) -> Result<(), UpdateError> {
        let update = webview.resources_table().get::<AndroidUpdate>(rid).map_err(|_| fail("UPDATE_NOT_FOUND", "Periksa pembaruan kembali."))?;
        let _busy = busy(update.clone())?;
        let mut response = client(300)?.get(&update.package.url).send().await.map_err(network)?.error_for_status().map_err(network)?;
        if response.content_length().is_some_and(|size| size > MAX_APK as u64) { return Err(fail("UPDATE_TOO_LARGE", "Ukuran paket pembaruan tidak sesuai.")); }
        let _ = on_event.send(Progress::Started { content_length: response.content_length() });
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(network)? {
            if bytes.len() + chunk.len() > MAX_APK { return Err(fail("UPDATE_TOO_LARGE", "Ukuran paket pembaruan tidak sesuai.")); }
            bytes.extend_from_slice(&chunk);
            let _ = on_event.send(Progress::Progress { chunk_length: chunk.len() });
        }
        let _ = on_event.send(Progress::Finished);
        verify(&bytes, &update.package.signature, &config().public_key, &update.version)?;
        let directory = app.path().app_cache_dir().map_err(|_| fail("UPDATE_STORAGE_ERROR", "Penyimpanan pembaruan tidak tersedia."))?.join("hermes-updates");
        std::fs::create_dir_all(&directory).map_err(file_error)?;
        let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis();
        let path = directory.join(format!("hermes-{nonce}-{rid}.apk"));
        std::fs::write(&path, bytes).map_err(file_error)?;
        let previous = update.path.lock().map_err(|_| fail("UPDATE_BUSY", "Pembaruan masih diproses."))?.replace(path);
        if let Some(previous) = previous { let _ = std::fs::remove_file(previous); }
        Ok(())
    }

    #[tauri::command]
    pub(crate) async fn android_update_install(app: AppHandle, webview: Webview, rid: u32) -> Result<InstallResult, UpdateError> {
        let update = webview.resources_table().get::<AndroidUpdate>(rid).map_err(|_| fail("UPDATE_NOT_FOUND", "Periksa pembaruan kembali."))?;
        let _busy = busy(update.clone())?;
        let path = update.path.lock().map_err(|_| fail("UPDATE_BUSY", "Pembaruan masih diproses."))?.clone().ok_or_else(|| fail("UPDATE_NOT_DOWNLOADED", "Unduh pembaruan terlebih dahulu."))?;
        update.installing.store(true, Ordering::Release);
        let result = tauri::async_runtime::spawn_blocking(move || app.hermes_installer().install(path.to_string_lossy().into_owned())).await
            .map_err(|_| fail("UPDATE_INSTALL_FAILED", "Pemasangan belum berhasil."))?;
        match result {
            Ok(result) => { if result.status != "installed" { update.installing.store(false, Ordering::Release); } Ok(result) },
            Err(error) => {
                update.installing.store(false, Ordering::Release);
                let raw = error.to_string();
                if raw.contains("UPDATE_CERTIFICATE_MISMATCH") { Err(fail("UPDATE_CERTIFICATE_MISMATCH", "Sertifikat APK berbeda dari aplikasi terpasang. Paket ini belum dapat dipasang sebagai pembaruan.")) }
                else if raw.contains("UPDATE_PACKAGE_MISMATCH") { Err(fail("UPDATE_PACKAGE_MISMATCH", "APK bukan untuk aplikasi Hermes Cockpit ini.")) }
                else { Err(fail("UPDATE_INSTALL_FAILED", "Android belum menyelesaikan pemasangan pembaruan.")) }
            }
        }
    }

    #[tauri::command]
    pub(crate) fn android_update_close(webview: Webview, rid: u32) -> Result<(), UpdateError> {
        let update = webview.resources_table().get::<AndroidUpdate>(rid).map_err(|_| fail("UPDATE_NOT_FOUND", "Pembaruan sudah ditutup."))?;
        if update.busy.load(Ordering::Acquire) { return Err(fail("UPDATE_BUSY", "Pembaruan masih diproses.")); }
        webview.resources_table().close(rid).map_err(|_| fail("UPDATE_NOT_FOUND", "Pembaruan sudah ditutup."))?;
        Ok(())
    }
}

#[cfg(target_os = "android")]
pub(crate) use android::*;

#[cfg(test)]
mod tests {
    use super::*;
    fn v(value: &str) -> Version { Version::parse(value).unwrap() }
    #[test]
    fn compares_rebuilds_without_reoffering_installed_builds_or_downgrading() {
        assert!(newer(&v("0.1.5"), &v("0.1.5+build.26.1"), 25, 1));
        assert!(newer(&v("0.1.5"), &v("0.1.5+build.25.2"), 25, 1));
        assert!(!newer(&v("0.1.5"), &v("0.1.5+build.25.1"), 25, 1));
        assert!(!newer(&v("0.1.5"), &v("0.1.4+build.99.1"), 25, 1));
        assert!(newer(&v("0.1.5"), &v("0.1.6+build.1.1"), 25, 1));
    }
    #[test]
    fn android_packages_are_scoped_to_public_release_assets() {
        let repo = "Xeron23/hermes-cockpit-releases";
        assert!(allowed_package(&format!("https://github.com/{repo}/releases/download/build-26/hermes.apk"), repo, ".apk"));
        for url in ["http://github.com/Xeron23/hermes-cockpit-releases/releases/download/x/app.apk", "https://evil.example/app.apk", "https://github.com/other/repo/releases/download/x/app.apk", "https://github.com/Xeron23/hermes-cockpit-releases/releases/download/x/app.exe"] {
            assert!(!allowed_package(url, repo, ".apk"));
        }
    }
}
