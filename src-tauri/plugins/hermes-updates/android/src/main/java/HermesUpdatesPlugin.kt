package io.github.xeron.hermesupdates

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.result.ActivityResult
import androidx.core.content.FileProvider
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.security.MessageDigest

@InvokeArg
class InstallArgs { var path: String = "" }

@TauriPlugin
class HermesUpdatesPlugin(private val activity: Activity) : Plugin(activity) {
    private fun status(value: String): JSObject = JSObject().also { it.put("status", value) }
    @Suppress("DEPRECATION")
    private fun certificates(info: PackageInfo): Set<String> {
        val signatures = if (Build.VERSION.SDK_INT >= 28) info.signingInfo?.apkContentsSigners else info.signatures
        return signatures?.map { signature ->
            MessageDigest.getInstance("SHA-256").digest(signature.toByteArray())
                .joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }
        }?.toSet() ?: emptySet()
    }

    @Suppress("DEPRECATION")
    @Command
    fun installApk(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(InstallArgs::class.java)
            val file = File(args.path).canonicalFile
            val directory = File(activity.cacheDir, "hermes-updates").canonicalFile
            if (file.parentFile != directory || !file.isFile || file.extension != "apk") {
                invoke.reject("UPDATE_APK_NOT_FOUND")
                return
            }
            val manager = activity.packageManager
            val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
            val archive = manager.getPackageArchiveInfo(file.path, flags)
            val installed = manager.getPackageInfo(activity.packageName, flags)
            if (archive == null || archive.packageName != activity.packageName) {
                invoke.reject("UPDATE_PACKAGE_MISMATCH")
                return
            }
            val expected = certificates(installed)
            if (expected.isEmpty() || certificates(archive) != expected) {
                invoke.reject("UPDATE_CERTIFICATE_MISMATCH")
                return
            }
            val version = if (Build.VERSION.SDK_INT >= 28) archive.longVersionCode else archive.versionCode.toLong()
            val current = if (Build.VERSION.SDK_INT >= 28) installed.longVersionCode else installed.versionCode.toLong()
            if (version < current) {
                invoke.reject("UPDATE_DOWNGRADE_REJECTED")
                return
            }
            if (Build.VERSION.SDK_INT >= 26 && !manager.canRequestPackageInstalls()) {
                val settings = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}"))
                startActivityForResult(invoke, settings, "sourcesPermissionResult")
                return
            }
            val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.hermes-updates", file)
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                putExtra(Intent.EXTRA_RETURN_RESULT, true)
            }
            startActivityForResult(invoke, intent, "installResult")
        } catch (_: SecurityException) {
            invoke.reject("UPDATE_INSTALL_PERMISSION_DENIED")
        } catch (_: Exception) {
            invoke.reject("UPDATE_INSTALL_FAILED")
        }
    }

    @ActivityCallback
    private fun sourcesPermissionResult(invoke: Invoke, result: ActivityResult) {
        if (Build.VERSION.SDK_INT < 26 || activity.packageManager.canRequestPackageInstalls()) installApk(invoke)
        else invoke.resolve(status("permission_required"))
    }

    @ActivityCallback
    private fun installResult(invoke: Invoke, result: ActivityResult) {
        when (result.resultCode) {
            Activity.RESULT_OK -> invoke.resolve(status("installed"))
            Activity.RESULT_CANCELED -> invoke.resolve(status("cancelled"))
            else -> invoke.reject("UPDATE_INSTALL_FAILED")
        }
    }
}
