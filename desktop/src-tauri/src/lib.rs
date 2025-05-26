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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, execute_command])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
