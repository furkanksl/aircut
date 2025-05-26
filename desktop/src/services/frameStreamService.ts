import { EventEmitter } from "events";

interface FrameStreamConfig {
  serverUrl: string;
  width?: number;
  height?: number;
  frameRate?: number;
  quality?: number;
}

export class FrameStreamService extends EventEmitter {
  private videoStream: MediaStream | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private context: CanvasRenderingContext2D | null = null;
  private isStreaming = false;
  private isConnected = false;
  private frameInterval: number | null = null;
  private wsConnection: WebSocket | null = null;

  // Configuration
  private serverUrl: string;
  private width: number = 640;
  private height: number = 480;
  private frameRate: number = 30;
  private quality: number = 0.85; // Increased for better detection accuracy

  // Performance tracking
  private frameSkipCount: number = 0;
  private frameProcessEveryN: number = 1; // Process every frame for real-time (was 2)
  private isProcessingFrame: boolean = false;
  private lastFrameTime: number = 0;
  private backendProcessing: boolean = false; // Track if backend is currently processing
  private lastFrameSentTime: number = 0;
  private frameDropCount: number = 0;
  private backendTimeoutId: number | null = null;

  constructor(config: FrameStreamConfig) {
    super();
    this.serverUrl = config.serverUrl;
    this.width = config.width || 640;
    this.height = config.height || 480;
    this.frameRate = config.frameRate || 30; // Increased default
    this.quality = config.quality || 0.85; // Increased for better detection accuracy

    // Create canvas for frame capture
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.context = this.canvas.getContext("2d", {
      alpha: false,
      willReadFrequently: true,
      desynchronized: true, // Allow desynchronized rendering for performance
      imageSmoothingEnabled: true, // Enable smoothing for better quality
      imageSmoothingQuality: "high", // Use high quality smoothing
    }) as CanvasRenderingContext2D | null;
  }

