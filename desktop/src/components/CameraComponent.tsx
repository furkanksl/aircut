import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Camera,
  CameraOff,
  WifiOff,
  Target,
  Circle,
  InfoIcon,
  RotateCcw,
  Loader2,
} from "lucide-react";
import { frameStreamService } from "@/services/frameStreamService";
import { toast } from "sonner";

interface CameraComponentProps {
  isConnected: boolean;
  isTracking: boolean;
  trajectory: Array<{ x: number; y: number }>;
  onTrajectoryUpdate?: (point: { x: number; y: number }) => void;
  onReconnect?: () => void;
  lastGestureResult?: {
    name: string;
    command: string;
    similarity: number;
  } | null;
  onClearTrajectory?: () => void;
  showRecordingStatus?: boolean;
  showGestureResult?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function CameraComponent({
  isConnected,
  isTracking,
  trajectory,
  onReconnect,
  lastGestureResult = null,
  showGestureResult = true,
  className = "",
  style = {},
}: CameraComponentProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [_, setStreamingStatus] = useState<string>("disconnected");
  const [localDetection, setLocalDetection] = useState<any>(null);
  const [performanceStats, setPerformanceStats] = useState<any>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);

  // Camera management
  useEffect(() => {
    if (isConnected) {
      startStream();
    } else {
      stopStream();
    }

    return () => {
      frameStreamService.removeListener("detection", handleDetection);
      frameStreamService.removeListener("camera-status", handleCameraStatus);
      frameStreamService.removeListener("stream-error", handleStreamError);
      frameStreamService.removeListener(
        "connection-status",
        handleConnectionStatus
      );
    };
  }, [isConnected]);

  const handleDetection = (detection: any) => {
    setLocalDetection(detection);
  };

  const handleCameraStatus = (status: string, error?: any) => {
    if (status === "ready") {
      setCameraActive(true);
      setCameraError(null);
      if (videoRef.current && videoRef.current.paused) {
        videoRef.current.play().catch(console.error);
      }
    } else if (status === "error") {
      setCameraActive(false);
      setCameraError(error?.message || "Failed to access camera");
    } else if (status === "stopped") {
      setCameraActive(false);
    }
  };

  const handleStreamError = (error: any) => {
    setCameraError("Frame streaming error occurred");
  };

  const handleConnectionStatus = (status: string) => {
    setStreamingStatus(status);
    if (status === "connected") {
      setIsReconnecting(false);
      setReconnectAttempts(0);
    }
  };

  const handleReconnect = async () => {
    if (isReconnecting || isConnected) return;

    setIsReconnecting(true);
    setReconnectAttempts((prev) => prev + 1);

    try {
      toast.info(
        `Attempting to reconnect... (Attempt ${reconnectAttempts + 1})`
      );

      // Call the parent component's reconnect function
      if (onReconnect) {
        await onReconnect();
      }

      // Wait a bit and check if connection was successful
      setTimeout(() => {
        if (!isConnected) {
          setIsReconnecting(false);
          toast.error("Reconnection failed. Please try again.");
        } else {
          toast.success("Successfully reconnected to backend!");
        }
      }, 3000);
    } catch (error) {
      console.error("Reconnect failed:", error);
      setIsReconnecting(false);
      toast.error(
        "Reconnection failed. Please check if the backend is running."
      );
    }
  };

  const startStream = async () => {
    try {
      if (!videoRef.current) return;

      frameStreamService.on("detection", handleDetection);
      frameStreamService.on("camera-status", handleCameraStatus);
      frameStreamService.on("stream-error", handleStreamError);
      frameStreamService.on("connection-status", handleConnectionStatus);

      frameStreamService.optimizeForRealTime();
      await frameStreamService.startStream(videoRef.current);
    } catch (error) {
      setCameraError("Failed to access camera. Please check permissions.");
      setCameraActive(false);
    }
  };

  const stopStream = () => {
    frameStreamService.stopStream();
    setCameraActive(false);
    setStreamingStatus("disconnected");
    setLocalDetection(null);
  };

  useEffect(() => {
    if (isConnected && cameraActive) {
      if (isTracking) {
        frameStreamService.startTracking();
      } else {
        frameStreamService.stopTracking();
      }
    }
  }, [isTracking, isConnected, cameraActive]);

