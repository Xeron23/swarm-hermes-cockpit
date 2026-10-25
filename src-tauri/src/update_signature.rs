use base64::{engine::general_purpose::STANDARD, Engine};
use minisign_verify::{PublicKey, Signature};
use semver::Version;

pub fn verify(bytes: &[u8], signature: &str, public_key: &str, version: &str) -> Result<(), &'static str> {
    let key = String::from_utf8(STANDARD.decode(public_key.trim()).map_err(|_| "invalid public key")?).map_err(|_| "invalid public key")?;
    let signature = String::from_utf8(STANDARD.decode(signature.trim()).map_err(|_| "invalid signature")?).map_err(|_| "invalid signature")?;
    let key = PublicKey::decode(&key).map_err(|_| "invalid public key")?;
    let signature = Signature::decode(&signature).map_err(|_| "invalid signature")?;
    key.verify(bytes, &signature, true).map_err(|_| "signature verification failed")?;
    // Only read this comment after the global minisign signature is verified.
    let signed = signature.trusted_comment().split('\t').find_map(|field| field.strip_prefix("version:"))
        .and_then(|value| Version::parse(value.trim_start_matches('v')).ok());
    if signed.is_none() || signed != Version::parse(version.trim_start_matches('v')).ok() { return Err("signed version does not match update version"); }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    const KEY: &str = include_str!("test_fixtures/updater-public.txt");
    const SIGNATURE: &str = include_str!("test_fixtures/updater-signature.txt");
    const DATA: &[u8] = b"Hermes updater signature fixture\n";
    const VERSION: &str = "1.2.3+build.9.1";
    #[test] fn accepts_official_cli_version_bound_signature() { assert!(verify(DATA, SIGNATURE, KEY, VERSION).is_ok()); }
    #[test] fn rejects_modified_bytes() { assert!(verify(b"changed", SIGNATURE, KEY, VERSION).is_err()); }
    #[test] fn rejects_manifest_replay_with_a_new_build_number() { assert!(verify(DATA, SIGNATURE, KEY, "1.2.3+build.10.1").is_err()); }
    #[test] fn rejects_another_signing_key() { assert!(verify(DATA, SIGNATURE, "invalid", VERSION).is_err()); }
}
