use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Manager, Runtime,
};
use image::GenericImageView;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
async fn execute_command(command: String) -> Result<String, String> {
    use std::process::Command;
    
    println!("🚀 Executing command: {}", command);
    
    let output = if cfg!(target_os = "windows") {
        Command::new("cmd")
            .args(["/C", &command])
            .output()
    } else {
        Command::new("sh")
            .args(["-c", &command])
            .output()
    };
    
    match output {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            
            if output.status.success() {
                println!("✅ Command executed successfully");
                Ok(format!("Command executed successfully.\nOutput: {}", stdout))
            } else {
                println!("❌ Command failed with stderr: {}", stderr);
                Err(format!("Command failed with exit code {}.\nError: {}", 
                    output.status.code().unwrap_or(-1), stderr))
            }
        }
        Err(e) => {
            println!("❌ Failed to execute command: {}", e);
            Err(format!("Failed to execute command: {}", e))
        }
    }
}

fn is_dark_mode() -> bool {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        let output = Command::new("defaults")
            .args(["read", "-g", "AppleInterfaceStyle"])
            .output();
        
        if let Ok(output) = output {
            let result = String::from_utf8_lossy(&output.stdout);
            result.trim() == "Dark"
        } else {
            false // Default to light mode if we can't detect
        }
    }
    
    #[cfg(not(target_os = "macos"))]
    false // Default to light mode on other platforms
}

fn get_icon_path(state: &str) -> String {
    let theme = if is_dark_mode() { "dark" } else { "light" };
    
    match state {
        "ready" => format!("icons/tray-ready-{}.png", theme),
        "drawing" => format!("icons/tray-drawing-{}.png", theme),
        "recognizing" => format!("icons/tray-drawing-{}.png", theme),
        "recognized" => format!("icons/tray-recognized-{}.png", theme),
        "not_recognized" => format!("icons/tray-not-recognized-{}.png", theme),
        "disconnected" => format!("icons/tray-disconnected-{}.png", theme),
        _ => format!("icons/tray-ready-{}.png", theme),
    }
}

fn load_icon_from_path(path: &std::path::Path) -> Result<Image<'static>, Box<dyn std::error::Error>> {
    let image_bytes = std::fs::read(path)?;
    
    // Use image crate to decode the PNG
    let img = image::load_from_memory(&image_bytes)?;
    let rgba = img.to_rgba8();
    let (width, height) = img.dimensions();
    
    Ok(Image::new_owned(rgba.into_raw(), width, height))
}

#[tauri::command]
async fn update_tray_icon(app: tauri::AppHandle, state: String) -> Result<(), String> {
    let tooltip = match state.as_str() {
        "ready" => "AirCut - Ready to detect gestures",
        "drawing" => "AirCut - Recording gesture...",
        "recognizing" => "AirCut - Recognizing gesture...",
        "recognized" => "AirCut - Gesture recognized",
        "not_recognized" => "AirCut - Gesture not recognized",
        "disconnected" => "AirCut - Disconnected from backend",
        _ => "AirCut",
    };
    
    if let Some(tray) = app.tray_by_id("main") {
        // Update tooltip
        tray.set_tooltip(Some(tooltip)).map_err(|e| e.to_string())?;
        
        // Update icon
        let icon_path = get_icon_path(&state);
        
        // In development mode, use the source directory; in production, use resource directory
        let icon_full_path = if cfg!(debug_assertions) {
            // Development mode - current dir is already src-tauri/
            std::env::current_dir()
                .map_err(|e| e.to_string())?
                .join(&icon_path)
        } else {
            // Production mode - use resource directory
            app.path().resource_dir()
                .map_err(|e| e.to_string())?
                .join(&icon_path)
        };
            
        if icon_full_path.exists() {
            match load_icon_from_path(&icon_full_path) {
                Ok(icon) => {
                    tray.set_icon(Some(icon)).map_err(|e| e.to_string())?;
                    println!("🎨 Updated tray icon to: {} ({})", state, icon_path);
                }
                Err(e) => {
                    println!("⚠️ Failed to load icon {}: {}", icon_path, e);
                }
            }
        } else {
            println!("⚠️ Icon file not found: {}", icon_full_path.display());
        }
    }
    
    Ok(())
}

#[tauri::command]
async fn show_main_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn create_tray_menu<R: Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<Menu<R>> {
    let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit AirCut", true, None::<&str>)?;
    
    Menu::with_items(app, &[&settings, &separator, &quit])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Create tray menu
            let menu = create_tray_menu(&app.handle())?;
            
            // Load initial icon
            let initial_icon_path = get_icon_path("disconnected");
            
            // In development mode, use the source directory; in production, use resource directory
            let icon_full_path = if cfg!(debug_assertions) {
                // Development mode - current dir is already src-tauri/
                std::env::current_dir()
                    .map_err(|e| tauri::Error::Io(e))?
                    .join(&initial_icon_path)
            } else {
                // Production mode - use resource directory
                app.path().resource_dir()?.join(&initial_icon_path)
            };
            
            let initial_icon = if icon_full_path.exists() {
                load_icon_from_path(&icon_full_path).unwrap_or_else(|_| {
                    app.default_window_icon().unwrap().clone()
                })
            } else {
                app.default_window_icon().unwrap().clone()
            };
            
            // Create system tray
            let _tray = TrayIconBuilder::with_id("main")
                .tooltip("AirCut - Disconnected")
                .icon(initial_icon)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    match event {
                        TrayIconEvent::Click { button: MouseButton::Left, .. } => {
                            // Left click shows/hides the main window
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window("main") {
                                if window.is_visible().unwrap_or(false) {
                                    let _ = window.hide();
                                } else {
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                }
                            }
                        }
                        TrayIconEvent::Click { button: MouseButton::Right, .. } => {
                            // Right click shows the menu (handled automatically)
                        }
                        _ => {}
                    }
                })
                .on_menu_event(|app, event| {
                    match event.id().as_ref() {
                        "settings" => {
                            // Show the main window when settings is clicked
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .build(app)?;
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet, execute_command, update_tray_icon, show_main_window])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
