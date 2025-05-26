import asyncio
import base64
import cv2
import json
import logging
import os
import threading
import time
from typing import Dict, List, Optional, Any
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from collections import deque
import warnings
import numpy as np

# Load environment variables
load_dotenv()

# Import inference for direct model usage
try:
    from inference import get_model
    INFERENCE_AVAILABLE = True
except ImportError:
    INFERENCE_AVAILABLE = False
    logging.warning("Inference library not available. Install with: pip install inference")

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="AirCut Backend", version="1.0.0")

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuration
ROBOFLOW_API_KEY = os.getenv("ROBOFLOW_API_KEY", "")
ROBOFLOW_MODEL_ID = os.getenv("ROBOFLOW_MODEL_ID", "handdetection-qycc7/1")
CONFIDENCE_THRESHOLD = float(os.getenv("CONFIDENCE_THRESHOLD", "0.2"))  # Lowered from 0.3 for better detection

# Global variables for camera management and detection confidence
camera_manager = None
current_hand_detection_confidence = 0.75
current_gesture_recognition_confidence = 0.85

class SimpleGestureRecognizer:
    def __init__(self):
        self.templates = {}
    
    def add_template(self, template_id: str, name: str, trajectory: list):
        """Add a template for recognition"""
        # Normalize the trajectory to 0-1 range for consistent comparison
        normalized_trajectory = self.normalize_trajectory(trajectory)
        self.templates[template_id] = {
            "id": template_id,
            "name": name,
            "trajectory": normalized_trajectory,
            "point_count": len(normalized_trajectory)
        }
        logger.info(f"📚 Added template '{name}' with {len(normalized_trajectory)} points")
        return True
    
    def normalize_trajectory(self, trajectory: list) -> list:
        """Normalize trajectory points to 0-1 range"""
        if len(trajectory) < 2:
            return trajectory
            
        # Convert to consistent format
        points = []
        for point in trajectory:
            if isinstance(point, dict):
                points.append([point.get('x', 0), point.get('y', 0)])
            elif isinstance(point, (list, tuple)) and len(point) >= 2:
                points.append([float(point[0]), float(point[1])])
            else:
                continue
        
        if len(points) < 2:
            return points
        
        # Find bounds
        xs = [p[0] for p in points]
        ys = [p[1] for p in points]
        min_x, max_x = min(xs), max(xs)
        min_y, max_y = min(ys), max(ys)
        
        # Normalize to 0-1 range
        width = max_x - min_x if max_x > min_x else 1
        height = max_y - min_y if max_y > min_y else 1
        
        normalized = []
        for x, y in points:
            norm_x = (x - min_x) / width
            norm_y = (y - min_y) / height
            normalized.append([norm_x, norm_y])
        
        return normalized
    
    def recognize_gesture(self, trajectory: list, confidence_threshold: float = 0.6):
        """Recognize a gesture by comparing against templates"""
        if len(trajectory) < 2:
            return None
        
        if not self.templates:
            return None
        
        # Normalize input trajectory
        normalized_input = self.normalize_trajectory(trajectory)
        if len(normalized_input) < 2:
            return None
        
        best_match = None
        best_similarity = 0.0
        
        logger.info(f"🔍 Recognizing gesture with {len(normalized_input)} points against {len(self.templates)} templates")
        
        for template_id, template in self.templates.items():
            similarity = self.calculate_similarity(normalized_input, template["trajectory"])
            logger.info(f"  📊 Template '{template['name']}': similarity = {similarity:.3f}")
            
            if similarity > best_similarity and similarity >= confidence_threshold:
                best_similarity = similarity
                best_match = {
                    "template_id": template_id,
                    "name": template["name"],
                    "similarity": similarity,
                    "confidence": similarity
                }
        
        if best_match:
            logger.info(f"✅ Gesture recognized: '{best_match['name']}' with {best_match['similarity']:.3f} confidence")
        else:
            logger.info(f"❌ No gesture recognized (best similarity: {best_similarity:.3f}, threshold: {confidence_threshold})")
        
        return best_match
    
    def calculate_similarity(self, trajectory1: list, trajectory2: list) -> float:
        """Calculate similarity between two normalized trajectories using DTW-like approach"""
        if not trajectory1 or not trajectory2:
            return 0.0
        
        # Simple point-to-point distance comparison with resampling
        # Resample both trajectories to same number of points for comparison
        target_points = min(50, max(len(trajectory1), len(trajectory2)))  # Cap at 50 points
        
        resampled1 = self.resample_trajectory(trajectory1, target_points)
        resampled2 = self.resample_trajectory(trajectory2, target_points)
        
        # Calculate average point-to-point distance
        total_distance = 0.0
        for i in range(len(resampled1)):
            dx = resampled1[i][0] - resampled2[i][0]
            dy = resampled1[i][1] - resampled2[i][1]
            distance = (dx * dx + dy * dy) ** 0.5
            total_distance += distance
        
        avg_distance = total_distance / len(resampled1)
        
        # Convert distance to similarity (0-1 range, 1 = identical)
        # Max expected distance between normalized points is sqrt(2)
        max_distance = 1.414  # sqrt(2)
        similarity = max(0.0, 1.0 - (avg_distance / max_distance))
        
        return similarity
    
    def resample_trajectory(self, trajectory: list, target_count: int) -> list:
        """Resample trajectory to have exactly target_count points"""
        if len(trajectory) <= 1 or target_count <= 1:
            return trajectory
        
        if len(trajectory) == target_count:
            return trajectory
        
        # Calculate total path length
        total_length = 0.0
        for i in range(1, len(trajectory)):
            dx = trajectory[i][0] - trajectory[i-1][0]
            dy = trajectory[i][1] - trajectory[i-1][1]
            total_length += (dx * dx + dy * dy) ** 0.5
        
        if total_length == 0:
            return trajectory
        
        # Resample at equal intervals along the path
        resampled = [trajectory[0]]  # Start with first point
        target_distance = total_length / (target_count - 1)
        
        current_distance = 0.0
        current_point_idx = 0
        
        for i in range(1, target_count - 1):
            target_total_distance = i * target_distance
            
            # Find the segment that contains this distance
            while current_distance < target_total_distance and current_point_idx < len(trajectory) - 1:
                dx = trajectory[current_point_idx + 1][0] - trajectory[current_point_idx][0]
                dy = trajectory[current_point_idx + 1][1] - trajectory[current_point_idx][1]
                segment_length = (dx * dx + dy * dy) ** 0.5
                
                if current_distance + segment_length >= target_total_distance:
                    # Interpolate within this segment
                    remaining_distance = target_total_distance - current_distance
                    if segment_length > 0:
                        ratio = remaining_distance / segment_length
                        new_x = trajectory[current_point_idx][0] + dx * ratio
                        new_y = trajectory[current_point_idx][1] + dy * ratio
                        resampled.append([new_x, new_y])
                    else:
                        resampled.append(trajectory[current_point_idx])
                    break
                else:
                    current_distance += segment_length
                    current_point_idx += 1
        
        resampled.append(trajectory[-1])  # End with last point
        return resampled