  // Enhanced canvas drawing
  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    // const container = containerRef.current;
    if (!canvas || !video) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Get the actual rendered size of the video element
    const videoRect = video.getBoundingClientRect();
    // const containerRect = container.getBoundingClientRect();

    // Set canvas size to match the video's rendered size
    canvas.width = videoRect.width;
    canvas.height = videoRect.height;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const videoWidth = video.videoWidth || 640;
    const videoHeight = video.videoHeight || 480;

    // Calculate the aspect ratios
    const videoAspect = videoWidth / videoHeight;
    const containerAspect = canvas.width / canvas.height;

    let scaleX,
      scaleY,
      offsetX = 0,
      offsetY = 0;

    // Handle object-contain scaling (maintains aspect ratio)
    if (videoAspect > containerAspect) {
      // Video is wider, fit by width
      scaleX = canvas.width / videoWidth;
      scaleY = scaleX;
      offsetY = (canvas.height - videoHeight * scaleY) / 2;
    } else {
      // Video is taller, fit by height
      scaleY = canvas.height / videoHeight;
      scaleX = scaleY;
      offsetX = (canvas.width - videoWidth * scaleX) / 2;
    }

    // Apply transforms
    ctx.save();
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.translate(offsetX, offsetY);

    // Draw trajectory with modern styling
    if (trajectory.length > 0) {
      const gradient = ctx.createLinearGradient(
        0,
        0,
        videoWidth * scaleX,
        videoHeight * scaleY
      );
      if (isTracking) {
        gradient.addColorStop(0, "#6366F1");
        gradient.addColorStop(0.5, "#8B5CF6");
        gradient.addColorStop(1, "#EC4899");
      } else {
        gradient.addColorStop(0, "#10B981");
        gradient.addColorStop(1, "#059669");
      }

      ctx.strokeStyle = gradient;
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.shadowColor = isTracking ? "#8B5CF6" : "#10B981";
      ctx.shadowBlur = 8;

      if (trajectory.length === 1) {
        const point = trajectory[0];
        const x = (1.0 - point.x) * videoWidth * scaleX;
        const y = point.y * videoHeight * scaleY;

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, 8, 0, 2 * Math.PI);
        ctx.fill();
      } else {
        ctx.beginPath();
        trajectory.forEach((point, index) => {
          const x = (1.0 - point.x) * videoWidth * scaleX;
          const y = point.y * videoHeight * scaleY;

          if (index === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        });
        ctx.stroke();

        // Start and end indicators
        if (trajectory.length > 1) {
          const firstPoint = trajectory[0];
          const lastPoint = trajectory[trajectory.length - 1];

          ctx.shadowBlur = 12;

          // Start point (green)
          ctx.fillStyle = "#10B981";
          ctx.shadowColor = "#10B981";
          ctx.beginPath();
          ctx.arc(
            (1.0 - firstPoint.x) * videoWidth * scaleX,
            firstPoint.y * videoHeight * scaleY,
            6,
            0,
            2 * Math.PI
          );
          ctx.fill();

          // End point (red)
          ctx.fillStyle = "#EF4444";
          ctx.shadowColor = "#EF4444";
          ctx.beginPath();
          ctx.arc(
            (1.0 - lastPoint.x) * videoWidth * scaleX,
            lastPoint.y * videoHeight * scaleY,
            6,
            0,
            2 * Math.PI
          );
          ctx.fill();
        }
      }
    }

    ctx.restore();

