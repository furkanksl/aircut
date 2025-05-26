# AirCut 🖐️

> **Real-time Air Gesture Recognition Desktop Application**

AirCut is a modern desktop application that enables intuitive air gesture recognition using computer vision and machine learning. Draw gestures in the air with your hand and execute custom commands through advanced gesture recognition algorithms.

![AirCut Demo](https://via.placeholder.com/800x400/1e293b/f8fafc?text=AirCut+Desktop+App)

## 🌟 Features

### ✨ Core Functionality

- **Real-time Hand Tracking** - Advanced computer vision using Roboflow inference
- **Air Gesture Recording** - Capture complex gesture trajectories in 3D space
- **Template-based Recognition** - Create and manage custom gesture templates
- **Command Execution** - Link gestures to system commands or actions
- **Silent Operation** - Clean, distraction-free user experience

### 🚀 Performance & UX

- **High-Performance Streaming** - Optimized 25 FPS processing with 240x180 inference resolution
- **Local Processing** - No cloud dependencies, complete privacy
- **Real-time Feedback** - Instant visual feedback during gesture recording
- **Modern UI** - Beautiful dark/light mode interface with smooth animations
- **Cross-Platform** - Built with Tauri for native desktop performance

### 🛠️ Technical Features

- **Dynamic Time Warping (DTW)** - Advanced gesture matching algorithm
- **Confidence Thresholds** - Adjustable detection and recognition sensitivity
- **Stateless Architecture** - Efficient client-server communication
- **WebSocket Communication** - Real-time bidirectional data exchange
- **Frame-by-Frame Processing** - Optimized video processing pipeline

## 🏗️ Architecture

AirCut follows a modern client-server architecture designed for performance and maintainability:

```
┌─────────────────────────────────────────────────────────────┐
│                     AirCut Desktop App                     │
│                        (Tauri)                             │
├─────────────────────────────────────────────────────────────┤
│  Frontend (React + TypeScript)                             │
│  ├── Video Capture & Streaming                             │
│  ├── Gesture Visualization                                 │
│  ├── Template Management (Client-side Storage)             │
│  └── Real-time UI Updates                                  │
├─────────────────────────────────────────────────────────────┤
│  Backend Communication                                      │
│  ├── WebSocket Camera Stream (/ws/frames)                   │
│  ├── WebSocket Gesture Recognition (/ws/gestures)           │
│  └── REST API Health Checks                                │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Backend Server                           │
│                   (Python FastAPI)                         │
├─────────────────────────────────────────────────────────────┤
│  Frame Processing Pipeline                                  │
│  ├── Frame Decoding & Preprocessing                        │
│  ├── Roboflow ML Inference                                 │
│  ├── Hand Detection                                 │
│  └── Coordinate Normalization                              │
├─────────────────────────────────────────────────────────────┤
│  Gesture Recognition Engine                                │
│  ├── Trajectory Processing                                 │
│  ├── DTW-based Template Matching                           │
│  ├── Confidence Scoring                                    │
│  └── Stateless Recognition Service                         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│               Roboflow Inference API                       │
│                 (Computer Vision ML)                       │
├─────────────────────────────────────────────────────────────┤
│  Hand Detection Model                                       │
│  ├── Real-time Hand Tracking                             │
│  ├── Bounding Box Detection                                │
│  ├── Confidence Scoring                                    │
│  └── Coordinate Extraction                                 │
└─────────────────────────────────────────────────────────────┘
```

### 🔄 Data Flow

1. **Video Capture**: Frontend captures webcam frames at 30 FPS
2. **Camera Stream**: Compressed frames sent to backend via Camera Stream WebSocket (/ws/frames)
3. **ML Inference**: Backend processes frames using Roboflow API (25 FPS)
4. **Detection Results**: Hand coordinates sent back to frontend via Camera Stream WebSocket
5. **Gesture Recording**: Frontend tracks hand movements when drawing
6. **Recognition**: Recorded trajectories compared against stored templates via Gesture WebSocket (/ws/gestures)
7. **Command Execution**: Matched gestures trigger associated commands

## 🛠️ Technology Stack

### Frontend (Desktop Application)

- **[Tauri](https://tauri.app/)** - Rust-based desktop app framework
- **[React 18](https://react.dev/)** - Modern UI library with hooks
- **[TypeScript](https://www.typescriptlang.org/)** - Type-safe JavaScript
- **[Tailwind CSS](https://tailwindcss.com/)** - Utility-first CSS framework
- **[Zustand](https://zustand-demo.pmnd.rs/)** - Lightweight state management
- **[Sonner](https://sonner.emilkowal.ski/)** - Toast notifications (minimal usage)

### Backend (Server)

- **[FastAPI](https://fastapi.tiangolo.com/)** - High-performance Python web framework
- **[WebSockets](https://websockets.readthedocs.io/)** - Real-time bidirectional communication
- **[OpenCV](https://opencv.org/)** - Computer vision and image processing
- **[NumPy](https://numpy.org/)** - Numerical computing for trajectory processing
- **[Uvicorn](https://www.uvicorn.org/)** - ASGI server for production performance

### Machine Learning & AI

- **[Roboflow](https://roboflow.com/)** - Computer vision platform and inference API
- **[Inference](https://github.com/roboflow/inference)** - Robofflow inference python sdk to run the model in python proccessor
- **Dynamic Time Warping (DTW)** - Custom gesture matching algorithm
- **Trajectory Normalization** - Mathematical gesture standardization

### Development & Build Tools

- **[Vite](https://vitejs.dev/)** - Fast build tool and dev server
- **[Rust](https://www.rust-lang.org/)** - Systems programming for Tauri
- **[Python 3.8+](https://www.python.org/)** - Backend runtime environment

## 📋 Prerequisites

Before installing AirCut, ensure you have the following:

### System Requirements

- **Operating System**: Windows 10+, macOS 10.15+, or Linux
- **RAM**: Minimum 4GB, recommended 8GB+
- **Storage**: 500MB free space
- **Webcam**: Built-in or external USB webcam
- **Internet**: Required for initial setup and ML model downloads

### Development Prerequisites

- **[Rust](https://rustup.rs/)** 1.70+ (for Tauri)
- **[Node.js](https://nodejs.org/)** 18+ and npm
- **[Python](https://www.python.org/)** 3.8+
- **[Git](https://git-scm.com/)** for version control

### API Keys

- **Roboflow Account** - Free account at [roboflow.com](https://roboflow.com)
- **API Key** - Generate from your Roboflow dashboard

## 🚀 Quick Start

### 1. Clone Repository

```bash
git clone https://github.com/furkanksl/aircut.git
cd aircut
```

### 2. Install Dependencies

#### Frontend Dependencies

```bash
npm install
```

#### Backend Dependencies

```bash
cd backend
python3.11 -m venv venv

# Activate virtual environment
source venv/bin/activate  # macOS/Linux
# or
.\venv\Scripts\activate   # Windows

pip install -r requirements.txt
```

### 3. Configure Environment

Create environment configuration:

```bash
# Create backend/.env file
cat > backend/.env << EOF
ROBOFLOW_API_KEY=your_roboflow_api_key_here
ROBOFLOW_MODEL_ID=handdetection-qycc7/1
CONFIDENCE_THRESHOLD=0.2
EOF
```

### 4. Start Development Servers

#### Terminal 1: Backend Server

```bash
cd backend
source venv/bin/activate  # or .\venv\Scripts\activate on Windows
python3.11 main.py
```

#### Terminal 2: Frontend App

```bash
npm run tauri dev
```

### 5. First Run Setup

1. Allow camera permissions when prompted
2. Wait for backend connection (green indicator)
3. Try recording your first gesture!

## 📖 Detailed Installation

### Backend Setup

1. **Create Virtual Environment**

   ```bash
   cd backend
   python3.11 -m venv venv
   source venv/bin/activate  # macOS/Linux
   .\venv\Scripts\activate   # Windows
   ```

2. **Install Python Dependencies**

   ```bash
   pip install --upgrade pip
   pip install -r requirements.txt
   pip install inference
   ```

3. **Verify Installation**
   ```bash
   python3.11 -c "import cv2, fastapi, inference; print('All dependencies installed successfully!')"
   ```

### Frontend Setup

1. **Install Node Dependencies**

   ```bash
   npm install
   ```

2. **Install Tauri CLI**

   ```bash
   npm install -g @tauri-apps/cli
   ```

3. **Verify Rust Installation**
   ```bash
   rustc --version
   cargo --version
   ```

### Environment Configuration

#### Backend Environment Variables (.env)

```env
# Required
ROBOFLOW_API_KEY=your_api_key_here
ROBOFLOW_MODEL_ID=handdetection-qycc7/1

# Optional (with defaults)
CONFIDENCE_THRESHOLD=0.2
SERVER_HOST=127.0.0.1
SERVER_PORT=8000
```

#### Getting Your Roboflow API Key

1. Visit [roboflow.com](https://roboflow.com) and create a free account
2. Go to your account settings
3. Navigate to the "API" section
4. Copy your API key
5. Paste it in your `.env` file

## 🎮 Usage Guide

### Basic Workflow

1. **Start the Application**

   - Launch both backend and frontend servers
   - Ensure camera permissions are granted
   - Wait for green connection indicator

2. **Record a Gesture**

   - Click the blue "Play" button or wait for auto-start
   - Move your hand in the air to draw a gesture
   - The app tracks your movement with visual feedback
   - Click "Stop" or remove your hand to finish recording

3. **Save Template**

   - Click "Save" after recording a gesture
   - Enter a descriptive name (e.g., "Circle", "Wave")
   - Optionally add a command (e.g., "open browser")
   - Click "Save Template"

4. **Recognize Gestures**
   - Record a new gesture
   - The app automatically compares it to your saved templates
   - See recognition results with confidence scores
   - Execute associated commands

### Advanced Features

#### Confidence Adjustment

- **Hand Detection**: Adjust sensitivity for hand detection
- **Gesture Recognition**: Set threshold for template matching
- Real-time updates without restart required

#### Template Management

- View all saved gestures in the Library panel
- Delete unwanted templates
- Templates persist between sessions
- Export/import capabilities (planned)

#### Performance Monitoring

- Real-time FPS display
- Connection status indicators
- Frame processing statistics
- Detection confidence tracking

### Tips for Best Results

#### Recording Quality Gestures

- Use good lighting conditions
- Keep hand clearly visible to camera
- Draw gestures at moderate speed
- Make distinct, repeatable movements
- Avoid background clutter

#### Recognition Accuracy

- Create templates with consistent movements
- Use unique gesture shapes
- Avoid overly similar gestures
- Adjust confidence thresholds if needed
- Record multiple templates for variations

## 🔧 Configuration

### Performance Settings

#### Frame Processing (Backend)

```python
# In main.py
DETECTION_FPS = 25  # Inference frequency
INFERENCE_SIZE = 240  # Resolution for ML processing
JPEG_QUALITY = 0.75  # Stream compression
SKIP_FRAMES = 2  # Process every 3rd frame
```

#### Recognition Sensitivity

```python
# Default confidence thresholds
HAND_DETECTION_CONFIDENCE = 0.5  # Hand detection sensitivity
GESTURE_RECOGNITION_CONFIDENCE = 0.6  # Template matching threshold
AUTO_START_DELAY = 1.0  # Seconds before auto-start
```

### UI Customization

#### Theme Configuration

- Light/Dark mode toggle in top bar
- Automatic system theme detection
- Persistent theme preferences

#### Visual Settings

```typescript
// Adjustable in UI
trajectoryColor: string; // Gesture trail color
boundingBoxStyle: object; // Hand detection visualization
confidenceDisplay: boolean; // Show confidence scores
```

## 🔍 API Reference

### WebSocket Endpoints

#### `/ws/frames` - Camera Stream

**Purpose**: Real-time camera frame processing and hand detection

**Client → Server Messages**:

```json
{
  "type": "frame",
  "frame": "data:image/jpeg;base64,/9j/4AAQ..."
}

{
  "type": "update_confidence",
  "hand_detection_confidence": 0.5,
  "gesture_recognition_confidence": 0.6
}
```

**Server → Client Messages**:

```json
{
  "type": "detection",
  "detection": {
    "x": 320.5,
    "y": 240.3,
    "width": 80.2,
    "height": 75.8,
    "confidence": 0.87,
    "class": "hand"
  },
  "timestamp": 1699123456.789
}

{
  "type": "connection_established",
  "message": "Camera stream ready",
  "current_hand_confidence": 0.5,
  "current_gesture_confidence": 0.6
}
```

#### `/ws/gestures` - Gesture Recognition

**Purpose**: Template management and gesture recognition

**Client → Server Messages**:

```json
{
  "type": "recognize_gesture",
  "trajectory": [
    {"x": 0.1, "y": 0.2},
    {"x": 0.15, "y": 0.25},
    ...
  ],
  "confidence_threshold": 0.6,
  "templates": [
    {
      "name": "Circle",
      "command": "open browser",
      "trajectory": [...]
    }
  ]
}

{
  "type": "start_tracking",
  "message": "Begin hand tracking"
}

{
  "type": "stop_tracking",
  "message": "Stop hand tracking"
}
```

**Server → Client Messages**:

```json
{
  "type": "gesture_recognized",
  "template_name": "Circle",
  "similarity": 0.85,
  "command": "open browser"
}

{
  "type": "gesture_not_recognized",
  "message": "No matching gesture found"
}
```

### REST Endpoints

#### `GET /health`

**Purpose**: Health check and system status

**Response**:

```json
{
  "status": "healthy",
  "camera_active": true,
  "tracking_enabled": true,
  "frame_count": 1234,
  "detection_count": 567,
  "inference_available": true,
  "model_loaded": true
}
```

#### `GET /video_feed`

**Purpose**: MJPEG video stream (legacy, not used in current version)

**Response**: Multipart MJPEG stream

## 🏗️ Development

### Project Structure

```
aircut/
├── desktop/                    # Tauri desktop application
│   ├── src/                   # React TypeScript source
│   │   ├── components/        # React components
│   │   │   ├── VideoFeed.tsx  # Camera and visualization
│   │   │   └── ui/           # UI component library
│   │   ├── services/         # Business logic
│   │   │   └── frameStreamService.ts
│   │   ├── stores/           # State management
│   │   │   └── appStore.ts   # Zustand store
│   │   ├── hooks/            # Custom React hooks
│   │   └── App.tsx           # Main application
│   ├── src-tauri/            # Rust backend for Tauri
│   │   ├── src/main.rs       # Tauri main process
│   │   └── Cargo.toml        # Rust dependencies
│   ├── package.json          # Node.js dependencies
│   └── tauri.conf.json       # Tauri configuration
├── backend/                   # Python FastAPI server
│   ├── main.py               # Main server application
│   ├── requirements.txt      # Python dependencies
│   └── .env                  # Environment variables
├── README.md                 # This documentation
└── .gitignore               # Git ignore rules
```

### Development Commands

#### Frontend Development

```bash
# Start development server
npm run tauri dev

# Build for production
npm run tauri build

# Run tests
npm run test

# Lint code
npm run lint

# Format code
npm run format
```

#### Backend Development

```bash
# Start development server with auto-reload
python3.11 main.py

# Run with uvicorn directly
uvicorn main:app --host 127.0.0.1 --port 8000 --reload

```

### Adding New Features

#### Creating New Gesture Templates

1. Record gesture using the UI
2. Templates are stored in browser localStorage
3. Access via `useAppStore().templates`

#### Extending Recognition Algorithm

1. Modify `SimpleGestureRecognizer` class in `main.py`
2. Implement new similarity calculation methods
3. Add configuration options for new parameters

#### Adding UI Components

1. Create new component in `desktop/src/components/`
2. Follow existing component patterns
3. Use Tailwind CSS for styling
4. Integrate with Zustand store for state

### Code Style Guidelines

#### TypeScript/React

- Use functional components with hooks
- Implement proper TypeScript types
- Follow React best practices
- Use Tailwind for styling

#### Python

- Follow PEP 8 style guide
- Use type hints where appropriate
- Implement proper error handling
- Write docstrings for functions

## 🐛 Troubleshooting

### Common Issues

#### 🔴 Camera Not Working

**Symptoms**: Black screen, "Camera not available" message
**Solutions**:

1. Check camera permissions in system settings
2. Close other applications using the camera
3. Try different camera index (if multiple cameras)
4. Restart the application

#### 🔴 Backend Connection Failed

**Symptoms**: Red connection indicator, WebSocket errors
**Solutions**:

1. Verify backend server is running on port 8000
2. Check that both WebSocket endpoints (/ws/frames and /ws/gestures) are available
3. Check firewall settings
4. Ensure no other service is using port 8000
5. Restart backend server

#### 🔴 No Hand Detection

**Symptoms**: No bounding boxes around hands
**Solutions**:

1. Verify Roboflow API key is correct
2. Check that the Camera Stream WebSocket (/ws/frames) is connected
3. Check internet connection for API calls
4. Improve lighting conditions
5. Lower hand detection confidence threshold
6. Ensure hand is clearly visible to camera

#### 🔴 Poor Recognition Accuracy

**Symptoms**: Gestures not recognized or wrong matches
**Solutions**:

1. Verify that the Gesture WebSocket (/ws/gestures) is connected
2. Record more distinct gesture templates
3. Adjust gesture recognition confidence
4. Ensure consistent gesture recording
5. Avoid overly similar gesture shapes
6. Re-record templates with better technique

#### 🔴 Performance Issues

**Symptoms**: Low FPS, lag, high CPU usage
**Solutions**:

1. Close unnecessary applications
2. Reduce video resolution in camera settings
3. Increase frame skip rate in configuration
4. Use GPU-accelerated inference if available
5. Check system resource usage

### Debug Information

#### Logging Levels

```python
# Backend logging configuration
logging.basicConfig(level=logging.INFO)  # Change to DEBUG for verbose output
```

#### Performance Monitoring

- Frame processing statistics in `/health` endpoint
- Real-time FPS display in UI
- WebSocket connection status indicators
- Detection confidence tracking

#### Browser Developer Tools

1. Open browser developer tools (F12)
2. Check Console tab for JavaScript errors
3. Monitor Network tab for WebSocket connections
4. Use Performance tab for profiling

### Getting Help

#### Community Support

- GitHub Issues: Report bugs and request features
- Discussions: Ask questions and share tips
- Wiki: Extended documentation and tutorials

#### Development Support

- Code review guidelines in CONTRIBUTING.md
- Development setup instructions
- API documentation and examples

## 🚀 Building for Production

### Frontend Build

```bash
# Build Tauri application
npm run tauri build

# Output locations:
# - Windows: target/release/bundle/msi/
# - macOS: target/release/bundle/dmg/
# - Linux: target/release/bundle/deb/ or target/release/bundle/rpm/
```

### Backend Deployment

#### Option 1: Standalone Python

```bash
# Install production dependencies
pip install -r requirements.txt

# Run with production server
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 1
```

#### Option 2: Docker Container

```dockerfile
FROM python:3.11

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .
EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### Distribution

#### Desktop App Installer

- Tauri automatically generates platform-specific installers
- Code signing certificates recommended for distribution
- App store submission guidelines available

#### System Requirements Document

Include with distribution:

- Minimum system requirements
- Installation instructions
- Camera permission setup
- Roboflow API setup guide

## 🤝 Contributing

We welcome contributions to AirCut! Here's how to get started:

### Development Setup

1. Fork the repository
2. Clone your fork locally
3. Follow the installation instructions
4. Create a feature branch
5. Make your changes
6. Test thoroughly
7. Submit a pull request

### Contribution Guidelines

- Follow existing code style and patterns
- Add tests for new functionality
- Update documentation as needed
- Use clear commit messages
- Ensure all tests pass

### Areas for Contribution

- New gesture recognition algorithms
- Additional UI features and improvements
- Performance optimizations
- Platform-specific enhancements
- Documentation improvements
- Bug fixes and testing

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **Roboflow** - Computer vision platform and API
- **Tauri Team** - Desktop application framework
- **OpenCV** - Computer vision library
- **FastAPI** - High-performance web framework
- **React Team** - UI library and ecosystem

## 📧 Contact

- **Project Repository**: [GitHub](https://github.com/yourusername/aircut)
- **Issues & Bug Reports**: [GitHub Issues](https://github.com/yourusername/aircut/issues)
- **Feature Requests**: [GitHub Discussions](https://github.com/yourusername/aircut/discussions)

---

**Built with ❤️ for intuitive human-computer interaction**
