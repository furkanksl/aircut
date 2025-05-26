#!/bin/bash

# Exit on error
set -e

echo "🚀 Setting up AirCut development environment..."
echo "============================================"

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[✓]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

print_error() {
    echo -e "${RED}[✗]${NC} $1"
}

print_info() {
    echo -e "${BLUE}[i]${NC} $1"
}

print_step() {
    echo -e "${PURPLE}[→]${NC} $1"
}

print_feature() {
    echo -e "${CYAN}[★]${NC} $1"
}

# Check for macOS
if [[ "$OSTYPE" != "darwin"* ]]; then
    print_warning "This setup script is optimized for macOS. You may need to adjust commands for other platforms."
fi

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to check version
check_version() {
    local cmd="$1"
    local required_version="$2"
    local current_version="$3"
    
    if [[ "$current_version" < "$required_version" ]]; then
        print_warning "$cmd version $current_version is below recommended $required_version"
        return 1
    else
        print_status "$cmd version $current_version meets requirements"
        return 0
    fi
}

echo ""
echo "🔍 System Requirements Check..."
echo "=============================="

# Check for Homebrew
print_step "Checking for Homebrew..."
if ! command_exists brew; then
    print_warning "Homebrew is required but not installed. Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    
    # Add brew to PATH for current session
    if [[ -f "/opt/homebrew/bin/brew" ]]; then
        eval "$(/opt/homebrew/bin/brew shellenv)"
    fi
    
    print_status "Homebrew installed successfully"
else
    print_status "Homebrew found"
    # Update Homebrew
    # print_step "Updating Homebrew..."
    # brew update
fi

# Check for Rust and Cargo (required for Tauri)
print_step "Checking for Rust and Cargo..."
if ! command_exists cargo; then
    print_warning "Rust is required for Tauri but not installed. Installing Rust..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source ~/.cargo/env
    print_status "Rust installed successfully"
else
    RUST_VERSION=$(rustc --version | cut -d' ' -f2)
    print_status "Rust found: $(rustc --version)"
    
    # Update Rust components
    print_step "Updating Rust toolchain..."
    rustup update
fi

# Check for Python 3.9+
print_step "Checking for Python 3.9+..."
if ! command_exists python3.11; then
    print_warning "Python 3.11 is required but not installed. Installing Python 3.11..."
    brew install python@3.11
    print_status "Python 3.11 installed successfully"
else
    PYTHON_VERSION=$(python3 --version | cut -d' ' -f2)
    PYTHON_MAJOR=$(echo $PYTHON_VERSION | cut -d'.' -f1)
    PYTHON_MINOR=$(echo $PYTHON_VERSION | cut -d'.' -f2)
    
    if [[ $PYTHON_MAJOR -eq 3 && $PYTHON_MINOR -ge 9 ]]; then
        print_status "Python found: $(python3 --version)"
    else
        print_warning "Python version $PYTHON_VERSION is below recommended 3.9. Installing Python 3.11..."
        brew install python@3.11
    fi
fi

# Check for Node.js 18+
print_step "Checking for Node.js 18+..."
if ! command_exists node; then
    print_warning "Node.js is required but not installed. Installing Node.js 20..."
    brew install node@20
    print_status "Node.js installed successfully"
else
    NODE_VERSION=$(node --version | sed 's/v//')
    NODE_MAJOR=$(echo $NODE_VERSION | cut -d'.' -f1)
    
    if [[ $NODE_MAJOR -ge 18 ]]; then
        print_status "Node.js found: v$NODE_VERSION"
    else
        print_warning "Node.js version v$NODE_VERSION is below recommended v18. Installing Node.js 20..."
        brew install node@20
    fi
fi

# Install/Update Tauri CLI
print_step "Installing/updating Tauri CLI..."
cargo install tauri-cli --version "^2.0"
print_status "Tauri CLI ready"

echo ""
echo "🐍 Setting up Python Backend..."
echo "==============================="

# Navigate to backend directory
cd backend

# Create Python virtual environment
print_step "Creating Python virtual environment..."
if [ -d "venv" ]; then
    print_warning "Virtual environment already exists. Removing old one..."
    rm -rf venv
fi

python3.11 -m venv venv
source venv/bin/activate
print_status "Virtual environment created and activated"

# Upgrade pip and install build tools
print_step "Upgrading pip and installing build tools..."
pip install --upgrade pip setuptools wheel
print_status "Build tools updated"

# Install Python dependencies from requirements.txt
print_step "Installing Python dependencies..."
if [ -f "requirements.txt" ]; then
    pip install -r requirements.txt
    print_status "Python dependencies installed from requirements.txt"
else
    print_error "requirements.txt not found in backend directory!"
    exit 1
fi

