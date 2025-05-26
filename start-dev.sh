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
python main.py &
BACKEND_PID=$!

# Wait a moment for backend to start
sleep 3

# Start frontend
echo "⚛️  Starting Tauri Frontend..."
cd ../desktop
npm run tauri dev
