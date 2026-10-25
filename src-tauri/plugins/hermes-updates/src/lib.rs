use serde::{Deserialize, Serialize};
use tauri::{plugin::{Builder, PluginHandle, TauriPlugin}, Manager, Runtime};

#[derive(Serialize)]
pub struct InstallRequest { pub path: String }

#[derive(Deserialize, Serialize)]
pub struct InstallResult { pub status: String }

pub struct Installer<R: Runtime>(PluginHandle<R>);
impl<R: Runtime> Installer<R> {
    pub fn install(&self, path: String) -> Result<InstallResult, tauri::plugin::mobile::PluginInvokeError> {
        self.0.run_mobile_plugin("installApk", InstallRequest { path })
    }
}

pub trait InstallerExt<R: Runtime> { fn hermes_installer(&self) -> &Installer<R>; }
impl<R: Runtime, T: Manager<R>> InstallerExt<R> for T {
    fn hermes_installer(&self) -> &Installer<R> { self.state::<Installer<R>>().inner() }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("hermes-updates").setup(|app, api| {
        let handle = api.register_android_plugin("io.github.xeron.hermesupdates", "HermesUpdatesPlugin")?;
        app.manage(Installer(handle));
        Ok(())
    }).build()
}