    // Draw detection box
    if (localDetection && localDetection.confidence > 0.5) {
      const isNormalized = localDetection.x <= 1.0 && localDetection.y <= 1.0;

      let detectionCenterX, detectionCenterY, detectionWidth, detectionHeight;

      if (isNormalized) {
        detectionCenterX = localDetection.x * videoWidth * scaleX + offsetX;
        detectionCenterY = localDetection.y * videoHeight * scaleY + offsetY;
        detectionWidth = localDetection.width * videoWidth * scaleX;
        detectionHeight = localDetection.height * videoHeight * scaleY;
      } else {
        detectionCenterX = localDetection.x * scaleX + offsetX;
        detectionCenterY = localDetection.y * scaleY + offsetY;
        detectionWidth = localDetection.width * scaleX;
        detectionHeight = localDetection.height * scaleY;
      }

      const boxX = detectionCenterX - detectionWidth / 2;
      const boxY = detectionCenterY - detectionHeight / 2;

      // Modern detection box
      ctx.strokeStyle = "#22C55E";
      ctx.lineWidth = 2;
      ctx.shadowColor = "#22C55E";
      ctx.shadowBlur = 6;
      ctx.strokeRect(boxX, boxY, detectionWidth, detectionHeight);

      ctx.fillStyle = "rgba(34, 197, 94, 0.1)";
      ctx.fillRect(boxX, boxY, detectionWidth, detectionHeight);

      // Center point
      ctx.fillStyle = isTracking ? "#6366F1" : "#EF4444";
      ctx.shadowColor = isTracking ? "#6366F1" : "#EF4444";
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(detectionCenterX, detectionCenterY, 4, 0, 2 * Math.PI);
      ctx.fill();

      // Label
      const confidence = Math.round(localDetection.confidence * 100);
      const label = `${localDetection.class} ${confidence}%`;

      ctx.font = "500 12px Inter, system-ui, sans-serif";
      const textMetrics = ctx.measureText(label);
      const padding = 8;
      const labelWidth = textMetrics.width + padding * 2;
      const labelHeight = 24;

      const labelX = Math.max(
        6,
        Math.min(
          canvas.width - labelWidth - 6,
          detectionCenterX - labelWidth / 2
        )
      );
      const labelY = Math.max(labelHeight + 6, boxY - 6);

      ctx.fillStyle = "rgba(34, 197, 94, 0.95)";
      ctx.shadowColor = "rgba(0, 0, 0, 0.2)";
      ctx.shadowBlur = 4;
      ctx.fillRect(labelX, labelY - labelHeight, labelWidth, labelHeight);

      ctx.fillStyle = "#FFFFFF";
      ctx.shadowColor = "transparent";
      ctx.fillText(label, labelX + padding, labelY - padding);
    }

    // Gesture result overlay
    // if (showGestureResult && lastGestureResult && !isTracking) {
    //   const resultWidth = 280;
    //   const resultHeight = 60;
    //   const resultX = (canvas.width - resultWidth) / 2;
    //   const resultY = 30;

    //   ctx.fillStyle = "rgba(16, 185, 129, 0.95)";
    //   ctx.shadowColor = "rgba(0, 0, 0, 0.3)";
    //   ctx.shadowBlur = 12;
    //   ctx.fillRect(resultX, resultY, resultWidth, resultHeight);

    //   ctx.fillStyle = "#FFFFFF";
    //   ctx.font = "bold 16px Inter, system-ui, sans-serif";
    //   ctx.shadowColor = "transparent";

    //   ctx.fillText("✓ Gesture Recognized!", resultX + 16, resultY + 22);

    //   ctx.font = "12px Inter, system-ui, sans-serif";
    //   const details = `${lastGestureResult.name} (${Math.round(
    //     lastGestureResult.similarity * 100
    //   )}%)`;
    //   ctx.fillText(details, resultX + 16, resultY + 42);
    // }

