pub mod commands;
pub mod rpc;
pub mod workspace;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let cwd = std::env::current_dir()
        .expect("Pi App desktop client requires a current working directory");
    let launch_session = launch_session_argument().map(|session| {
        std::fs::canonicalize(&session)
            .unwrap_or_else(|error| panic!("Pi App handoff session is unavailable: {error}"))
    });

    tauri::Builder::default()
        .manage(commands::AppState::new(cwd, launch_session))
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::start_agent,
            commands::send_rpc,
            commands::abort_agent,
            commands::launch_session,
            commands::current_directory,
            commands::list_sessions,
            commands::session_history,
            commands::delete_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Pi App desktop client");
}

fn launch_session_argument() -> Option<std::path::PathBuf> {
    let mut arguments = std::env::args_os().skip(1);
    while let Some(argument) = arguments.next() {
        if argument == "--pi-session-file" {
            return Some(std::path::PathBuf::from(
                arguments
                    .next()
                    .expect("--pi-session-file requires a session path"),
            ));
        }
    }
    None
}
#[cfg(test)]
mod tests {
    #[test]
    fn desktop_crate_is_testable() {
        assert_eq!(env!("CARGO_PKG_NAME"), "pi-app-desktop");
    }
}
