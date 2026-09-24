use std::{fs, path::Path};

fn main() {
    track_frontend_assets(Path::new("../dist"));
    tauri_build::build()
}

fn track_frontend_assets(path: &Path) {
    println!("cargo:rerun-if-changed={}", path.display());
    for entry in
        fs::read_dir(path).expect("Vite frontend distribution must exist before Tauri builds")
    {
        let path = entry
            .expect("Vite frontend distribution entries must be readable")
            .path();
        if path.is_dir() {
            track_frontend_assets(&path);
        } else {
            println!("cargo:rerun-if-changed={}", path.display());
        }
    }
}
