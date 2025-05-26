use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Manager, Runtime, Resource,
};
use image::GenericImageView;
use std::process::{Command, Stdio};
use std::thread;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::io::Cursor;
use std::path::PathBuf;
use tauri::{
    menu::{
        MenuEvent,
    },
    AppHandle, PhysicalPosition, WebviewWindow, LogicalPosition, LogicalSize,
};

#[cfg(target_os = "macos")]
use {
    cocoa::appkit::NSWindowCollectionBehavior,
    objc::{msg_send, sel, sel_impl},
};

// Global icon cache to prevent excessive loading
lazy_static::lazy_static! {
    static ref ICON_CACHE: Arc<Mutex<HashMap<String, Image<'static>>>> = Arc::new(Mutex::new(HashMap::new()));
    static ref CURRENT_TRAY_STATE: Arc<Mutex<String>> = Arc::new(Mutex::new("ready".to_string()));
}

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
    // Convert path to string for cache lookup
    let path_str = path.to_string_lossy().to_string();
    
    // Try to get from cache first
    let mut cache = ICON_CACHE.lock().unwrap();
    if let Some(cached_icon) = cache.get(&path_str) {
        println!("🔍 Using cached icon for: {}", path.display());
        return Ok(cached_icon.clone());
    }
    
    // Not in cache, load from file
    println!("🔍 Loading icon from path: {}", path.display());
    let image_bytes = std::fs::read(path)?;
    
    // Use image crate to decode the PNG
    let img = image::load_from_memory(&image_bytes)?;
    let rgba = img.to_rgba8();
    let (width, height) = img.dimensions();
    
    // Create the image
    let icon = Image::new_owned(rgba.into_raw(), width, height);
    
    // Store in cache
    cache.insert(path_str, icon.clone());
    
    println!("✅ Successfully loaded icon: {}x{}", width, height);
    Ok(icon)
}

