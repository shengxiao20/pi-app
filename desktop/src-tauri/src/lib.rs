pub mod commands;
pub mod rpc;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let cwd = std::env::current_dir()
        .expect("Pi App desktop client requires a current working directory");

    tauri::Builder::default()
        .manage(commands::AppState::new(cwd))
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::start_agent,
            commands::send_rpc,
            commands::abort_agent
        ])
        .run(tauri::generate_context!())
        .expect("error while running Pi App desktop client");
}

#[cfg(test)]
mod tests {
    #[test]
    fn desktop_crate_is_testable() {
        assert_eq!(env!("CARGO_PKG_NAME"), "pi-app-desktop");
    }
}
