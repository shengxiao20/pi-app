use tauri::Manager;

pub mod commands;
pub mod rpc;
pub mod session_process;
pub mod tags;
pub mod workspace;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let cwd = std::env::current_dir()
        .expect("Pi App desktop client requires a current working directory");
    tauri::Builder::default()
        .manage(commands::AppState::new(cwd))
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::start_session,
            commands::create_session,
            commands::send_rpc,
            commands::abort_session,
            commands::current_workspace,
            commands::choose_workspace,
            commands::list_sessions,
            commands::session_history,
            commands::list_tags,
            commands::create_tag,
            commands::rename_tag,
            commands::delete_tag,
            commands::list_session_tag_assignments,
            commands::assign_session_tag,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Pi App desktop client")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                let state = app.state::<commands::AppState>();
                let errors = tauri::async_runtime::block_on(state.shutdown_all());
                if !errors.is_empty() {
                    eprintln!(
                        "Pi App could not stop every session runtime during shutdown: {}",
                        errors
                            .into_iter()
                            .map(|error| error.to_string())
                            .collect::<Vec<_>>()
                            .join("; ")
                    );
                }
            }
        });
}

#[cfg(test)]
mod tests {
    #[test]
    fn desktop_crate_is_testable() {
        assert_eq!(env!("CARGO_PKG_NAME"), "pi-app-desktop");
    }
}