#[tauri::command]
async fn update_tray_icon(app: tauri::AppHandle, state: String) -> Result<(), String> {
    // Get current state and check if we should update
    let mut current_state = CURRENT_TRAY_STATE.lock().unwrap();
    
    // Don't update if we're already in a higher priority state
    // Priority: drawing > recognizing > recognized > not_recognized > ready > disconnected
    let should_update = match current_state.as_str() {
        "drawing" => {
            // Only update if we're transitioning to "recognizing" or keeping "drawing"
            state == "recognizing" || state == "drawing"
        },
        "recognizing" => {
            // Only update if we're transitioning to "recognized", "not_recognized", or back to "drawing"
            state == "recognized" || state == "not_recognized" || state == "drawing"
        },
        "recognized" => {
            // Allow transition to any state except "ready" or "disconnected"
            state != "ready" && state != "disconnected" || state == "drawing"
        },
        "not_recognized" => {
            // Allow transition to any state except "ready" or "disconnected"
            state != "ready" && state != "disconnected" || state == "drawing"
        },
        "ready" => {
            // Always allow transitions from ready state
            true
        },
        "disconnected" => {
            // Always allow transitions from disconnected state
            true
        },
        _ => true,
    };
    
    if !should_update {
        println!("🔒 Not updating tray icon: current={}, requested={}", *current_state, state);
        return Ok(());
    }
    
    // Special handling for "drawing" state to ensure it stays visible
    if state == "drawing" {
        println!("🎨 Drawing state requested - this will override other states");
    }
    
    // Special handling for "not_recognized" state to auto-transition to "ready" after 300ms
    if state == "not_recognized" {
        println!("⏱️ Setting up auto-transition from not_recognized to ready after 300ms");
        
        // Clone the app handle for use in the thread
        let app_handle = app.clone();
        
        // Create a new thread to handle the delayed state transition
        std::thread::spawn(move || {
            // Sleep for 300ms
            std::thread::sleep(std::time::Duration::from_millis(300));
            
            // Transition to ready state
            println!("⏱️ Auto-transitioning from not_recognized to ready state");
            
            // Create a direct tray_icon update instead of calling the async function
            if let Some(tray) = app_handle.tray_by_id("main") {
                let ready_tooltip = "AirCut - Ready to detect gestures";
                let _ = tray.set_tooltip(Some(ready_tooltip));
                
                let icon_path = get_icon_path("ready");
                
                // Get the icon path
                let icon_full_path = if cfg!(debug_assertions) {
                    std::env::current_dir().unwrap_or_default().join(&icon_path)
                } else {
                    app_handle.path().resource_dir().unwrap_or_default().join(&icon_path)
                };
                
                if icon_full_path.exists() {
                    if let Ok(icon) = load_icon_from_path(&icon_full_path) {
                        let _ = tray.set_icon(Some(icon));
                        println!("🎨 Auto-updated tray icon to: ready ({})", icon_path);
                        
                        // Update the state tracking
                        if let Ok(mut state) = CURRENT_TRAY_STATE.lock() {
                            *state = "ready".to_string();
                        }
                    }
                } else {
                    println!("⚠️ Tray icon not found during auto-transition, attempting to recreate");
                    if let Err(e) = recreate_tray_icon(&app_handle) {
                        println!("❌ Failed to recreate tray icon: {}", e);
                    }
                }
            }
        });
    }
    
    // Special handling for "recognized" state to auto-transition to "ready" after 3 seconds
    if state == "recognized" {
        println!("⏱️ Setting up auto-transition from recognized to ready after 3 seconds");
        
        // Clone the app handle for use in the thread
        let app_handle = app.clone();
        
        // Create a new thread to handle the delayed state transition
        std::thread::spawn(move || {
            // Sleep for 3 seconds
            std::thread::sleep(std::time::Duration::from_secs(3));
            
            // Transition to ready state
            println!("⏱️ Auto-transitioning from recognized to ready state");
            
            // Create a direct tray_icon update instead of calling the async function
            if let Some(tray) = app_handle.tray_by_id("main") {
                let ready_tooltip = "AirCut - Ready to detect gestures";
                let _ = tray.set_tooltip(Some(ready_tooltip));
                
                let icon_path = get_icon_path("ready");
                
                // Get the icon path
                let icon_full_path = if cfg!(debug_assertions) {
                    std::env::current_dir().unwrap_or_default().join(&icon_path)
                } else {
                    app_handle.path().resource_dir().unwrap_or_default().join(&icon_path)
                };
                
                if icon_full_path.exists() {
                    if let Ok(icon) = load_icon_from_path(&icon_full_path) {
                        let _ = tray.set_icon(Some(icon));
                        println!("🎨 Auto-updated tray icon to: ready ({})", icon_path);
                        
                        // Update the state tracking
                        if let Ok(mut state) = CURRENT_TRAY_STATE.lock() {
                            *state = "ready".to_string();
                        }
                    }
                } else {
                    println!("⚠️ Tray icon not found during auto-transition, attempting to recreate");
                    if let Err(e) = recreate_tray_icon(&app_handle) {
                        println!("❌ Failed to recreate tray icon: {}", e);
                    }
                }
            }
        });
    }
    
    // Update the current state
    *current_state = state.clone();
    println!("🔄 Tray icon state changed to: {}", state);
    
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
    } else {
        println!("⚠️ Tray icon not found, attempting to recreate it");
        // Try to recreate the tray icon
        recreate_tray_icon(&app)?;
    }
    
    Ok(())
}