# Install additional development dependencies if needed
print_step "Installing additional development tools..."
pip install --upgrade pytest black flake8 mypy
print_status "Development tools installed"

# Return to root directory
cd ..

echo ""
echo "⚛️  Setting up React + Tauri Frontend..."
echo "======================================"

# Navigate to desktop directory and install Node.js dependencies
print_step "Installing Node.js dependencies..."
cd desktop

# Clear node_modules and package-lock if they exist to ensure clean install
# if [ -d "node_modules" ]; then
#     print_step "Cleaning existing node_modules..."
#     rm -rf node_modules
# fi

# if [ -f "package-lock.json" ]; then
#     rm package-lock.json
# fi

# Use npm for package installation
npm install
print_status "Node.js dependencies installed with npm"

# Install Tauri dependencies
print_step "Installing Tauri Rust dependencies..."
cd src-tauri
cargo fetch
print_status "Tauri Rust dependencies downloaded"

cd ../..

echo ""
echo "🔧 Verifying Configuration Files..."
echo "==================================="

# Check backend .env file
print_step "Checking backend configuration..."
if [ -f "backend/.env" ]; then
    print_status "Backend .env file found"
    
    # Check if Roboflow API key is set
    if grep -q "ROBOFLOW_API_KEY=" "backend/.env"; then
        API_KEY=$(grep "ROBOFLOW_API_KEY=" "backend/.env" | cut -d'=' -f2)
        if [ -n "$API_KEY" ] && [ "$API_KEY" != "your_roboflow_api_key_here" ]; then
            print_status "Roboflow API key is configured"
        else
            print_warning "Roboflow API key needs to be configured"
        fi
    else
        print_warning "ROBOFLOW_API_KEY not found in .env file"
    fi
else
    print_warning "Backend .env file not found. Creating template..."
    cat > backend/.env << EOL
# Roboflow Configuration
ROBOFLOW_API_KEY=your_roboflow_api_key_here
ROBOFLOW_MODEL_ID=handdetection-qycc7/1
ROBOFLOW_INFERENCE_URL=http://localhost:9001

# Backend Configuration
HOST=127.0.0.1
PORT=8000

# Camera Configuration  
VIDEO_SOURCE=0
CONFIDENCE_THRESHOLD=0.5
EOL
    print_status "Backend .env template created"
fi

# Create desktop .env file if it doesn't exist
print_step "Checking frontend configuration..."
if [ ! -f "desktop/.env" ]; then
    print_step "Creating frontend configuration..."
    cat > desktop/.env << EOL
# Tauri Configuration
TAURI_DEV_HOST=127.0.0.1
TAURI_DEV_PORT=1420

# Development Settings
VITE_API_URL=http://127.0.0.1:8000
VITE_WS_URL=ws://127.0.0.1:8000/ws
EOL
    print_status "Frontend .env file created"
else
    print_status "Frontend .env file found"
fi

echo ""
echo "🎯 Project Structure Verification..."
echo "===================================="

print_step "Verifying project structure..."

# Check if all required directories exist
required_dirs=("backend" "desktop" "desktop/src" "desktop/src-tauri" "desktop/src-tauri/src")
for dir in "${required_dirs[@]}"; do
    if [ -d "$dir" ]; then
        print_status "Directory $dir exists"
    else
        print_error "Required directory $dir is missing!"
        exit 1
    fi
done

# Check if all required files exist
required_files=(
    "backend/main.py"
    "backend/requirements.txt"
    "desktop/package.json"
    "desktop/src-tauri/Cargo.toml"
    "desktop/src-tauri/tauri.conf.json"
    "desktop/src-tauri/src/lib.rs"
    "desktop/src-tauri/src/main.rs"
)

for file in "${required_files[@]}"; do
    if [ -f "$file" ]; then
        print_status "File $file exists"
    else
        print_error "Required file $file is missing!"
        exit 1
    fi
done

echo ""
echo "🧪 Testing Development Environment..."
echo "===================================="

# Test Python backend setup
print_step "Testing Python backend setup..."
cd backend
source venv/bin/activate

# Test imports
python3.11 -c "
import fastapi
import uvicorn
import cv2
import numpy as np
from dotenv import load_dotenv
try:
    from inference import get_model
    print('✅ All Python dependencies imported successfully')
except ImportError as e:
    print(f'⚠️  Optional dependency missing: {e}')
    print('✅ Core Python dependencies imported successfully')
" && print_status "Python backend environment verified"

cd ..

# Test Node.js frontend setup
print_step "Testing Node.js frontend setup..."
cd desktop

# Check if we can run basic npm commands
npm list --depth=0 > /dev/null 2>&1 && print_status "Frontend dependencies verified"