# Initialize gesture recognizer (for creating temporary recognizers during recognition)
gesture_recognizer = SimpleGestureRecognizer()

class HighPerformanceCameraManager:
    def __init__(self):
        self.model = None
        self.is_active = True
        self.tracking_enabled = True  # Enable tracking by default
        
        # Performance tracking
        self.frame_count = 0
        self.detection_count = 0
        self.fps_start_time = time.time()
        self.detection_times = deque(maxlen=30)
        
        # Current state
        self.current_detections = []  # Store current detections for background processing
        self.frame_lock = threading.RLock()
        
        # Frame quality settings
        self.detection_frame_size = 320  # Inference size for speed
        
        # Initialize inference model
        self.initialize_model()
    
    def initialize_model(self):
        """Initialize inference model if available"""
        if INFERENCE_AVAILABLE and ROBOFLOW_API_KEY:
            try:
                self.model = get_model(model_id=ROBOFLOW_MODEL_ID, api_key=ROBOFLOW_API_KEY)
                logger.info(f"✅ Direct inference model loaded: {ROBOFLOW_MODEL_ID}")
            except Exception as e:
                logger.error(f"Failed to load inference model: {e}")
                self.model = None
    
    def process_frame(self, frame, confidence_threshold):
        """Process a frame received from frontend"""
        if not self.tracking_enabled or self.model is None or frame is None:
            return None
            
        with self.frame_lock:
            self.frame_count += 1
            start_time = time.time()
            
            # Resize frame for faster detection
            height, width = frame.shape[:2]
            detection_frame = cv2.resize(frame, (self.detection_frame_size, self.detection_frame_size))
            
            try:
                # Direct inference
                results = self.model.infer(detection_frame, confidence=confidence_threshold)
                
                # Process results
                if results and len(results) > 0:
                    result = results[0]
                    predictions = getattr(result, 'predictions', [])
                    
                    # Find best detection
                    if predictions:
                        best_detection = max(predictions, key=lambda x: x.confidence)
                        
                        if best_detection.confidence > confidence_threshold:
                            # Scale coordinates back to original frame size
                            scale_x = width / self.detection_frame_size
                            scale_y = height / self.detection_frame_size
                            
                            detection = {
                                'x': float(best_detection.x * scale_x),
                                'y': float(best_detection.y * scale_y),
                                'width': float(best_detection.width * scale_x),
                                'height': float(best_detection.height * scale_y),
                                'confidence': float(best_detection.confidence),
                                'class': getattr(best_detection, 'class_name', 'hand')
                            }
                            
                            # Store detection for background processing
                            self.current_detections = [detection]
                            self.detection_count += 1
                            
                            # Track performance
                            detection_time = time.time() - start_time
                            self.detection_times.append(detection_time)
                            
                            # Performance logging
                            if self.detection_count % 60 == 0:  # Every 60 detections
                                current_time = time.time()
                                elapsed = current_time - self.fps_start_time
                                if elapsed > 0:
                                    detection_fps = len(self.detection_times) / elapsed
                                    avg_detection_time = sum(self.detection_times) / len(self.detection_times)
                                    logger.info(f"📊 Detection FPS: {detection_fps:.1f}, Avg time: {avg_detection_time:.3f}s")
                                    
                                    self.fps_start_time = current_time
                                    self.detection_times.clear()
                            
                            return detection
                
            except Exception as e:
                logger.error(f"Detection error: {e}")
            
            return None
    
    def _draw_detections_fast(self, frame, detections):
        """Ultra-fast detection drawing"""
        for detection in detections:
            x = detection['x']
            y = detection['y']
            w = detection['width']
            h = detection['height']
            confidence = detection.get('confidence', 0)
            
            # Calculate bounding box coordinates
            x1 = max(0, int(x - w/2))
            y1 = max(0, int(y - h/2))
            x2 = min(frame.shape[1], int(x + w/2))
            y2 = min(frame.shape[0], int(y + h/2))
            
            # Color based on confidence
            if confidence > 0.7:
                color = (0, 255, 0)  # Green
            elif confidence > 0.5:
                color = (0, 255, 255)  # Yellow
            else:
                color = (0, 165, 255)  # Orange
            
            # Draw bounding box - optimized thickness
            cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
            
            # Draw confidence - minimal text
            label = f"{confidence:.2f}"
            cv2.putText(frame, label, (x1, y1-5), cv2.FONT_HERSHEY_SIMPLEX, 0.4, color, 1)
            
        return frame
        
    def release(self):
        """Release resources"""
        self.is_active = False
        self.model = None