// Function to recreate the tray icon if it disappears
fn recreate_tray_icon(app: &tauri::AppHandle) -> Result<(), String> {
    println!("🔄 Recreating tray icon");
    
    // Remove any existing tray icons first to avoid duplicates
    if let Some(tray) = app.tray_by_id("main") {
        println!("🧹 Removing existing tray icon before recreation");
        let _ = std::sync::Arc::new(tray).close();
    }
    
    // Create tray menu
    let menu = create_tray_menu(app).map_err(|e| e.to_string())?;
    
    // Load initial icon
    let initial_icon_path = get_icon_path("ready");
    
    // In development mode, use the source directory; in production, use resource directory
    let icon_full_path = if cfg!(debug_assertions) {
        // Development mode - current dir is already src-tauri/
        std::env::current_dir()
            .map_err(|e| e.to_string())?
            .join(&initial_icon_path)
    } else {
        // Production mode - use resource directory
        app.path().resource_dir()
            .map_err(|e| e.to_string())?
            .join(&initial_icon_path)
    };
    
    println!("🔍 Loading initial tray icon from: {}", icon_full_path.display());
    
    let initial_icon = if icon_full_path.exists() {
        match load_icon_from_path(&icon_full_path) {
            Ok(icon) => {
                println!("✅ Successfully loaded initial tray icon");
                icon
            }
            Err(e) => {
                println!("⚠️ Failed to load initial icon: {}", e);
                app.default_window_icon().unwrap().clone()
            }
        }
    } else {
        println!("⚠️ Initial icon file not found: {}", icon_full_path.display());
        app.default_window_icon().unwrap().clone()
    };
    
    // Create system tray
    let _tray = TrayIconBuilder::with_id("main")
        .tooltip("AirCut - Ready")
        .icon(initial_icon)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            match event {
                TrayIconEvent::Click { button: MouseButton::Left, .. } => {
                    // Left click shows/hides the main window
                    let app = tray.app_handle();
                    if let Some(window) = app.get_webview_window("main") {
                        // Check if window is visible (not off-screen)
                        let is_visible = match window.outer_position() {
                            Ok(position) => position.x > -1000 && position.y > -1000,
                            Err(_) => false
                        };
                        
                        if is_visible {
                            // Hide the window by moving it off-screen
                            println!("📱 Moving window off-screen");
                            let _ = window.set_position(tauri::LogicalPosition::new(-2000, -2000));
                            let _ = window.set_size(tauri::LogicalSize::new(1, 1));
                        } else {
                            // Show the window by moving it back on-screen
                            println!("📱 Moving window back on-screen");
                            let _ = window.set_size(tauri::LogicalSize::new(1400, 1000));
                            let _ = window.center();
                            
                            // Ensure window is visible on all workspaces (all virtual desktops)
                            #[cfg(target_os = "macos")]
                            make_window_visible_on_all_workspaces(&window);
                            
                            let _ = window.set_focus();
                            
                            // Dispatch window-shown event
                            let _ = window.eval("window.dispatchEvent(new Event('window-shown'))");
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
                        // Move the window back on-screen
                        let _ = window.set_size(tauri::LogicalSize::new(1400, 1000));
                        let _ = window.center();
                        
                        // Ensure window is visible on all workspaces (all virtual desktops)
                        #[cfg(target_os = "macos")]
                        make_window_visible_on_all_workspaces(&window);
                        
                        let _ = window.set_focus();
                        
                        // Dispatch window-shown event
                        let _ = window.eval("window.dispatchEvent(new Event('window-shown'))");
                    }
                }
                "quit" => {
                    app.exit(0);
                }
                _ => {}
            }
        })
        .build(app)
        .map_err(|e| e.to_string())?;
    
    // After recreating the tray, ensure window is set to be visible on all workspaces
    if let Some(window) = app.get_webview_window("main") {
        #[cfg(target_os = "macos")]
        make_window_visible_on_all_workspaces(&window);
    }
    
    println!("✅ Tray icon recreated successfully");
    Ok(())
}

#[tauri::command]
async fn show_main_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        // Move the window back on-screen
        window.set_size(tauri::LogicalSize::new(1400, 1000)).map_err(|e| e.to_string())?;
        window.center().map_err(|e| e.to_string())?;
        
        // Ensure window is visible on all workspaces (all virtual desktops)
        #[cfg(target_os = "macos")]
        make_window_visible_on_all_workspaces(&window);
        
        window.set_focus().map_err(|e| e.to_string())?;
        
        // Dispatch window-shown event
        let _ = window.eval("window.dispatchEvent(new Event('window-shown'))");
    }
    Ok(())
}

// Function to check if the backend is running and start it if needed
fn ensure_backend_is_running() -> Result<(), Box<dyn std::error::Error>> {
    // Check if the backend is running by trying to connect to the port
    let backend_running = std::net::TcpStream::connect("127.0.0.1:8000").is_ok();
    
    if !backend_running {
        println!("🔄 Backend not running, attempting to start it...");
        
        // Get the path to the backend directory
        let current_dir = std::env::current_dir()?;
        let backend_dir = current_dir.parent().unwrap().join("backend");
        
        // Command to start the backend
        let mut command = if cfg!(target_os = "windows") {
            let mut cmd = Command::new("cmd");
            cmd.args(["/C", "python", "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8000"]);
            cmd
        } else {
            let mut cmd = Command::new("python3");
            cmd.args(["-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8000"]);
            cmd
        };
        
        // Set the working directory and run in the background
        command.current_dir(&backend_dir);
        command.stdout(Stdio::piped());
        command.stderr(Stdio::piped());
        
        // Start the process
        match command.spawn() {
            Ok(child) => {
                println!("✅ Backend started successfully with PID: {:?}", child.id());
                
                // Start a thread to monitor the backend output
                thread::spawn(move || {
                    let _ = child.wait_with_output();
                });
                
                // Wait a bit for the backend to start
                thread::sleep(std::time::Duration::from_secs(2));
                
                // Check if it's actually running now
                if std::net::TcpStream::connect("127.0.0.1:8000").is_ok() {
                    println!("✅ Backend is now running on port 8000");
                } else {
                    println!("❌ Backend failed to start properly");
                }
            },
            Err(e) => {
                println!("❌ Failed to start backend: {}", e);
            }
        }
    } else {
        println!("✅ Backend is already running on port 8000");
    }
    
    Ok(())
}

