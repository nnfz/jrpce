// src/discord_rpc.rs
use discord_rich_presence::{activity, DiscordIpcClient};
use discord_rich_presence::DiscordIpc; // <- обязательно, чтобы методы трейта были в scope
use std::sync::{Arc, Mutex};
use std::{thread, time::Duration};
use tauri::State;
use std::fs;
use std::process::Command;
use serde::{Deserialize, Serialize};


/// Состояние RPC для Tauri
pub struct RpcState {
    /// Arc<Mutex<DiscordIpcClient>> внутри Option, чтобы можно было дешёво клонировать хэндл для команд
    pub discord: Mutex<Option<Arc<Mutex<DiscordIpcClient>>>>,
}

impl RpcState {
    pub fn new() -> Self {
        Self {
            discord: Mutex::new(None),
        }
    }
}

/// Вспомогательная утилита для форматирования ошибок (Debug → String)
fn err_to_string<E: std::fmt::Debug>(e: E) -> String {
    format!("{:?}", e)
}

#[tauri::command]
pub fn init_rpc(state: State<'_, RpcState>, app_id: String) -> Result<(), String> {
    let max_attempts = 6u32;

    for attempt in 1..=max_attempts {
        let mut client = DiscordIpcClient::new(&app_id);

        match client.connect() {
            Ok(_) => {
                println!("Discord IPC connected on attempt {}/{}", attempt, max_attempts);

                let arc = Arc::new(Mutex::new(client));
                let mut guard = state.discord.lock().map_err(|e| format!("Mutex poisoned: {:?}", e))?;
                *guard = Some(arc);
                println!("Discord RPC initialized successfully.");
                return Ok(());
            }
            Err(e) => {
                let s = err_to_string(e);
                eprintln!("Discord connect attempt {}/{} failed: {}", attempt, max_attempts, s);
                if attempt < max_attempts {
                    thread::sleep(Duration::from_millis(500));
                    continue;
                } else {
                    return Err(format!(
                        "Failed to init Discord IPC after {} attempts: {}\n\
                         Проверьте, что:\n 1) Discord Desktop запущен (не Microsoft Store)\n 2) App ID верен\n 3) Discord полностью загрузился и не в состоянии обновления\n\
                         Дополнительно: посмотрите pipe'ы `\\\\.\\pipe\\discord-ipc-*` и логи Discord.",
                        max_attempts,
                        s
                    ));
                }
            }
        }
    }

    Err("Unreachable init_rpc error".into())
}

// ----------------- update_rpc (без блокировок main thread) -----------------
#[tauri::command]
pub fn update_rpc(
    state: State<'_, RpcState>,
    details: String,
    state_text: String,
    large_image: String,
    small_image: String,
    large_text: Option<String>,
    small_text: Option<String>,
    activity_type: Option<String>,
) -> Result<(), String> {
    // Получаем Arc<Mutex<DiscordIpcClient>>
    let arc_client = {
        let guard = state.discord.lock().map_err(|e| format!("Mutex poisoned: {:?}", e))?;
        guard
            .as_ref()
            .ok_or_else(|| "RPC client not initialized. Call init_rpc first.".to_string())?
            .clone()
    };

    // Развернём опции в owned строки (чтобы можно было безопасно перемещать в поток)
    let large_text = large_text.unwrap_or_default();
    let small_text = small_text.unwrap_or_default();

    // Клонируем строки, которые понадобятся в фоновом потоке (owned)
    let state_text_cl = state_text.clone();
    let details_cl = details.clone();
    let large_image_cl = large_image.clone();
    let small_image_cl = small_image.clone();
    let large_text_cl = large_text.clone();
    let small_text_cl = small_text.clone();
    let activity_type_cl = activity_type.clone();

    // Весь `match`/блок ниже гарантирует, что никакой MutexGuard не "переживёт"
    // время жизни `arc_client` или других временных переменных.
    let res = match arc_client.try_lock() {
        Ok(mut guard) => {
            // Быстрый/синхронный путь — лок взят, выполняем set_activity прямо сейчас.
            let mut activity = activity::Activity::new();
            if !state_text_cl.is_empty() {
                activity = activity.state(&state_text_cl);
            }
            if !details_cl.is_empty() {
                activity = activity.details(&details_cl);
            }

            if let Some(t) = activity_type {
                match t.to_lowercase().as_str() {
                    "playing" => { activity = activity.activity_type(activity::ActivityType::Playing); }
                    "listening" => { activity = activity.activity_type(activity::ActivityType::Listening); }
                    "watching" => { activity = activity.activity_type(activity::ActivityType::Watching); }
                    "competing" => { activity = activity.activity_type(activity::ActivityType::Competing); }
                    other => { eprintln!("Unknown activity_type '{}', ignoring", other); }
                }
            }

            if !large_image.is_empty() || !small_image.is_empty() || !large_text.is_empty() || !small_text.is_empty() {
                let mut assets = activity::Assets::new();
                if !large_image.is_empty() {
                    assets = assets.large_image(&large_image);
                }
                if !small_image.is_empty() {
                    assets = assets.small_image(&small_image);
                }
                if !large_text.is_empty() {
                    assets = assets.large_text(&large_text);
                }
                if !small_text.is_empty() {
                    assets = assets.small_text(&small_text);
                }
                activity = activity.assets(assets);
            }

            guard
                .set_activity(activity)
                .map_err(|e| format!("Failed to set activity: {:?}", e))
        }

        Err(std::sync::TryLockError::WouldBlock) => {
            // Если лок занят — спауним фоновый поток и возвращаем Ok сразу.
            let arc_for_thread = arc_client.clone();
            std::thread::spawn(move || {
                if let Ok(mut g) = arc_for_thread.lock() {
                    let mut activity = activity::Activity::new();
                    if !state_text_cl.is_empty() {
                        activity = activity.state(&state_text_cl);
                    }
                    if !details_cl.is_empty() {
                        activity = activity.details(&details_cl);
                    }

                    if let Some(t) = activity_type_cl {
                        match t.to_lowercase().as_str() {
                            "playing" => { activity = activity.activity_type(activity::ActivityType::Playing); }
                            "listening" => { activity = activity.activity_type(activity::ActivityType::Listening); }
                            "watching" => { activity = activity.activity_type(activity::ActivityType::Watching); }
                            "competing" => { activity = activity.activity_type(activity::ActivityType::Competing); }
                            other => { eprintln!("Unknown activity_type '{}', ignoring", other); }
                        }
                    }

                    if !large_image_cl.is_empty() || !small_image_cl.is_empty() || !large_text_cl.is_empty() || !small_text_cl.is_empty() {
                        let mut assets = activity::Assets::new();
                        if !large_image_cl.is_empty() {
                            assets = assets.large_image(&large_image_cl);
                        }
                        if !small_image_cl.is_empty() {
                            assets = assets.small_image(&small_image_cl);
                        }
                        if !large_text_cl.is_empty() {
                            assets = assets.large_text(&large_text_cl);
                        }
                        if !small_text_cl.is_empty() {
                            assets = assets.small_text(&small_text_cl);
                        }
                        activity = activity.assets(assets);
                    }

                    if let Err(e) = g.set_activity(activity) {
                        eprintln!("Background set_activity failed: {:?}", e);
                    }
                } else {
                    eprintln!("Background update_rpc: failed to lock arc_client");
                }
            });

            Ok(())
        }

        Err(std::sync::TryLockError::Poisoned(e)) => Err(format!("Mutex poisoned: {:?}", e)),
    };

    res
}