# Global camera manager
camera_manager = HighPerformanceCameraManager()

@app.on_event("startup")
async def startup_event():
    """Initialize model on startup"""
    camera_manager.initialize_model()

@app.on_event("shutdown")
async def shutdown_event():
    """Clean up on shutdown"""
    camera_manager.release()

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "tracking_enabled": camera_manager.tracking_enabled,
        "frames_processed": camera_manager.frame_count,
        "detections_made": camera_manager.detection_count,
        "inference_available": INFERENCE_AVAILABLE,
        "model_loaded": camera_manager.model is not None
    }

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for real-time communication"""
    await websocket.accept()
    logger.info("WebSocket connection established")
    
    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            
            message_type = message.get("message_type") or message.get("type")  # Support both formats
            logger.info(f"Received message: {message_type}")
            
            if message_type == "ping":
                # Handle ping/keepalive messages
                await websocket.send_text(json.dumps({
                    "type": "pong",
                    "timestamp": time.time()
                }))
                continue
                
            elif message_type == "start_tracking":
                camera_manager.tracking_enabled = True
                await websocket.send_text(json.dumps({
                    "status": "success",
                    "message": "Tracking started"
                }))
                
            elif message_type == "stop_tracking":
                camera_manager.tracking_enabled = False
                with camera_manager.frame_lock:
                    camera_manager.current_detections = []
                await websocket.send_text(json.dumps({
                    "status": "success",
                    "message": "Tracking stopped"
                }))
            
            elif message_type == "save_template":
                # Template saving is now handled client-side only - no backend storage
                await websocket.send_text(json.dumps({
                    "type": "info",
                    "message": "Templates are now stored client-side only. Backend operates stateless."
                }))
                
            elif message_type == "recognize_gesture":
                # Handle gesture recognition from frontend with stateless processing
                try:
                    trajectory = message.get("trajectory", [])
                    confidence_threshold = message.get("confidence_threshold", current_gesture_recognition_confidence)
                    templates = message.get("templates", [])  # Templates sent with request
                    
                    if len(trajectory) < 2:
                        await websocket.send_text(json.dumps({
                            "type": "gesture_not_recognized",
                            "message": "Trajectory must have at least 2 points"
                        }))
                        continue
                    
                    if not templates:
                        await websocket.send_text(json.dumps({
                            "type": "gesture_not_recognized", 
                            "message": "No templates provided for recognition"
                        }))
                        continue
                    
                    logger.info(f"🎯 Stateless gesture recognition: {len(trajectory)} points, {len(templates)} templates (confidence: {confidence_threshold:.2f})")
                    
                    # Create a temporary recognizer with the provided templates
                    temp_recognizer = SimpleGestureRecognizer()
                    for i, template in enumerate(templates):
                        template_id = f"temp_{i}_{template.get('name', 'unknown')}"
                        template_name = template.get("name", "unknown")
                        template_trajectory = template.get("trajectory", [])
                        
                        logger.info(f"  📝 Loading template {i+1}: '{template_name}' with {len(template_trajectory)} points")
                        temp_recognizer.add_template(
                            template_id,
                            template_name, 
                            template_trajectory
                        )
                    
                    logger.info(f"🔧 Temporary recognizer created with {len(temp_recognizer.templates)} templates")
                    
                    # Try to recognize the gesture using temporary recognizer
                    recognition_result = temp_recognizer.recognize_gesture(trajectory, confidence_threshold)
                    
                    if recognition_result:
                        # Find the matching template data for command
                        matching_template = next(
                            (t for t in templates if t.get("name") == recognition_result["name"]), 
                            {}
                        )
                        command = matching_template.get("command", "")
                        
                        logger.info(f"✅ Gesture '{recognition_result['name']}' recognized with {recognition_result['confidence']:.3f} confidence")
                        
                        await websocket.send_text(json.dumps({
                            "type": "gesture_recognized",
                            "template_name": recognition_result["name"],
                            "similarity": recognition_result["confidence"],
                            "command": command
                        }))
                    else:
                        # No gesture recognized
                        logger.info(f"❌ No gesture recognized from {len(trajectory)} point trajectory")
                        
                        await websocket.send_text(json.dumps({
                            "type": "gesture_not_recognized",
                            "message": "No matching gesture found"
                        }))
                    
                except Exception as e:
                    logger.error(f"Error during stateless gesture recognition: {e}")
                    await websocket.send_text(json.dumps({
                        "type": "error",
                        "message": f"Failed to recognize gesture: {str(e)}"
                    }))
                
            else:
                await websocket.send_text(json.dumps({
                    "status": "error",
                    "message": f"Unknown message type: {message_type}"
                }))
                
    except WebSocketDisconnect:
        logger.info("WebSocket connection closed")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")

@app.websocket("/ws/frames")
async def frame_stream_endpoint(websocket: WebSocket):
    """WebSocket endpoint for frame streaming with detection - matches Tauri app expectations"""
    await websocket.accept()
    logger.info("Frame streaming WebSocket connected")
    
    # Frame skipping for performance
    frame_skip_counter = 0
    process_every_nth_frame = 0.5  # Process every 3rd frame
    
    # Access global confidence variables
    global current_hand_detection_confidence, current_gesture_recognition_confidence
    
    try:
        # Send initial connection confirmation
        await websocket.send_text(json.dumps({
            "type": "connection_established",
            "message": "Frame streaming ready",
            "current_hand_confidence": current_hand_detection_confidence,
            "current_gesture_confidence": current_gesture_recognition_confidence
        }))
        
        # Main frame processing loop
        while True:
            try:
                # Receive frame data from client
                data = await websocket.receive_text()
                message = json.loads(data)
                
                # Handle ping messages for keepalive
                if message.get("type") == "ping":
                    await websocket.send_text(json.dumps({
                        "type": "pong",
                        "timestamp": time.time()
                    }))
                    continue
                
                # Handle refresh_detection messages from background app
                if message.get("type") == "refresh_detection":
                    force_process = message.get("force_process", False)
                    logger.info(f"🔄 Received refresh_detection request (force_process={force_process})")
                    
                    # Ensure tracking is enabled
                    if not camera_manager.tracking_enabled:
                        camera_manager.tracking_enabled = True
                        logger.info("🔄 Re-enabled tracking due to refresh request")
                    
                    # Reduce frame skipping when force processing is requested
                    if force_process:
                        process_every_nth_frame = 0.2  # Process almost every frame when in background
                        
                    # Get current detection if available
                    if camera_manager.current_detections:
                        detection = camera_manager.current_detections[0]
                        await websocket.send_text(json.dumps({
                            "type": "detection",
                            "detection": detection,
                            "timestamp": time.time(),
                            "source": "refresh_request"
                        }))
                    else:
                        # Trigger a new detection immediately
                        await websocket.send_text(json.dumps({
                            "type": "detection",
                            "detection": None,
                            "timestamp": time.time(),
                            "source": "refresh_request"
                        }))
                    continue
                
                # Handle configuration updates
                if message.get("type") == "update_confidence":
                    if "hand_detection_confidence" in message:
                        current_hand_detection_confidence = float(message["hand_detection_confidence"])
                        logger.info(f"🎯 Updated hand detection confidence: {current_hand_detection_confidence:.2f}")
                    
                    if "gesture_recognition_confidence" in message:
                        current_gesture_recognition_confidence = float(message["gesture_recognition_confidence"])
                        logger.info(f"🎯 Updated gesture recognition confidence: {current_gesture_recognition_confidence:.2f}")
                    
                    await websocket.send_text(json.dumps({
                        "type": "confidence_updated",
                        "hand_detection_confidence": current_hand_detection_confidence,
                        "gesture_recognition_confidence": current_gesture_recognition_confidence
                    }))
                    continue
                
                # Only log non-ping messages to reduce noise
                if message.get("type") != "ping":
                    logger.info(f"📨 WebSocket message received: type={message.get('type')}, tracking_enabled={camera_manager.tracking_enabled}")
                
                if message.get("type") == "frame":
                    # Initialize detection variable
                    detection = None
                    
                    # Process the frame if we have base64 data and should process this frame
                    frame_data = message.get("frame") or message.get("data")  # Check both field names
                    
                    # Frame skipping logic for performance
                    frame_skip_counter += 1
                    should_process = frame_skip_counter % process_every_nth_frame == 0
                    
                    # Acknowledge frame receipt immediately
                    await websocket.send_text(json.dumps({
                        "type": "frame_received"
                    }))
                    
                    if frame_data and camera_manager.tracking_enabled and should_process:
                        # Reduced logging for performance
                        try:
                            # Decode base64 frame
                            if ',' in frame_data:
                                frame_data = frame_data.split(',')[1]
                            frame_bytes = base64.b64decode(frame_data)
                            
                            # Convert to OpenCV format
                            nparr = np.frombuffer(frame_bytes, np.uint8)
                            frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                            
                            if frame is not None:
                                # Process the frame using our simplified manager
                                detection = camera_manager.process_frame(frame, current_hand_detection_confidence)
                                
                        except Exception as e:
                            logger.error(f"Frame processing error: {e}")
                            detection = None
                    
                    # Always send detection result (even if None)
                    await websocket.send_text(json.dumps({
                        "type": "detection",
                        "detection": detection,
                        "timestamp": time.time()
                    }))
                
                else:
                    logger.warning(f"Unknown message type: {message.get('type')}")
                
            except json.JSONDecodeError as e:
                logger.error(f"Invalid JSON received: {e}")
                await websocket.send_text(json.dumps({
                    "type": "error",
                    "message": "Invalid JSON format"
                }))
            except Exception as e:
                logger.error(f"Frame processing error: {e}")
                # Don't break the loop, just log and continue
                await websocket.send_text(json.dumps({
                    "type": "detection",
                    "detection": None,
                    "timestamp": time.time()
                }))
                
    except WebSocketDisconnect:
        logger.info("Frame streaming WebSocket disconnected")
    except Exception as e:
        logger.error(f"Frame streaming WebSocket error: {e}")

if __name__ == "__main__":
    import uvicorn
    
    # Ultra-optimized uvicorn configuration
    uvicorn.run(
        app, 
        host="127.0.0.1", 
        port=8000, 
        log_level="warning",  # Reduce logging overhead
        access_log=False,
        workers=1
    ) 