  /**
   * Start the camera and frame streaming
   */
  public async startStream(videoElement: HTMLVideoElement): Promise<void> {
    try {
      if (this.videoStream) {
        this.stopStream();
      }

      // Request camera with optimized settings for high-quality streaming
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: this.width, min: this.width },
          height: { ideal: this.height, min: this.height },
          frameRate: { ideal: this.frameRate },
          facingMode: "user",
          // Additional quality settings for better detection
          aspectRatio: { ideal: this.width / this.height },
        },
        audio: false,
      });

      // Mirror the video display
      videoElement.style.transform = "scaleX(-1)";
      videoElement.srcObject = stream;

      // Wait for video to be ready
      await new Promise<void>((resolve, reject) => {
        videoElement.onloadedmetadata = () => resolve();
        videoElement.onerror = (error) => reject(error);

        if (videoElement.readyState >= 2) {
          resolve();
        }
      });

      this.videoStream = stream;
      this.videoElement = videoElement;

      // Emit camera ready event
      this.emit("camera-status", "ready");

      // Connect to backend WebSocket
      await this.connectToBackend();

      return Promise.resolve();
    } catch (error) {
      console.error("Failed to start camera stream:", error);
      this.emit("camera-status", "error", error);
      return Promise.reject(error);
    }
  }

  /**
   * Stop the streaming and release resources
   */
  public stopStream(): void {
    // Stop frame capture
    if (this.frameInterval) {
      clearInterval(this.frameInterval);
      this.frameInterval = null;
    }

    // Close WebSocket connection
    if (this.wsConnection) {
      this.wsConnection.close();
      this.wsConnection = null;
    }

    // Stop camera tracks
    if (this.videoStream) {
      this.videoStream.getTracks().forEach((track) => track.stop());
      this.videoStream = null;
    }

    if (this.videoElement) {
      this.videoElement.srcObject = null;
      this.videoElement = null;
    }

    this.isStreaming = false;
    this.isConnected = false;
    this.emit("camera-status", "stopped");
  }

  /**
   * Connect to the backend WebSocket for frame streaming
   */
  private async connectToBackend(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const wsUrl = `ws://${this.serverUrl.replace(
          /^https?:\/\//,
          ""
        )}/ws/frames`;
        this.wsConnection = new WebSocket(wsUrl);

        this.wsConnection.onopen = () => {
          console.log("Frame streaming WebSocket connected");
          this.isConnected = true;
          this.startFrameCapture();
          this.emit("connection-status", "connected");
          resolve();
        };

        this.wsConnection.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            console.log("Received WebSocket message:", data.type);

            if (data.type === "detection") {
              // Backend finished processing - mark as available for next frame
              this.backendProcessing = false;
              if (this.backendTimeoutId) {
                clearTimeout(this.backendTimeoutId);
                this.backendTimeoutId = null;
              }

              if (
                data.detection &&
                data.detection.confidence > 0.5 &&
                (data.detection.class === "hand" ||
                  data.detection.class === "finger")
              ) {
                // Valid hand detection
                console.log(
                  "🎯 FrameStreamService: Emitting valid detection",
                  data.detection
                );
                this.emit("detection", data.detection);
              } else {
                // Clear detection data when no valid hand is detected
                console.log(
                  "🎯 FrameStreamService: Emitting null detection (filtered out)"
                );
                this.emit("detection", null);
              }
            } else if (data.type === "tracking_started") {
              this.emit("tracking", "started");
            } else if (data.type === "tracking_stopped") {
              this.emit("tracking", "stopped");
              // Also clear detection when tracking stops
              this.emit("detection", null);
            } else if (data.type === "frame_received") {
              // Backend acknowledged frame receipt - mark as processing
              console.log("Frame acknowledged by backend");
              this.backendProcessing = true;
            } else if (
              data.type === "frame_processed" ||
              data.type === "no_detection"
            ) {
              // Backend finished processing frame (alternative response types)
              this.backendProcessing = false;
              if (this.backendTimeoutId) {
                clearTimeout(this.backendTimeoutId);
                this.backendTimeoutId = null;
              }
            } else if (data.type === "error") {
              console.error("Backend error:", data.message);
              this.emit("stream-error", data.message);
              this.backendProcessing = false; // Reset on error
              if (this.backendTimeoutId) {
                clearTimeout(this.backendTimeoutId);
                this.backendTimeoutId = null;
              }
            }
          } catch (e) {
            console.error("Invalid WebSocket message:", e);
            this.backendProcessing = false; // Reset on parse error
            if (this.backendTimeoutId) {
              clearTimeout(this.backendTimeoutId);
              this.backendTimeoutId = null;
            }
          }
        };

        this.wsConnection.onerror = (error) => {
          console.error("WebSocket error:", error);
          this.emit("stream-error", "WebSocket connection error");
          reject(error);
        };

        this.wsConnection.onclose = () => {
          console.log("Frame streaming WebSocket disconnected");
          this.isConnected = false;
          this.isStreaming = false;
          this.emit("connection-status", "disconnected");
        };
      } catch (error) {
        console.error("Failed to connect to backend:", error);
        reject(error);
      }
    });
  }

  /**
   * Start capturing and sending frames to backend
   */
  private startFrameCapture(): void {
    if (!this.videoElement || !this.context || !this.canvas) {
      return;
    }

    this.isStreaming = true;

    // Use requestAnimationFrame for smooth frame capture
    const captureFrame = () => {
      if (!this.isStreaming || !this.isConnected) {
        return;
      }

      const now = performance.now();
      const frameInterval = 1000 / this.frameRate;

      // More aggressive timing for real-time performance
      if (now - this.lastFrameTime < frameInterval * 0.8) {
        // Reduced threshold
        requestAnimationFrame(captureFrame);
        return;
      }

      this.frameSkipCount++;

      // Process every frame for real-time detection
      if (
        this.frameSkipCount >= this.frameProcessEveryN &&
        !this.isProcessingFrame
      ) {
        this.frameSkipCount = 0;
        this.lastFrameTime = now;
        this.captureAndSendFrame();
      }

      requestAnimationFrame(captureFrame);
    };

    requestAnimationFrame(captureFrame);
  }

  /**
   * Capture current frame and send to backend
   */
  private async captureAndSendFrame(): Promise<void> {
    if (
      !this.videoElement ||
      !this.context ||
      !this.canvas ||
      !this.wsConnection ||
      this.isProcessingFrame
    ) {
      return;
    }

    // More lenient frame dropping - only skip if backend has been busy for too long
    const now = performance.now();
    if (this.backendProcessing && now - this.lastFrameSentTime < 500) {
      // Only wait 500ms max
      this.frameDropCount++;
      if (this.frameDropCount % 10 === 0) {
        // Log every 10th drop
        console.log(
          `Dropping frame - backend busy (dropped: ${this.frameDropCount})`
        );
      }
      return;
    }

    // Reset if backend has been busy too long (failsafe)
    if (this.backendProcessing && now - this.lastFrameSentTime > 500) {
      console.log("Backend timeout - resetting processing state");
      this.backendProcessing = false;
    }

    const video = this.videoElement;

    if (video.readyState < 2) {
      return; // Video not ready
    }

    this.isProcessingFrame = true;
    const frameStartTime = performance.now();

    try {
      // Clear canvas and draw current video frame with high quality
      this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);

      // Set high quality rendering
      this.context.imageSmoothingEnabled = true;
      this.context.imageSmoothingQuality = "high";

      // Mirror the frame to match display
      this.context.save();
      this.context.translate(this.canvas.width, 0);
      this.context.scale(-1, 1);
      this.context.drawImage(
        video,
        0,
        0,
        this.canvas.width,
        this.canvas.height
      );
      this.context.restore();

      // Convert to blob with high quality JPEG compression (0.85 quality)
      const blob = await new Promise<Blob | null>((resolve) => {
        this.canvas!.toBlob(resolve, "image/jpeg", this.quality);
      });

      if (
        blob &&
        this.wsConnection &&
        this.wsConnection.readyState === WebSocket.OPEN
      ) {
        // Convert blob to base64 for WebSocket transmission
        const reader = new FileReader();
        reader.onload = () => {
          if (
            this.wsConnection &&
            this.wsConnection.readyState === WebSocket.OPEN
          ) {
            const base64 = (reader.result as string).split(",")[1];
            this.wsConnection.send(
              JSON.stringify({
                type: "frame",
                data: base64,
                timestamp: Date.now(),
                width: this.canvas!.width,
                height: this.canvas!.height,
                realtime: true, // Flag for backend to prioritize
              })
            );
            this.lastFrameSentTime = performance.now();
            this.backendProcessing = true; // Mark as sent

            // Set timeout to reset processing state (failsafe)
            if (this.backendTimeoutId) {
              clearTimeout(this.backendTimeoutId);
            }
            this.backendTimeoutId = setTimeout(() => {
              console.log("Backend processing timeout - resetting state");
              this.backendProcessing = false;
            }, 1000); // 1 second timeout
          }
        };
        reader.readAsDataURL(blob);
      }

      const processingTime = performance.now() - frameStartTime;
      if (processingTime > 16) {
        // More than 60fps
        console.log(`Frame processing took ${processingTime.toFixed(1)}ms`);
      }
    } catch (error) {
      console.error("Error capturing frame:", error);
      this.backendProcessing = false; // Reset on error
    } finally {
      this.isProcessingFrame = false;
    }
  }

  /**
   * Start hand tracking
   */
  public startTracking(): void {
    if (this.wsConnection && this.wsConnection.readyState === WebSocket.OPEN) {
      this.wsConnection.send(
        JSON.stringify({
          type: "start_tracking",
        })
      );
      this.emit("tracking", "started");
    }
  }

  /**
   * Stop hand tracking
   */
  public stopTracking(): void {
    if (this.wsConnection && this.wsConnection.readyState === WebSocket.OPEN) {
      this.wsConnection.send(
        JSON.stringify({
          type: "stop_tracking",
        })
      );
      this.emit("tracking", "stopped");
    }
  }

  /**
   * Set frame quality and performance parameters
   */
  public setStreamSettings(
    width: number,
    height: number,
    frameRate: number,
    quality: number,
    frameSkip: number = 2
  ): void {
    this.width = width;
    this.height = height;
    this.frameRate = frameRate;
    this.quality = quality;
    this.frameProcessEveryN = frameSkip;

    // Update canvas size
    if (this.canvas) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  /**
   * Get current streaming status
   */
  public getStatus() {
    return {
      isStreaming: this.isStreaming,
      isConnected: this.isConnected,
      frameRate: this.frameRate,
      resolution: `${this.width}x${this.height}`,
      quality: this.quality,
      backendProcessing: this.backendProcessing,
      framesDropped: this.frameDropCount,
    };
  }

  /**
   * Get performance statistics
   */
  public getPerformanceStats() {
    const now = performance.now();
    const timeSinceLastFrame = now - this.lastFrameSentTime;

    return {
      backendBusy: this.backendProcessing,
      framesDropped: this.frameDropCount,
      timeSinceLastFrame: timeSinceLastFrame,
      avgLatency:
        timeSinceLastFrame > 0 ? timeSinceLastFrame.toFixed(1) + "ms" : "N/A",
      isRealTime: timeSinceLastFrame < 100, // Consider real-time if < 100ms
    };
  }

  /**
   * Reset performance counters
   */
  public resetPerformanceStats(): void {
    this.frameDropCount = 0;
    this.lastFrameSentTime = 0;
    this.backendProcessing = false;
    console.log("Performance stats reset");
  }

  /**
   * Get the current media stream if available
   */
  public getMediaStream(): MediaStream | null {
    return this.videoStream;
  }

  /**
   * Optimize settings for real-time performance while maintaining detection quality
   */
  public optimizeForRealTime(): void {
    console.log("Optimizing frameStreamService for real-time performance");
    this.frameRate = 30;
    this.quality = 0.75; // Balanced quality for good detection while maintaining speed
    this.frameProcessEveryN = 1; // Process every frame

    // Update canvas if it exists
    if (this.canvas) {
      // Keep same resolution but optimize context
      this.context = this.canvas.getContext("2d", {
        alpha: false,
        willReadFrequently: true,
        desynchronized: true, // Allow desynchronized rendering for performance
        imageSmoothingEnabled: true, // Keep smoothing for quality
        imageSmoothingQuality: "high", // Maintain high quality
      }) as CanvasRenderingContext2D | null;
    }

    console.log(
      `Real-time settings: ${this.frameRate}fps, quality=${this.quality}, processEvery=${this.frameProcessEveryN}`
    );
  }

  /**
   * Upgrade to higher resolution for maximum detection accuracy
   */
  public upgradeToHighResolution(): void {
    console.log("Upgrading to high resolution for maximum detection accuracy");
    this.width = 800;
    this.height = 600;
    this.quality = 0.9; // Maximum quality

    // Update canvas size
    if (this.canvas) {
      this.canvas.width = this.width;
      this.canvas.height = this.height;
    }

    console.log(
      `High-res settings: ${this.width}x${this.height}, quality=${this.quality}`
    );
  }
}

// Export singleton instance
export const frameStreamService = new FrameStreamService({
  serverUrl: "127.0.0.1:8000",
  width: 640,
  height: 480,
  frameRate: 30,
  quality: 0.85, // Increased from 0.5 to 0.85 for better detection accuracy
});