/// Очистить активность
#[tauri::command]
pub fn clear_rpc(state: State<'_, RpcState>) -> Result<(), String> {
    let arc_client = {
        let guard = state.discord.lock().map_err(|e| format!("Mutex poisoned: {:?}", e))?;
        guard
            .as_ref()
            .ok_or_else(|| "RPC client not initialized. Call init_rpc first.".to_string())?
            .clone()
    };

    let mut guard = arc_client.lock().map_err(|e| format!("Mutex poisoned: {:?}", e))?;
    guard
        .clear_activity()
        .map_err(|e| format!("Failed to clear activity: {:?}", e))
}

/// Закрыть RPC клиент (close)
#[tauri::command]
pub fn close_rpc(state: State<'_, RpcState>) -> Result<(), String> {
    // Возьмём Option и если есть — закроем
    let maybe_arc = {
        let mut guard = state.discord.lock().map_err(|e| format!("Mutex poisoned: {:?}", e))?;
        guard.take()
    };

    if let Some(arc_client) = maybe_arc {
        // Закрываем (получаем mutable и вызываем close)
        let mut client = arc_client.lock().map_err(|e| format!("Mutex poisoned: {:?}", e))?;
        client
            .close()
            .map_err(|e| format!("Failed to close Discord IPC client: {:?}", e))?;
    }

    println!("Discord RPC client closed.");
    Ok(())
}

#[tauri::command]
pub fn debug_ipc_pipes() -> Result<Vec<String>, String> {
    // Только для Windows — на других платформах нет discord ipc pipes
    if !cfg!(windows) {
        return Err("debug_ipc_pipes: supported on Windows only".into());
    }

    // Попытка 1: читать \\.\pipe\ напрямую
    match fs::read_dir(r"\\.\pipe\") {
        Ok(entries) => {
            let mut found = Vec::new();
            for entry in entries.flatten() {
                if let Some(name) = entry.file_name().to_str() {
                    if name.contains("discord-ipc") {
                        found.push(name.to_string());
                    }
                }
            }
            if found.is_empty() {
                found.push("No Discord IPC pipes found".to_string());
            }
            return Ok(found);
        }
        Err(e) => {
            // Попытка 2: powershell fallback (если read_dir недоступен по каким-то причинам)
            let ps_cmd = r#"Get-ChildItem \\.\pipe\ | Where-Object Name -Match 'discord-ipc' | Select-Object -ExpandProperty Name"#;
            let out = Command::new("powershell")
                .args(&["-NoProfile", "-Command", ps_cmd])
                .output();

            match out {
                Ok(output) => {
                    if output.status.success() {
                        let s = String::from_utf8_lossy(&output.stdout).to_string();
                        let mut lines: Vec<String> = s
                            .lines()
                            .map(|l| l.trim().to_string())
                            .filter(|l| !l.is_empty())
                            .collect();
                        if lines.is_empty() {
                            lines.push("No Discord IPC pipes found".to_string());
                        }
                        return Ok(lines);
                    } else {
                        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                        return Err(format!(
                            "Failed to enumerate pipes (read_dir error: {:?}). Powershell returned error: {}",
                            e, stderr
                        ));
                    }
                }
                Err(e2) => {
                    return Err(format!(
                        "Failed to enumerate pipes: read_dir error: {:?}, powershell spawn error: {:?}",
                        e, e2
                    ));
                }
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AllowedProcess {
    pub process_name: String,
    pub icon_path: String,
    pub display_name: String,
    #[serde(default)]
    pub app_id: Option<String>,
    #[serde(default)]
    pub title_extract_patterns: Option<Vec<String>>,
}


#[tauri::command]
pub fn get_allowed_processes() -> Result<Vec<AllowedProcess>, String> {
    let json = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/src/allowed_processes.json"));
    serde_json::from_str::<Vec<AllowedProcess>>(json)
        .map_err(|e| format!("Failed to parse allowed_processes.json: {}", e))
}