# Test Tauri setup
print_step "Testing Tauri setup..."
cd src-tauri
cargo check > /dev/null 2>&1 && print_status "Tauri Rust code compiles successfully"
cd ../..

echo ""
echo "🔑 API Key Configuration..."
echo "=========================="

# Check if API key is properly configured
if grep -q "your_roboflow_api_key_here" "backend/.env" 2>/dev/null; then
    print_warning "⚠️  IMPORTANT: You need to update your Roboflow API key!"
    print_info "1. Get your API key from: https://app.roboflow.com/settings/api"
    print_info "2. Edit backend/.env and replace 'your_roboflow_api_key_here' with your actual API key"
    print_info "3. Optionally, update the ROBOFLOW_MODEL_ID if you're using a different model"
    echo ""
    print_warning "The application will not work properly without a valid Roboflow API key!"
else
    API_KEY=$(grep "ROBOFLOW_API_KEY=" "backend/.env" | cut -d'=' -f2)
    if [ -n "$API_KEY" ]; then
        print_status "Roboflow API key appears to be configured"
    fi
fi

echo ""
echo "📋 Development Scripts..."
echo "========================"

# Create convenience scripts
print_step "Creating development convenience scripts..."

# Create start-backend script
cat > start-backend.sh << EOL
#!/bin/bash
echo "🐍 Starting Python Backend..."
cd backend
source venv/bin/activate
python3.11 main.py
EOL
chmod +x start-backend.sh

# Create start-frontend script  
cat > start-frontend.sh << EOL
#!/bin/bash
echo "⚛️  Starting Tauri Frontend..."
cd desktop
npm run tauri dev
EOL
chmod +x start-frontend.sh

# Create full dev script
cat > start-dev.sh << EOL
#!/bin/bash
echo "🚀 Starting Full Development Environment..."
echo "This will start both backend and frontend in parallel"
echo ""

# Function to cleanup on exit
cleanup() {
    echo ""
    echo "🛑 Shutting down development servers..."
    kill 0
}
trap cleanup EXIT

# Start backend in background
echo "🐍 Starting Python Backend..."
cd backend
source venv/bin/activate
python3.11 main.py &
BACKEND_PID=\$!

# Wait a moment for backend to start
sleep 3

# Start frontend
echo "⚛️  Starting Tauri Frontend..."
cd ../desktop
npm run tauri dev
EOL
chmod +x start-dev.sh

print_status "Development scripts created"

echo ""
echo "✅ Setup Complete!"
echo "=================="

print_feature "AirCut development environment is ready!"

echo ""
print_info "📁 Project Components:"
print_info "  🐍 backend/        - Python FastAPI backend with Roboflow integration"
print_info "  ⚛️  desktop/        - React + Tauri desktop application"
print_info "  🦀 desktop/src-tauri/ - Tauri Rust configuration"

echo ""
print_info "🔧 Development Dependencies Installed:"
print_info "  • Python $(python3 --version | cut -d' ' -f2) with virtual environment"
print_info "  • Node.js $(node --version)"
print_info "  • npm $(npm --version)"
print_info "  • Rust $(rustc --version | cut -d' ' -f2)"
print_info "  • Tauri CLI v2.x"

echo ""
print_info "🚀 Quick Start Options:"
echo ""
print_info "Option 1 - Start Everything:"
print_info "  ./start-dev.sh"
echo ""
print_info "Option 2 - Start Backend Only:"
print_info "  ./start-backend.sh"
echo ""
print_info "Option 3 - Start Frontend Only:"
print_info "  ./start-frontend.sh"
echo ""
print_info "Option 4 - Manual Start:"
print_info "  Terminal 1:"
print_info "    cd backend"
print_info "    source venv/bin/activate"
print_info "    python main.py"
print_info ""
print_info "  Terminal 2:"
print_info "    cd desktop"
print_info "    npm run tauri dev"

echo ""
print_info "🌐 Application URLs:"
print_info "  • Backend API: http://127.0.0.1:8000"
print_info "  • Frontend: http://localhost:1420 (in Tauri window)"
print_info "  • API Health: http://127.0.0.1:8000/health"
print_info "  • API Docs: http://127.0.0.1:8000/docs"

echo ""
print_warning "📝 Remember to:"
if grep -q "your_roboflow_api_key_here" "backend/.env" 2>/dev/null; then
    print_info "  • ⚠️  Update your Roboflow API key in backend/.env"
fi
print_info "  • 📹 Ensure your camera is connected and working"
print_info "  • 🔒 Check that no other applications are using the camera"
print_info "  • 🔥 Allow camera permissions when prompted by the application"

echo ""
print_status "Happy coding! 🎉"
print_info "For issues, check the logs or visit the project documentation." 