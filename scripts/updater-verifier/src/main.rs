#[path = "../../../src-tauri/src/update_signature.rs"]
mod update_signature;

fn main() {
    let mut args = std::env::args().skip(1);
    let config = args.next().expect("public updater configuration path");
    let version = args.next().expect("signed version");
    let config: serde_json::Value = serde_json::from_slice(&std::fs::read(config).expect("public updater configuration")).expect("configuration JSON");
    let key = config["publicKey"].as_str().expect("public key");
    let files: Vec<_> = args.collect();
    assert!(!files.is_empty(), "no updater packages to verify");
    for filename in files {
        let bytes = std::fs::read(&filename).expect("updater package");
        let signature = std::fs::read_to_string(format!("{filename}.sig")).expect("package signature");
        update_signature::verify(&bytes, &signature, key, &version).expect("updater signature and version binding");
        println!("Verified updater package: {}", std::path::Path::new(&filename).file_name().unwrap().to_string_lossy());
    }
}