    // Debug info (minimal)
    if (showDebug) {
      ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
      ctx.fillRect(8, canvas.height - 60, 200, 52);

      ctx.fillStyle = "#FFFFFF";
      ctx.font = "10px JetBrains Mono, monospace";
      ctx.fillText(
        `Trajectory: ${trajectory.length} points`,
        12,
        canvas.height - 45
      );
      ctx.fillText(
        `Detection: ${localDetection ? "Active" : "None"}`,
        12,
        canvas.height - 32
      );
      ctx.fillText(
        `Video: ${videoWidth}x${videoHeight}`,
        12,
        canvas.height - 19
      );
    }
  }, [
    localDetection,
    isTracking,
    trajectory,
    lastGestureResult,
    showGestureResult,
    showDebug,
    performanceStats,
  ]);

  // Performance stats
  useEffect(() => {
    if (!isConnected) return;
    const interval = setInterval(() => {
      setPerformanceStats(frameStreamService.getPerformanceStats());
    }, 1000);
    return () => clearInterval(interval);
  }, [isConnected]);

  // Disconnected state
  if (!isConnected) {
    return (
      <div className={`relative w-full p-0.5 ${className}`} style={style}>
        <div className="relative w-full h-full bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-900 flex items-center justify-center overflow-hidden">
          {/* Animated background */}
          <div className="absolute inset-0 bg-gradient-to-r from-blue-500/5 via-purple-500/5 to-pink-500/5 animate-pulse" />

          <div className="relative z-10 text-center p-8">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gray-200 dark:bg-gray-700 mb-6">
              <CameraOff
                className="w-10 h-10 text-gray-400 dark:text-gray-500"
                strokeWidth={1.5}
              />
            </div>
            <h3 className="text-xl font-semibold text-gray-700 dark:text-gray-300 mb-2">
              Disconnected
            </h3>
            <p className="text-gray-500 dark:text-gray-400 mb-6 max-w-xs">
              Connect to the backend server to start the camera feed
            </p>

            {/* Connection Status */}
            <div className="flex items-center justify-center space-x-2 mb-6">
              <WifiOff className="w-4 h-4 text-red-500" strokeWidth={1.5} />
              <span className="text-sm text-red-500 font-medium">
                Backend Offline
              </span>
            </div>

            {/* Reconnect Attempts Counter */}
            {reconnectAttempts > 0 && (
              <p className="text-xs text-gray-400 mb-4">
                Attempt {reconnectAttempts}
              </p>
            )}

            {/* Reconnect Button */}
            <Button
              onClick={handleReconnect}
              disabled={isReconnecting || isConnected}
              variant="outline"
              size="sm"
              className="gap-2"
            >
              {isReconnecting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Reconnecting...
                </>
              ) : (
                <>
                  <RotateCcw className="w-4 h-4" />
                  Reconnect
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative w-full font-normal ${className}`} style={style}>
      <div
        ref={containerRef}
        className={`relative w-full h-full rounded-2xl overflow-hidden bg-black shadow-lg`}
      >
        {/* Video Feed */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-contain"
          style={{ transform: "scaleX(-1)" }}
          onLoadedMetadata={() => {
            if (videoRef.current) {
              videoRef.current.play().catch(console.error);
            }
          }}
        />

        {/* Canvas Overlay */}
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full pointer-events-none"
          style={{ zIndex: 10 }}
        />

        {/* Top Status Bar */}
        <div className="absolute top-3 left-3 right-3 flex items-center justify-between z-20">
          {/* Left Status */}
          <div className="flex items-center space-x-2">
            {cameraActive && (
              <Badge className="bg-green-500/90 text-white border-0 backdrop-blur-sm px-2 py-0.5 rounded-full">
                <Circle className="fill-current aspect-square animate-pulse" />
                Live
              </Badge>
            )}
          </div>

          {/* Right Controls */}
          <div className="flex items-center space-x-2">
            {trajectory.length > 0 && (
              <Badge className="bg-purple-500/40 text-white border-0 backdrop-blur-sm p-1">
                <Target className="w-3 h-3" />
                {trajectory.length}
              </Badge>
            )}

            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowDebug(!showDebug)}
              className="cursor-pointer h-7 w-7 p-1 bg-gray-800/40 hover:bg-white/20 dark:bg-white/20 dark:hover:bg-white/30 backdrop-blur-md text-white border-0 rounded-full shadow-md"
            >
              <InfoIcon className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Recording Indicator */}
        {/* {showRecordingStatus && isTracking && (
          <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-20">
            <div className="bg-red-500/95 text-white px-4 py-2 rounded-full text-sm font-medium backdrop-blur-sm animate-pulse flex items-center space-x-2">
              <Circle className="w-2 h-2 fill-current animate-ping" />
              <span>Recording</span>
            </div>
          </div>
        )} */}

        {/* Error State */}
        {cameraError && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80 backdrop-blur-sm z-30">
            <Card className="max-w-sm">
              <div className="p-6 text-center">
                <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CameraOff className="w-8 h-8 text-red-500" />
                </div>
                <h3 className="text-lg font-semibold text-red-600 mb-2">
                  Camera Error
                </h3>
                <p className="text-sm text-gray-600 mb-4">{cameraError}</p>
                <Button onClick={startStream} variant="outline" size="sm">
                  <Camera className="w-4 h-4 mr-2" />
                  Retry
                </Button>
              </div>
            </Card>
          </div>
        )}

        {/* Loading State */}
        {isConnected && !cameraActive && !cameraError && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm z-20">
            <div className="text-center">
              <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
              <p className="text-white text-sm font-medium">
                Initializing camera...
              </p>
            </div>
          </div>
        )}

        {/* Gradient overlays for better readability */}
        <div className="absolute top-0 left-0 right-0 h-20 bg-gradient-to-b from-black/30 to-transparent pointer-events-none z-10" />
        <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-black/30 to-transparent pointer-events-none z-10" />
      </div>
    </div>
  );
}
