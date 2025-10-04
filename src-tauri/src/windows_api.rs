use std::{ffi::OsString, os::windows::ffi::OsStringExt};
use windows::{
    Win32::{
        Foundation::{BOOL, HWND, LPARAM},
        System::ProcessStatus::GetProcessImageFileNameW,
        System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION},
        UI::WindowsAndMessaging::{
            EnumWindows, GetWindowTextLengthW, GetWindowTextW, IsWindowVisible,
            ShowWindow, SW_MINIMIZE, SW_MAXIMIZE, SW_RESTORE, SW_HIDE,
            GetWindowPlacement, WINDOWPLACEMENT, IsWindow,
        },
    },
};

use regex::Regex;
use once_cell::sync::Lazy;
use serde::Deserialize;

 

#[derive(Debug, serde::Serialize)]
pub struct WindowInfo {
    pub hwnd: isize,
    pub title: String,
    pub process_name: String,
    pub icon_path: String,
    pub display_name: String, // Добавляем человекочитаемое имя
    pub document_name: String,
}

#[derive(Debug, Deserialize)]
struct AllowedProcessCfg {
    process_name: String,
    icon_path: String,
    display_name: String,
    #[serde(default)]
    title_extract_patterns: Vec<String>,
}

#[derive(Debug)]
struct CompiledAllowedProcess {
    process_name: String,
    icon_path: String,
    display_name: String,
    title_extract_regexes: Vec<Regex>,
}

static ALLOWED_PROCESSES: Lazy<Vec<CompiledAllowedProcess>> = Lazy::new(|| {
    let json = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/src/allowed_processes.json"));
    let cfgs: Vec<AllowedProcessCfg> = serde_json::from_str(json).unwrap_or_default();
    cfgs
        .into_iter()
        .map(|c| CompiledAllowedProcess {
            process_name: c.process_name,
            icon_path: c.icon_path,
            display_name: c.display_name,
            title_extract_regexes: c
                .title_extract_patterns
                .into_iter()
                .filter_map(|p| Regex::new(&p).ok())
                .collect(),
        })
        .collect()
});

fn extract_document_name(cfg: &CompiledAllowedProcess, window_title: &str) -> String {
    for re in &cfg.title_extract_regexes {
        if let Some(caps) = re.captures(window_title) {
            if let Some(m) = caps.get(1) {
                return m.as_str().to_string();
            }
            if let Some(m) = caps.get(0) {
                return m.as_str().to_string();
            }
        }
    }
    String::new()
}
unsafe extern "system" fn enum_windows_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let windows = &mut *(lparam.0 as *mut Vec<WindowInfo>);
    // Список: (имя_процесса, путь_к_иконке, display_name)

    if IsWindowVisible(hwnd).as_bool() {
        let length = GetWindowTextLengthW(hwnd);
        if length > 0 {
            let mut buffer = vec![0u16; (length + 1) as usize];
            let read_length = GetWindowTextW(hwnd, &mut buffer);
            if read_length > 0 {
                let title = OsString::from_wide(&buffer[..read_length as usize])
                    .to_string_lossy()
                    .into_owned();

                // Получаем имя процесса
                let process_name = get_process_name(hwnd);
                if let Some(cfg) = ALLOWED_PROCESSES
                    .iter()
                    .find(|cfg| cfg.process_name == process_name)
                {
                    let document_name = extract_document_name(cfg, &title);
                    windows.push(WindowInfo {
                        hwnd: hwnd.0,
                        title,
                        process_name,
                        icon_path: cfg.icon_path.clone(),
                        display_name: cfg.display_name.clone(),
                        document_name,
                    });
                }
            }
        }
    }

    BOOL(1) // Продолжаем перечисление
}

// Функция для получения имени процесса по HWND
fn get_process_name(hwnd: HWND) -> String {
    let mut process_id: u32 = 0;
    unsafe {
        windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId(hwnd, Some(&mut process_id));
    }

    let process_handle = unsafe {
        OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, BOOL(0), process_id)
    };

    let process_name = if let Ok(handle) = process_handle {
        let mut buffer = [0u16; 1024];
        let length = unsafe {
            GetProcessImageFileNameW(handle, &mut buffer)
        };
        let _ = unsafe { windows::Win32::Foundation::CloseHandle(handle) };
        if length > 0 {
            OsString::from_wide(&buffer[..length as usize])
                .to_string_lossy()
                .into_owned()
                .split('\\')
                .last()
                .unwrap_or_default()
                .to_string()
        } else {
            String::new()
        }
    } else {
        String::new()
    };

    process_name
}

#[tauri::command]
pub fn get_windows_list() -> Vec<WindowInfo> {
    let mut windows = Vec::new();
    let _ = unsafe { EnumWindows(Some(enum_windows_proc), LPARAM(&mut windows as *mut _ as isize)) };
    windows
}

#[tauri::command]
pub fn minimize_window() -> Result<(), String> {
    unsafe {
        let hwnd = windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow();
        if hwnd.0 != 0 {
            ShowWindow(hwnd, SW_MINIMIZE);
            Ok(())
        } else {
            Err("Failed to get foreground window".to_string())
        }
    }
}

#[tauri::command]
pub fn toggle_maximize_window() -> Result<(), String> {
    unsafe {
        let hwnd = windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow();
        if hwnd.0 != 0 {
            let mut placement = WINDOWPLACEMENT::default();
            placement.length = std::mem::size_of::<WINDOWPLACEMENT>() as u32;
            
            if GetWindowPlacement(hwnd, &mut placement).is_ok() {
                if placement.showCmd == SW_MAXIMIZE.0 as u32 {
                    ShowWindow(hwnd, SW_RESTORE);
                } else {
                    ShowWindow(hwnd, SW_MAXIMIZE);
                }
                Ok(())
            } else {
                Err("Failed to get window placement".to_string())
            }
        } else {
            Err("Failed to get foreground window".to_string())
        }
    }
}

#[tauri::command]
pub fn close_window() -> Result<(), String> {
    unsafe {
        let hwnd = windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow();
        if hwnd.0 != 0 {
            ShowWindow(hwnd, SW_HIDE);
            Ok(())
        } else {
            Err("Failed to get foreground window".to_string())
        }
    }
}

#[tauri::command]
pub fn is_window_active(hwnd: isize) -> bool {
    unsafe {
        let hwnd = HWND(hwnd);
        IsWindow(hwnd).as_bool() && IsWindowVisible(hwnd).as_bool()
    }
}

#[tauri::command]
pub fn get_app_version() -> String {
    // Читаем версию из tauri.conf.json во время компиляции
    env!("CARGO_PKG_VERSION").to_string()
}