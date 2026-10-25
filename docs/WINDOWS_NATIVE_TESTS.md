# Windows native test startup

The reported Windows job compiled the native unit test EXE successfully, then exited with `0xc0000139` (`STATUS_ENTRYPOINT_NOT_FOUND`) before the Rust test harness printed `running 5 tests`. This is a Windows loader failure; it is not an HTTP assertion or a pairing response.

The pinned dependencies expose a manifest gap that fits this failure:

- Tauri enables `common-controls-v6` by default, and its GUI dependencies import Common Controls v6 functions such as `TaskDialogIndirect`.
- `tauri-build` 2.7.4 uses `tauri-winres` 0.3.7 `compile()`. Its `embed-resource` 3.0.12 dependency detects `src/main.rs` and emits `cargo:rustc-link-arg-bins`, so the application receives the manifest but the library unit test EXE does not.
- An EXE without the Common Controls v6 activation context can load an older `comctl32.dll` that lacks the imported entry point. The status code alone does not name the precise missing DLL/function; the failed Windows EXE was not available in the cloud for import-table inspection.

The Windows workflow now calls `node scripts/test-windows-native.mjs`. It compiles tests with `--no-run --message-format=json`, selects the actual library test EXE from Cargo's artifact messages (including this crate's `staticlib/cdylib/rlib` target kinds), and uses the installed Windows SDK `mt.exe` to embed `src-tauri/windows-test.manifest` as executable resource `#1`.

Before running the EXE with `--nocapture`, the helper extracts the embedded manifest and checks that it requests `Microsoft.Windows.Common-Controls` version `6.0.0.0`. SDK errors, missing artifacts/manifests, test failures, and native crashes all stop publication. The helper does not modify the application installer or replace system DLLs.

Local orchestration tests cover artifact discovery, paths containing spaces, manifest embedding/verification failures, UTF-16 SDK output, missing artifacts, SDK discovery, and preserving a failed native process's NTSTATUS. Windows loader execution itself must be confirmed on the GitHub Windows runner; the Linux environment cannot execute this Windows test EXE.
