#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod windows_api;
mod discord_rpc;

use discord_rpc::RpcState;

fn main() {
    tauri::Builder::default()
        // состояние для Discord RPC
        .manage(RpcState::new())
        .invoke_handler(tauri::generate_handler![
            // Windows API
            windows_api::get_windows_list,
            windows_api::minimize_window,
            windows_api::toggle_maximize_window,
            windows_api::close_window,
            windows_api::is_window_active,
            windows_api::get_app_version,

            // Discord RPC
            discord_rpc::debug_ipc_pipes, // <-- добавьте эту строку
            discord_rpc::get_allowed_processes, 
            discord_rpc::init_rpc,
            discord_rpc::update_rpc,
            discord_rpc::clear_rpc,
            discord_rpc::close_rpc,
        ])
        // плагин для работы с файлами
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
