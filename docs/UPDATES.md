Hermes Cockpit updates on Windows and Android

The client checks at startup, every six hours, and after returning online. Open **Pembaruan aplikasi** from the header or sidebar to check manually. Checking never downloads a package. **Unduh pembaruan** downloads and verifies it; **Pasang & mulai ulang** (Windows) or **Pasang APK** (Android) asks for confirmation before starting installation. Android also presents its system installer and may ask to allow installations from Hermes Cockpit. Cancelling keeps the verified APK available to retry. Pairing and application data are retained by an upgrade with the same application identity.

One-time distribution setup

1. Create **Xeron23/hermes-cockpit-releases** as a **public** repository, initialized with a README. It contains public installers, APKs, signatures, checksums, and update metadata. Source remains in the private `swarm-cockpit-desktop` repository.
2. In the private source repository's **Settings → Secrets and variables → Actions**, add:
   - `TAURI_SIGNING_PRIVATE_KEY`: the **contents** of the existing updater private key. This workspace's generated key is `/workspace/hermes-updater-secrets/tauri-updater.key`, outside the checkout, with mode 0600. Its matching public key is already committed in `src-tauri/updater.json` and `src-tauri/tauri.conf.json`. The key has an empty password. Keep a secure personal backup; do not regenerate it for each release or commit it.
   - `PUBLIC_RELEASE_TOKEN`: a fine-grained GitHub token restricted to **hermes-cockpit-releases**, with **Contents: Read and write**. If the owner is an organization, complete its token authorization. The app never receives this token.
3. Run **Build and release Windows & Android** from Actions, or push a new commit to `main`. Install the first version containing the updater manually once. Following signed releases appear inside the app.

This workspace can push Git commits, but its GitHub API authentication is unavailable. Creating the public repository and setting Actions secrets must be done with the repository owner's GitHub access. Until configured, private builds continue as bootstrap installers. The client reports that the update feed is unavailable; it does not accept unsigned updates.

Publication and signing

- Every main push builds both platforms and receives an immutable release tag. The public `updates` channel is promoted only after every package/signature is uploaded and checked. Source release publication still waits for both platforms. Older or repeated builds cannot move the channel backwards. Published immutable packages are reused on reruns.
- The client uses `https://github.com/Xeron23/hermes-cockpit-releases/releases/download/updates/latest.json`. Private source access is unnecessary on the installed client. Internet access to GitHub Releases is required in addition to the LAN/Tailscale backend connection.
- Windows uses the official Tauri updater. Android downloads an ARM64 APK into private app cache, verifies the same Minisign signature and signed version, checks package ID and APK signing certificate, and hands a scoped FileProvider URI to the Android system installer. No silent installation or automatic uninstall is performed.
- Metadata versions include `+build.<run>.<attempt>`. This permits updates between main builds with the same application version, without repeatedly offering the installed build. The signature authenticates that exact version, preventing a metadata-only version change from replaying an old signed package.
- The APK currently uses the existing debug certificate, matching the release workflow. CI first reuses the original cached certificate. Once the updater key is configured, it preserves that certificate encrypted with AES-256-GCM and a domain-separated HKDF key in the private source repository's permanent **draft** release `android-signing-state`. Builds restore and verify this identity before signing. Do not delete that draft or rotate the updater key without a migration. The encrypted backup is never mirrored publicly. If the original certificate was already lost before this backup was created, it cannot be recovered by this change; Android rejects a certificate mismatch instead of deleting app data.
- Only ARM64 Android APKs and Windows x86_64 installers are currently built, matching the existing release targets. Native installer prompts, administrator rights, and Android permissions still apply.

To deliberately provision a different updater key **before distributing the first updater-enabled client**, run `node scripts/setup-updater-key.mjs /absolute/path/outside/repository/updater.key` and update the Actions secret to match. Replacing the key after distribution needs an explicit migration because older clients trust their embedded public key.

Validation

`npm run check`, `npm test`, `npm run web:build`, `cargo test --locked --manifest-path scripts/updater-verifier/Cargo.toml`, native library tests, and `python3 scripts/smoke-updates.py <preview-url>` cover configuration, manual-action boundaries, both native SDK adapters, version/build ordering, real signature verification, publication ordering, and the production UI with mocked OS installation. Real Windows/Android installation must be verified with signed releases on the target devices after distribution setup.