#[tauri::command]
async fn startup_complete(app: tauri::AppHandle) -> Result<(), String> {
    println!("✅ App startup complete, ready to detect gestures");
    update_tray_icon(app, "ready".to_string()).await?;
    Ok(())
}

fn create_tray_menu<R: Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<Menu<R>> {
    // Create main menu items
    let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    // let separator1 = PredefinedMenuItem::separator(app)?;
    
    // Create quick action items with a prefix
    // let quick_right = MenuItem::with_id(app, "quick_right", "Desktop next", true, None::<&str>)?;
    // let quick_left = MenuItem::with_id(app, "quick_left", "⬅️ Left Arrow", true, None::<&str>)?;
    // let quick_spotify = MenuItem::with_id(app, "quick_spotify", "🎵 Open Spotify", true, None::<&str>)?;
    
    let separator2 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit AirCut", true, None::<&str>)?;
    
    // Build the complete menu
    Menu::with_items(app, &[
        &settings, 
        // &separator1, 
        // &quick_right, 
        // &quick_left, 
        // &quick_spotify, 
        &separator2, 
        &quit
    ])
}

// Function to periodically check and disable App Nap
#[cfg(target_os = "macos")]
fn start_app_nap_prevention_thread() {
    std::thread::spawn(|| {
        loop {
            // Reapply App Nap prevention every 5 minutes
            std::thread::sleep(std::time::Duration::from_secs(300));
            
            println!("🔄 Periodically refreshing App Nap prevention");
            macos_app_nap::prevent();
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Prevent App Nap on macOS to ensure background processing continues
    #[cfg(target_os = "macos")]
    {
        println!("🍎 Preventing macOS App Nap to ensure background processing");
        macos_app_nap::prevent();
        println!("✅ Successfully disabled App Nap");
        
        // Start thread to periodically refresh App Nap prevention
        start_app_nap_prevention_thread();
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Ensure the backend is running
            if let Err(e) = ensure_backend_is_running() {
                println!("❌ Failed to ensure backend is running: {}", e);
            }
            
            // Remove any existing tray icons first to avoid duplicates
            if let Some(tray) = app.handle().tray_by_id("main") {
                println!("🧹 Removing existing tray icon to avoid duplicates");
                let _ = std::sync::Arc::new(tray).close();
            }
            
            // Create tray menu
            let menu = create_tray_menu(&app.handle())?;
            
            // Load initial icon
            let initial_icon_path = get_icon_path("ready");
            
            println!("🔍 Current working directory: {:?}", std::env::current_dir().unwrap());
            
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
            
            println!("🔍 Loading initial tray icon from: {}", icon_full_path.display());
            
            let initial_icon = if icon_full_path.exists() {
                match load_icon_from_path(&icon_full_path) {
                    Ok(icon) => {
                        println!("✅ Successfully loaded initial tray icon");
                        icon
                    }
                    Err(e) => {
                        println!("⚠️ Failed to load initial icon: {}", e);
                        app.default_window_icon().unwrap().clone()
                    }
                }
            } else {
                println!("⚠️ Initial icon file not found: {}", icon_full_path.display());
                app.default_window_icon().unwrap().clone()
            };
            
            // Create system tray with show_menu_on_left_click explicitly set to true for better visibility
            let _tray = TrayIconBuilder::with_id("main")
                .tooltip("AirCut - Ready")
                .icon(initial_icon)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    match event {
                        TrayIconEvent::Click { button: MouseButton::Left, .. } => {
                            // Left click shows/hides the main window
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window("main") {
                                // Check if window is visible (not off-screen)
                                let is_visible = match window.outer_position() {
                                    Ok(position) => position.x > -1000 && position.y > -1000,
                                    Err(_) => false
                                };
                                
                                if is_visible {
                                    // Hide the window by moving it off-screen
                                    println!("📱 Moving window off-screen");
                                    let _ = window.set_position(tauri::LogicalPosition::new(-2000, -2000));
                                    let _ = window.set_size(tauri::LogicalSize::new(1, 1));
                                } else {
                                    // Show the window by moving it back on-screen
                                    println!("📱 Moving window back on-screen");
                                    let _ = window.set_size(tauri::LogicalSize::new(1400, 1000));
                                    let _ = window.center();
                                    
                                    // Ensure window is visible on all workspaces (all virtual desktops)
                                    #[cfg(target_os = "macos")]
                                    make_window_visible_on_all_workspaces(&window);
                                    
                                    let _ = window.set_focus();
                                    
                                    // Dispatch window-shown event
                                    let _ = window.eval("window.dispatchEvent(new Event('window-shown'))");
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
                                // Move the window back on-screen
                                let _ = window.set_size(tauri::LogicalSize::new(1400, 1000));
                                let _ = window.center();
                                
                                // Ensure window is visible on all workspaces (all virtual desktops)
                                #[cfg(target_os = "macos")]
                                make_window_visible_on_all_workspaces(&window);
                                
                                let _ = window.set_focus();
                                
                                // Dispatch window-shown event
                                let _ = window.eval("window.dispatchEvent(new Event('window-shown'))");
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .build(app)?;
            
            // Initialize the app even if window is hidden
            if let Some(window) = app.get_webview_window("main") {
                // Ensure window is visible on all workspaces (all virtual desktops)
                #[cfg(target_os = "macos")]
                make_window_visible_on_all_workspaces(&window);
                
                // Show the window briefly to ensure initialization
                let _ = window.show();
                std::thread::sleep(std::time::Duration::from_millis(500));
                
                // Initialize the app
                let app_handle = app.handle();
                if let Some(main_window) = app_handle.get_webview_window("main") {
                    let _ = main_window.eval("window.dispatchEvent(new Event('initialize-app'))");
                }
                
                // Move window off-screen to keep it running but visually hidden
                println!("📱 Moving window off-screen after initialization");
                let _ = window.set_position(tauri::LogicalPosition::new(-2000, -2000));
                let _ = window.set_size(tauri::LogicalSize::new(1, 1));
                let _ = window.show(); // Keep it "visible" but off-screen
                
                // Set up a handler for window close events
                let app_handle = app.handle().clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        // Prevent the window from closing
                        api.prevent_close();
                        
                        // Instead of closing the window, move it off-screen
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.set_position(tauri::LogicalPosition::new(-2000, -2000));
                            let _ = window.set_size(tauri::LogicalSize::new(1, 1));
                        }
                    }
                });
            }
            
            // Set up a periodic tray icon check to ensure it's always visible
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                loop {
                    std::thread::sleep(std::time::Duration::from_secs(30));
                    
                    // Check if tray icon exists, recreate if not
                    if app_handle.tray_by_id("main").is_none() {
                        println!("⚠️ Tray icon not found in periodic check, attempting to recreate");
                        if let Err(e) = recreate_tray_icon(&app_handle) {
                            println!("❌ Failed to recreate tray icon: {}", e);
                        }
                    }
                }
            });
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet, execute_command, update_tray_icon, show_main_window, startup_complete])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(target_os = "macos")]
fn make_window_visible_on_all_workspaces(window: &tauri::WebviewWindow) {
    use cocoa::appkit::{NSWindowCollectionBehavior};
    use objc::{msg_send, sel, sel_impl};
    
    if let Ok(ns_window) = window.ns_window() {
        let ns_window = ns_window as cocoa::base::id;
        
        unsafe {
            let current_behavior: NSWindowCollectionBehavior = msg_send![ns_window, collectionBehavior];
            let new_behavior = current_behavior | NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces;
            let _: () = msg_send![ns_window, setCollectionBehavior: new_behavior];
        }
        
        println!("✅ Window set to be visible on all workspaces");
    } else {
        println!("⚠️ Failed to get NSWindow handle");
    }
}
