import { useRef, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { VideoFeed } from "@/components/VideoFeed";
import { frameStreamService } from "@/services/frameStreamService";
import { toast, Toaster } from "sonner";
import { useAppStore } from "@/stores/appStore";
import { invoke } from "@tauri-apps/api/core";
import {
  Hand,
  Play,
  Square,
  Save,
  Trash2,
  Target,
  RotateCcw,
  BookOpen,
  Activity,
  CheckCircle,
  Sun,
  Moon,
  Settings,
  Terminal,
} from "lucide-react";

function AppContent() {
  // Zustand store
  const {
    // State
    isConnected,
    isDrawing,
    fingerDetection,
    trajectory,
    lastGestureResult,
    isWaitingToStart,
    templates,
    templateName,
    templateCommand,
    handDetectionConfidence,
    gestureConfidence,
    autoStartDelay,
    isDarkMode,
    showSavePanel,

    // Actions
    setIsConnected,
    setConnectionError,
    setIsDrawing,
    setFingerDetection,
    addTrajectoryPoint,
    clearTrajectory,
    setLastGestureResult,
    setIsWaitingToStart,
    setTemplateName,
    setTemplateCommand,
    setHandDetectionConfidence,
    setGestureConfidence,
    setAutoStartDelay,
    toggleTheme,
    setShowSavePanel,
    setLoadingToastId,
    loadTemplatesFromStorage,
    saveTemplate,
    deleteTemplate,
    clearGesture,
    dismissLoadingToast,
  } = useAppStore();

  // Local state for command execution
  const [isExecutingCommand, setIsExecutingCommand] = useState(false);
  const [executingCommand, setExecutingCommand] = useState<string>("");

  // WebSocket refs
  const frameSocketRef = useRef<WebSocket | null>(null);
  const legacySocketRef = useRef<WebSocket | null>(null);
  const autoStartTimerRef = useRef<NodeJS.Timeout | null>(null);
  const loadingToastTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Enhanced dismiss function that also clears timeout
  const dismissLoadingToastWithTimeout = () => {
    if (loadingToastTimeoutRef.current) {
      clearTimeout(loadingToastTimeoutRef.current);
      loadingToastTimeoutRef.current = null;
    }
    dismissLoadingToast();
  };

  // Initialize app
  useEffect(() => {
    connectWebSockets();
    loadTemplatesFromStorage();

    return () => {
      if (frameSocketRef.current) frameSocketRef.current.close();
      if (legacySocketRef.current) legacySocketRef.current.close();
      if (autoStartTimerRef.current) clearTimeout(autoStartTimerRef.current);
      if (loadingToastTimeoutRef.current)
        clearTimeout(loadingToastTimeoutRef.current);
    };
  }, []);

  // Send confidence updates to backend when values change
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      sendConfidenceUpdate();
    }, 300); // Debounce for 300ms to avoid too many updates while dragging

    return () => clearTimeout(timeoutId);
  }, [handDetectionConfidence, gestureConfidence]);

  // Auto-start detection when hand is detected for 1 second
  useEffect(() => {
    if (fingerDetection && !isDrawing && isConnected) {
      // Hand detected and not currently drawing
      if (!autoStartTimerRef.current && !isWaitingToStart) {
        // Start the timer only if we don't already have one running
        console.log("🖐️ Hand detected, starting auto-start timer...");
        setIsWaitingToStart(true);

        autoStartTimerRef.current = setTimeout(() => {
          console.log(
            "⏰ Auto-start timer triggered, calling handleStartDrawing"
          );
          handleStartDrawing();
          toast.success("Auto-started recording gesture!");
          setIsWaitingToStart(false);
          autoStartTimerRef.current = null;
        }, autoStartDelay * 1000); // Convert seconds to milliseconds
      }
    } else {
      // No hand detected or already drawing - clear any pending timer
      if (autoStartTimerRef.current) {
        console.log(
          "🛑 Clearing auto-start timer (no hand or already drawing)"
        );
        clearTimeout(autoStartTimerRef.current);
        autoStartTimerRef.current = null;
        setIsWaitingToStart(false);
      }
    }
  }, [!!fingerDetection, isDrawing, isConnected]); // Use !!fingerDetection to only react to presence/absence, not coordinate changes

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (autoStartTimerRef.current) {
        clearTimeout(autoStartTimerRef.current);
        autoStartTimerRef.current = null;
      }
    };
  }, []);

  // Listen for detection events
  useEffect(() => {
    const handleDetection = (detection: any) => {
      console.log(
        "🎯 Detection event received:",
        detection,
        "isDrawing:",
        isDrawing
      );
      setFingerDetection(detection);

      if (isDrawing && detection) {
        const frameWidth = 640;
        const frameHeight = 480;
        const isNormalized = detection.x <= 1.0 && detection.y <= 1.0;

        const newPoint = {
          x: isNormalized ? detection.x : detection.x / frameWidth,
          y: isNormalized ? detection.y : detection.y / frameHeight,
        };

        console.log("✅ Adding trajectory point:", newPoint);

        addTrajectoryPoint(newPoint);
      }
    };

    frameStreamService.on("detection", handleDetection);
    return () => {
      frameStreamService.removeListener("detection", handleDetection);
    };
  }, [isDrawing]);

  // Auto gesture recognition
  useEffect(() => {
    let noDetectionTimer: NodeJS.Timeout;

    if (isDrawing && !fingerDetection && trajectory.length >= 2) {
      console.log(
        "🤚 Hand removed while drawing, starting auto-recognition timer (2s)..."
      );
      console.log("📊 Current trajectory length:", trajectory.length);

      noDetectionTimer = setTimeout(() => {
        console.log("⏰ Auto-recognition timer triggered");
        console.log("📊 Final trajectory length:", trajectory.length);
        setIsDrawing(false);
        recognizeGesture(trajectory);
      }, 2000);
    } else if (isDrawing && fingerDetection) {
      console.log("✋ Hand still detected, continuing to draw...");
    }

    return () => {
      if (noDetectionTimer) {
        clearTimeout(noDetectionTimer);
      }
    };
  }, [isDrawing, fingerDetection, trajectory]);

  const connectWebSockets = () => {
    try {
      if (frameSocketRef.current) frameSocketRef.current.close();
      if (legacySocketRef.current) legacySocketRef.current.close();

      const frameSocket = new WebSocket("ws://127.0.0.1:8000/ws/frames");
      frameSocketRef.current = frameSocket;

      const legacySocket = new WebSocket("ws://127.0.0.1:8000/ws");
      legacySocketRef.current = legacySocket;

      frameSocket.onopen = () => {
        setIsConnected(true);
        setConnectionError(null);
        toast.success("Connected to AirCut backend");
      };

      frameSocket.onclose = () => {
        setIsConnected(false);
        setFingerDetection(null);
      };

      frameSocket.onerror = (error) => {
        setConnectionError("Failed to connect to the frame streaming server");
        setIsConnected(false);
      };

      frameSocket.onmessage = (event) => {
        handleFrameWebSocketMessage(event.data);
      };

      legacySocket.onopen = () => {
        console.log("Legacy WebSocket connection established");
      };

      legacySocket.onmessage = (event) => {
        handleLegacyWebSocketMessage(event.data);
      };
    } catch (error) {
      setConnectionError(`Connection error: ${error}`);
      setIsConnected(false);
    }
  };

  const handleFrameWebSocketMessage = (data: string) => {
    try {
      const message = JSON.parse(data);

      switch (message.type) {
        case "detection":
          if (
            message.detection &&
            message.detection.confidence > handDetectionConfidence &&
            (message.detection.class === "hand" ||
              message.detection.class === "finger")
          ) {
            setFingerDetection(message.detection);
          } else {
            setFingerDetection(null);
          }
          break;

        case "confidence_updated":
          console.log("✅ Backend confidence updated:", {
            hand: message.hand_detection_confidence,
            gesture: message.gesture_recognition_confidence,
          });
          toast.success(
            `Settings updated: Detection ${(
              message.hand_detection_confidence * 100
            ).toFixed(0)}%, Recognition  ${(
              message.gesture_recognition_confidence * 100
            ).toFixed(0)}%`,
            {
              duration: 2000,
              icon: <Settings className="w-4 h-4" strokeWidth={1.5} />,
            }
          );
          break;

        case "connection_established":
          console.log("✅ Frame streaming connection established");
          if (message.current_hand_confidence !== undefined) {
            setHandDetectionConfidence(message.current_hand_confidence);
          }
          if (message.current_gesture_confidence !== undefined) {
            setGestureConfidence(message.current_gesture_confidence);
          }
          break;

        case "error":
          setConnectionError(message.message);
          break;
      }
    } catch (error) {
      console.error("Error parsing frame WebSocket message:", error);
    }
  };

  const handleLegacyWebSocketMessage = (data: string) => {
    try {
      const message = JSON.parse(data);
      console.log("📨 Received legacy WebSocket message:", message.type);

      switch (message.type) {
        case "gesture_recognized":
          console.log("🎯 Gesture recognized:", message);

          // Dismiss loading toast first
          dismissLoadingToastWithTimeout();

          setLastGestureResult({
            name: message.template_name,
            command: message.command,
            similarity: message.similarity,
          });

          toast.success(
            `🎯 Gesture "${message.template_name}" recognized!\nConfidence: ${(
              message.similarity * 100
            ).toFixed(1)}%\nCommand: ${message.command || "None"}`,
            {
              duration: 5000,
            }
          );

          // Execute the command if it exists
          if (message.command && message.command.trim() !== "") {
            executeCommand(message.command);
          }
          break;

        case "gesture_not_recognized":
          console.log("❌ Gesture not recognized:", message);

          // Dismiss loading toast first
          dismissLoadingToastWithTimeout();

          setLastGestureResult(null);
          toast.error(
            `🤔 Gesture not recognized\nSimilarity too low for any template`,
            {
              duration: 3000,
            }
          );
          break;

        case "error":
          console.error("❌ Legacy WebSocket error:", message.message);

          // Dismiss loading toast if there was one
          dismissLoadingToastWithTimeout();

          toast.error(`Error: ${message.message}`);
          break;

        default:
          console.log("🔍 Unknown message type:", message.type);
          break;
      }
    } catch (error) {
      console.error("Error parsing legacy WebSocket message:", error);
    }
  };

  const handleStartDrawing = () => {
    console.log(
      "🎬 handleStartDrawing called - clearing trajectory and setting isDrawing to true"
    );
    clearTrajectory();
    setIsDrawing(true);
    toast.success("Drawing started! Move your hand to record a gesture.");
  };

  const handleStopDrawing = () => {
    setIsDrawing(false);
    if (trajectory.length >= 2) {
      recognizeGesture(trajectory);
    } else {
      toast.error(
        "Not enough points recorded. Try again with a longer gesture."
      );
    }
  };

  const recognizeGesture = async (
    gestureTrajectory: Array<{ x: number; y: number }>
  ) => {
    try {
      console.log(
        "🎯 Starting gesture recognition with trajectory:",
        gestureTrajectory
      );
      console.log("📏 Trajectory length:", gestureTrajectory.length);
      console.log("📚 Available templates:", templates.length);

      if (
        !legacySocketRef.current ||
        legacySocketRef.current.readyState !== WebSocket.OPEN
      ) {
        toast.error(
          "WebSocket not connected. Please check backend connection."
        );
        return;
      }

      if (templates.length === 0) {
        toast.error("No templates available. Please save some gestures first.");
        return;
      }

      // Clear any existing timeout
      if (loadingToastTimeoutRef.current) {
        clearTimeout(loadingToastTimeoutRef.current);
      }

      // Send templates and trajectory together for stateless recognition
      const recognitionMessage = {
        type: "recognize_gesture",
        trajectory: gestureTrajectory,
        confidence_threshold: gestureConfidence,
        templates: templates.map((template) => ({
          name: template.name,
          command: template.command,
          trajectory: template.points.map(([x, y]) => ({ x, y })),
        })),
      };

      console.log(
        "📤 Sending recognition request with",
        templates.length,
        "templates"
      );
      legacySocketRef.current.send(JSON.stringify(recognitionMessage));

      // Store the loading toast ID so we can dismiss it later
      const toastId = toast.loading("Recognizing gesture...");
      setLoadingToastId(toastId);

      // Safety timeout to dismiss the toast if no response comes back in 10 seconds
      loadingToastTimeoutRef.current = setTimeout(() => {
        console.log("⏰ Recognition timeout - force dismissing loading toast");
        dismissLoadingToastWithTimeout();
        toast.error("Recognition timed out. Please try again.");
      }, 10000);
    } catch (error) {
      console.error("❌ Recognition error:", error);

      // Dismiss loading toast if there was one
      dismissLoadingToastWithTimeout();

      toast.error(`Recognition error: ${error}`);
    }
  };

  // Theme-based styles
  const bgClass =
    "bg-gradient-to-br from-gray-200 via-white to-blue-50 dark:from-slate-800 dark:via-slate-900 dark:to-slate-800";
  const panelClass =
    "bg-white/80 backdrop-blur-xl border-gray-200/50 dark:bg-slate-800/80 dark:backdrop-blur-xl dark:border-slate-700/50";
  const textClass = "text-gray-900 dark:text-white";
  const textSecondaryClass = "text-gray-600 dark:text-white/80";
  const textMutedClass = "text-gray-500 dark:text-white/60";

  // Initialize dark mode based on state
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [isDarkMode]);

  const sendConfidenceUpdate = () => {
    if (
      frameSocketRef.current &&
      frameSocketRef.current.readyState === WebSocket.OPEN
    ) {
      const updateMessage = {
        type: "update_confidence",
        hand_detection_confidence: handDetectionConfidence,
        gesture_recognition_confidence: gestureConfidence,
      };

      frameSocketRef.current.send(JSON.stringify(updateMessage));
    }
  };

  // Execute command function
  const executeCommand = async (command: string) => {
    if (!command || command.trim() === "") {
      return;
    }

    try {
      setIsExecutingCommand(true);
      setExecutingCommand(command.trim());

      console.log(`🚀 Executing command: ${command}`);
      toast.info(`Executing: ${command}`, {
        duration: 2000,
        icon: <Terminal className="w-4 h-4" strokeWidth={1.5} />,
      });

      // Use Tauri's invoke to execute shell commands
      // This requires a corresponding Tauri command in the Rust backend
      const result = await invoke("execute_command", {
        command: command.trim(),
      });

      toast.success(`✅ Command executed successfully`, {
        duration: 3000,
        description: typeof result === "string" ? result : undefined,
      });
    } catch (error) {
      console.error("❌ Command execution failed:", error);
      toast.error(`Failed to execute command`, {
        duration: 4000,
        description: typeof error === "string" ? error : String(error),
      });
    } finally {
      // Clear execution state after a delay
      setTimeout(() => {
        setIsExecutingCommand(false);
        setExecutingCommand("");
      }, 2000);
    }
  };

  return (
    <div
      className={`h-screen ${bgClass} overflow-hidden relative transition-all duration-500`}
    >
      {/* Floating Top Bar */}
      <div className="absolute top-6 left-1/2 transform -translate-x-1/2 z-50 ">
        <div className={`${panelClass} rounded-full px-2 py-2 shadow-lg`}>
          <div className="flex items-center space-x-1">
            {/* Brand */}
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full flex items-center justify-center shadow-md">
                <Hand className="w-4 h-4 text-white" />
              </div>
              <span
                className={`${textClass} font-bold text-lg bg-gradient-to-r from-blue-500 to-purple-600 bg-clip-text text-transparent`}
              >
                AirCut
              </span>
            </div>

            {/* Status */}
            <div className="flex items-center space-x-4 ml-4">
              <div className="w-px h-4 bg-gray-300 dark:bg-white/20" />

              {/* Theme Toggle */}
              <Button
                onClick={toggleTheme}
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 hover:bg-gray-100 dark:hover:bg-white/10"
              >
                {isDarkMode ? (
                  <Sun className="w-4 h-4 text-yellow-500" />
                ) : (
                  <Moon className="w-4 h-4 text-blue-600" />
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Container */}
      <div className="h-full flex items-start justify-center p-8">
        <div className="w-full max-w-7xl mx-auto grid grid-cols-11 gap-8 my-auto">
          {/* Left Panel - Settings */}
          <div className="col-span-3 flex flex-col space-y-4">
            {/* Settings Panel */}
            <div
              className={`${panelClass} rounded-2xl p-2 shadow-xl border border-white/20 h-[400px]`}
            >
              {/* Header */}
              <div className="flex items-center space-x-3 mb-6">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500/20 to-purple-600/20 flex items-center justify-center">
                  <Settings
                    className="w-4 h-4 text-indigo-600 dark:text-indigo-400"
                    strokeWidth={1.5}
                  />
                </div>
                <div>
                  <h3 className={`${textClass} font-normal text-base`}>
                    Settings
                  </h3>
                  <p className={`${textMutedClass} text-xs`}>
                    Detection & Recognition
                  </p>
                </div>
              </div>

              {/* Hand Detection Confidence */}
              <div className="space-y-4 mb-6">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label
                      className={`${textSecondaryClass} text-sm font-normal`}
                    >
                      Hand Detection
                    </Label>
                    <div className="flex items-center space-x-2">
                      <div className="w-2 h-2 rounded-full bg-blue-500" />
                      <span className={`${textClass} text-sm font-thin`}>
                        {(handDetectionConfidence * 100).toFixed(0)}%
                      </span>
                    </div>
                  </div>
                  <div className="px-1">
                    <Slider
                      value={[handDetectionConfidence]}
                      onValueChange={(value) =>
                        setHandDetectionConfidence(value[0])
                      }
                      max={1}
                      min={0.1}
                      step={0.05}
                      className="w-full [&>span[data-orientation=horizontal]]:h-1 "
                    />
                  </div>
                  <p className={`${textMutedClass} text-xs leading-relaxed`}>
                    Minimum confidence required for finger detection
                  </p>
                </div>

                {/* Gesture Recognition Confidence */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label
                      className={`${textSecondaryClass} text-sm font-normal`}
                    >
                      Gesture Recognition
                    </Label>
                    <div className="flex items-center space-x-2 font-thin">
                      <div className="w-2 h-2 rounded-full bg-emerald-500" />
                      <span className={`${textClass} text-sm`}>
                        {(gestureConfidence * 100).toFixed(0)}%
                      </span>
                    </div>
                  </div>
                  <div className="px-1">
                    <Slider
                      value={[gestureConfidence]}
                      onValueChange={(value) => setGestureConfidence(value[0])}
                      max={1}
                      min={0.3}
                      step={0.05}
                      className="w-full [&>span[data-orientation=horizontal]]:h-1 "
                    />
                  </div>
                  <p className={`${textMutedClass} text-xs leading-relaxed`}>
                    Minimum confidence required for gesture recognition
                  </p>
                </div>
              </div>

              {/* Auto-start delay */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label
                    className={`${textSecondaryClass} text-sm font-normal`}
                  >
                    Auto-start delay
                  </Label>
                  <div className="flex items-center space-x-2 font-thin">
                    <div className="w-2 h-2 rounded-full bg-emerald-500" />
                    <span className={`${textClass} text-sm font-thin`}>
                      {autoStartDelay.toFixed(1)} seconds
                    </span>
                  </div>
                </div>
                <div className="px-1">
                  <Slider
                    value={[autoStartDelay]}
                    onValueChange={(value) => setAutoStartDelay(value[0])}
                    max={2}
                    min={0.1}
                    step={0.1}
                    className="w-full [&>span[data-orientation=horizontal]]:h-1 "
                  />
                </div>
                <p className={`${textMutedClass} text-xs leading-relaxed`}>
                  Delay before auto-start after hand detection
                </p>
              </div>

              {/* Quick Stats */}
              <div className="grid grid-cols-3 gap-3 pt-2 border-t border-gray-200/50 dark:border-white/10 mt-2">
                <div className="text-center">
                  <div className="text-lg font-bold bg-gradient-to-r from-blue-500 to-purple-600 bg-clip-text text-transparent">
                    {templates.length}
                  </div>
                  <div className={`${textMutedClass} text-xs font-medium`}>
                    Templates
                  </div>
                </div>

                <div className="text-center">
                  <div className="text-lg font-bold bg-gradient-to-r from-emerald-500 to-teal-600 bg-clip-text text-transparent">
                    {trajectory.length}
                  </div>
                  <div className={`${textMutedClass} text-xs font-medium`}>
                    Points
                  </div>
                </div>

                <div className="text-center">
                  <div
                    className={`text-lg font-bold ${
                      isConnected ? "text-green-500" : "text-red-500"
                    }`}
                  >
                    {isConnected ? "●" : "○"}
                  </div>
                  <div className={`${textMutedClass} text-xs font-medium`}>
                    Status
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Center - Camera Feed */}
          <div className="col-span-5 flex flex-col justify-center space-y-2">
            <div className="relative h-[400px] max-w-[532px] mx-auto">
              {/* Camera Container */}
              <div
                className={`w-full h-full max-w-6xl mx-auto rounded-3xl overflow-hidden border-2 border-gray-300/50 dark:border-white/20 shadow-2xl bg-white/50 dark:bg-black/50 backdrop-blur-sm`}
              >
                <VideoFeed
                  isConnected={isConnected}
                  fingerDetection={fingerDetection}
                  isTracking={isDrawing}
                  trajectory={trajectory}
                  lastGestureResult={lastGestureResult}
                  onClearTrajectory={clearGesture}
                  onRecognizeGesture={recognizeGesture}
                  onLoadTemplates={loadTemplatesFromStorage}
                  onReconnect={connectWebSockets}
                  isActive={true}
                />
              </div>

              {/* Auto-start waiting indicator */}
              {isWaitingToStart && (
                <div className="absolute -top-28 inset-x-20 z-10">
                  <div
                    className={`${panelClass} rounded-2xl p-4 shadow-2xl border border-white/20 min-w-[280px] transform transition-all duration-500 animate-in slide-in-from-top-2 fade-in-0`}
                  >
                    <div className="flex items-center space-x-3">
                      {/* Status Content */}
                      <div className="flex-1">
                        <div className="flex items-center space-x-2 mb-1">
                          <h4 className={`${textClass} font-semibold text-sm`}>
                            Hand Detected
                          </h4>
                          <div className="flex items-center space-x-1">
                            <div
                              className="w-1 h-1 bg-blue-500 rounded-full animate-bounce"
                              style={{ animationDelay: "0ms" }}
                            />
                            <div
                              className="w-1 h-1 bg-blue-500 rounded-full animate-bounce"
                              style={{ animationDelay: "150ms" }}
                            />
                            <div
                              className="w-1 h-1 bg-blue-500 rounded-full animate-bounce"
                              style={{ animationDelay: "300ms" }}
                            />
                          </div>
                        </div>

                        {/* Countdown */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-xs">
                            <span className={`${textMutedClass}`}>
                              Starting recording in...
                            </span>
                            <span className="font-medium text-blue-500">
                              {autoStartDelay.toFixed(1)}s
                            </span>
                          </div>
                          <div className="w-full bg-gray-200/60 dark:bg-white/10 rounded-full h-1.5 overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-blue-500 to-emerald-500 rounded-full transition-all ease-linear"
                              style={{
                                width: "100%",
                                animationDuration: `${autoStartDelay}s`,
                                animationName: "countdown",
                                animationTimingFunction: "linear",
                                animationFillMode: "forwards",
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Recognition Result - Top Left */}
              {(lastGestureResult || isExecutingCommand) && (
                <div className="absolute -top-28 inset-x-20 z-10">
                  <div
                    className={`${panelClass} rounded-3xl py-2 px-4 shadow-2xl border border-white/20 min-w-[360px] transform transition-all duration-500 animate-in slide-in-from-top-2 fade-in-0`}
                  >
                    <div className="flex items-center space-x-3">
                      {/* Status Indicator */}
                      <div className="relative">
                        <div
                          className={`w-10 h-10 rounded-xl ${
                            isExecutingCommand
                              ? "bg-gradient-to-br from-blue-500/20 to-purple-500/20"
                              : "bg-gradient-to-br from-green-500/20 to-emerald-500/20"
                          } flex items-center justify-center`}
                        >
                          {isExecutingCommand ? (
                            <Terminal className="w-5 h-5 text-blue-500 animate-pulse" />
                          ) : (
                            <CheckCircle className="w-5 h-5 text-green-500" />
                          )}
                        </div>
                        <div
                          className={`absolute -inset-1 ${
                            isExecutingCommand
                              ? "bg-blue-500/20 animate-pulse"
                              : "bg-green-500/20 animate-pulse"
                          } rounded-2xl`}
                        />
                      </div>

                      {/* Content */}
                      <div className="flex-1">
                        <div className="flex items-center space-x-2 mb-1">
                          <h4 className={`${textClass} font-semibold text-sm`}>
                            {isExecutingCommand
                              ? "Executing Command"
                              : "Gesture Recognized"}
                          </h4>
                        </div>

                        {/* Details */}
                        <div className="space-y-1">
                          {isExecutingCommand ? (
                            <div className="flex flex-row items-center justify-start gap-x-1">
                              <span
                                className={`${textClass} text-xs font-medium`}
                              >
                                {executingCommand}
                              </span>
                              <div className="flex items-center space-x-1">
                                <div
                                  className="w-1 h-1 bg-blue-500 rounded-full animate-bounce"
                                  style={{ animationDelay: "0ms" }}
                                />
                                <div
                                  className="w-1 h-1 bg-blue-500 rounded-full animate-bounce"
                                  style={{ animationDelay: "150ms" }}
                                />
                                <div
                                  className="w-1 h-1 bg-blue-500 rounded-full animate-bounce"
                                  style={{ animationDelay: "300ms" }}
                                />
                              </div>
                            </div>
                          ) : lastGestureResult ? (
                            <>
                              <div className="flex flex-row items-center justify-start gap-x-1">
                                <span
                                  className={`${textClass} text-xs font-medium`}
                                >
                                  {lastGestureResult.name}
                                </span>
                                <span className="text-xs font-medium">
                                  with{" "}
                                  <span className="text-green-600 dark:text-green-400 text-xs font-medium">
                                    {(
                                      lastGestureResult.similarity * 100
                                    ).toFixed(1)}
                                    %{" "}
                                  </span>
                                  confidence
                                </span>
                              </div>

                              {lastGestureResult.command && (
                                <div className="flex items-center justify-between">
                                  <span className="text-blue-600 dark:text-blue-400 text-xs font-medium">
                                    {lastGestureResult.command}
                                  </span>
                                </div>
                              )}
                            </>
                          ) : null}
                        </div>
                      </div>

                      {/* Status Bar */}
                      <div
                        className={`w-1 rounded-full h-8 ${
                          isExecutingCommand
                            ? "bg-gradient-to-b from-blue-500/40 via-blue-500 to-blue-500/40"
                            : "bg-gradient-to-b from-green-500/40 via-green-500 to-green-500/40"
                        }`}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Save - Only show when there's a trajectory */}
              {trajectory.length >= 2 && (
                <Button
                  onClick={() => setShowSavePanel(!showSavePanel)}
                  size="sm"
                  className="absolute bottom-2 left-2 h-9 px-4 rounded-full text-xs font-medium bg-emerald-500 hover:bg-emerald-500/80 border border-emerald-200/50 dark:border-emerald-400/20 text-white shadow-lg shadow-emerald-500/30 transition-all duration-200"
                >
                  <Save className="w-3.5 h-3.5 mr-1.5" strokeWidth={2} />
                  Save
                </Button>
              )}
            </div>

            {/* Recording Controls - Bottom of Video Feed */}
            <div
              className={`${panelClass} rounded-full py-1.5 px-2 shadow-xl border border-white/20 w-min mx-auto`}
            >
              {/* Main Recording Control - Centered */}
              <div className="flex items-center justify-center gap-x-4">
                <Button
                  onClick={() => recognizeGesture(trajectory)}
                  disabled={!isConnected || trajectory.length < 2}
                  variant="ghost"
                  size="sm"
                  className="h-9 px-4 flex-1 rounded-full text-xs font-medium bg-gray-50/50 hover:bg-gray-100/50 dark:bg-white/5 dark:hover:bg-white/10 border border-gray-200/30 dark:border-white/10 text-gray-600 dark:text-white/70 disabled:opacity-40 transition-all duration-200"
                >
                  <Target className="w-3.5 h-3.5 mr-1.5" strokeWidth={2} />
                  Analyze
                </Button>

                <div className="relative">
                  {/* Recording Button */}
                  <Button
                    onClick={isDrawing ? handleStopDrawing : handleStartDrawing}
                    disabled={!isConnected}
                    className={`flex-1 relative w-10 h-10 rounded-full transition-all duration-300 border-0 shadow-lg overflow-hidden ${
                      isDrawing
                        ? "bg-red-500 hover:bg-red-600 text-white shadow-red-500/30"
                        : "bg-blue-500 hover:bg-blue-600 text-white shadow-blue-500/30"
                    } ${
                      !isConnected
                        ? "opacity-50 cursor-not-allowed"
                        : "hover:scale-105 active:scale-95"
                    }`}
                  >
                    {/* Animated Background Pulse */}
                    {isDrawing && (
                      <div className="absolute inset-0 bg-red-400 rounded-full animate-ping opacity-30" />
                    )}

                    {/* Icon */}
                    <div className="relative z-10">
                      {isDrawing ? (
                        <Square className="w-6 h-6 fill-current" />
                      ) : (
                        <Play className="w-6 h-6 fill-current ml-0.5" />
                      )}
                    </div>
                  </Button>

                  {/* Status Text */}
                  {/* <div className="absolute -bottom-8 left-1/2 transform -translate-x-1/2 whitespace-nowrap">
                    <span className={`text-xs font-medium ${textMutedClass}`}>
                      {isDrawing ? "Recording..." : "Ready to record"}
                    </span>
                  </div> */}
                </div>

                {/* Reset */}
                <Button
                  onClick={clearGesture}
                  disabled={trajectory.length === 0}
                  variant="ghost"
                  size="sm"
                  className="flex-1 h-9 px-4 rounded-full text-xs font-medium bg-gray-50/50 hover:bg-gray-100/50 dark:bg-white/5 dark:hover:bg-white/10 border border-gray-200/30 dark:border-white/10 text-gray-600 dark:text-white/70 disabled:opacity-40 transition-all duration-200"
                >
                  <RotateCcw className="w-3.5 h-3.5 mr-1.5" strokeWidth={2} />
                  Reset
                </Button>
              </div>
            </div>
          </div>

          {/* Right Panel - Templates */}
          <div className="col-span-3 flex flex-col justify-start h-full">
            <div
              className={`${panelClass} rounded-2xl p-2 shadow-xl border border-white/20 h-[400px] flex flex-col`}
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center space-x-2">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500/20 to-teal-600/20 flex items-center justify-center">
                    <BookOpen className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div>
                    <h3 className={`${textClass} font-normal text-base`}>
                      Library
                    </h3>
                    <p className={`${textMutedClass} text-xs`}>
                      Gesture templates
                    </p>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <div className="rounded-md bg-emerald-100 dark:bg-emerald-500/20">
                    <span className="text-emerald-700 dark:text-emerald-300 text-xs font-medium aspect-square w-6 h-6 flex items-center justify-center">
                      {templates.length}
                    </span>
                  </div>
                </div>
              </div>

              {/* Templates List */}
              <div className="flex-1 overflow-hidden">
                {templates.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center space-y-3">
                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-800 flex items-center justify-center">
                      <BookOpen className="w-6 h-6 text-gray-400 dark:text-gray-500" />
                    </div>
                    <div className="space-y-1">
                      <p className={`${textMutedClass} text-sm font-medium`}>
                        No gestures yet
                      </p>
                      <p className={`${textMutedClass} text-xs opacity-75`}>
                        Record your first gesture to get started
                      </p>
                    </div>
                  </div>
                ) : (
                  <ScrollArea className="h-full w-full">
                    <div className="space-y-2 mx-1">
                      {templates.map((template, index) => (
                        <div key={template.id} className="group relative">
                          <div className="relative p-1.5 rounded-xl bg-gray-50/80 hover:bg-gray-100/80 dark:bg-white/5 dark:hover:bg-white/10 border border-gray-200/50 dark:border-white/10 transition-all duration-300 hover:shadow-lg">
                            {/* Template Content */}
                            <div className="flex items-start justify-between">
                              <div className="flex-1 min-w-0 space-y-1">
                                {/* Template Name */}
                                <div className="flex items-center space-x-2">
                                  <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-blue-500/20 to-purple-600/20 flex items-center justify-center flex-shrink-0">
                                    <span className="text-blue-600 dark:text-blue-400 text-xs font-bold">
                                      {template.name.charAt(0).toUpperCase()}
                                    </span>
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <h4
                                      className={`${textClass} font-medium text-sm truncate`}
                                    >
                                      {template.name}
                                    </h4>
                                  </div>
                                </div>

                                {/* Command */}
                                {template.command && (
                                  <div className="ml-8">
                                    <div className="inline-flex items-center px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-500/10">
                                      <span
                                        className={`${textMutedClass} text-xs`}
                                      >
                                        {template.command}
                                      </span>
                                    </div>
                                  </div>
                                )}

                                {/* Points Count */}
                                <div className="ml-8">
                                  <span className="text-emerald-600 dark:text-emerald-400 text-xs font-medium">
                                    {template.points.length} points
                                  </span>
                                </div>
                              </div>

                              {/* Delete Button */}
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => deleteTemplate(template.id)}
                                className="opacity-0 absolute top-1 right-1 group-hover:opacity-100 transition-all duration-200 h-6 w-6 p-0 text-gray-700 dark:text-white hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/20 rounded-lg cursor-pointer"
                              >
                                <Trash2 className="w-3 h-3" strokeWidth={1.5} />
                              </Button>
                            </div>

                            {/* Index indicator */}
                            <div className="absolute bottom-1 right-1 w-5 h-5 rounded-full bg-gray-200/60 dark:bg-white/10 flex items-center justify-center">
                              <span
                                className={`${textMutedClass} text-xs font-medium`}
                              >
                                {index + 1}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </div>

              {/* Footer */}
              {templates.length > 0 && (
                <div className="mt-3 pt-2 border-t border-gray-200/50 dark:border-white/10">
                  <div className="flex items-center justify-center">
                    <div className={`${textMutedClass} text-xs text-center`}>
                      {templates.length} gesture
                      {templates.length !== 1 ? "s" : ""} saved
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Floating Save Panel */}
      {showSavePanel && (
        <div className="absolute inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="max-w-md w-full mx-4">
            <div
              className={`${panelClass} rounded-2xl p-6 shadow-2xl border border-white/20`}
            >
              {/* Header */}
              <div className="text-center mb-6">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-600/20 mb-3">
                  <Save className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
                </div>
                <h3 className={`${textClass} font-semibold text-lg mb-1`}>
                  Save Gesture
                </h3>
                <p className={`${textMutedClass} text-sm`}>
                  Create a new template from your gesture
                </p>
              </div>

              {/* Form */}
              <div className="space-y-4">
                <div className="space-y-1">
                  <Label
                    className={`${textSecondaryClass} text-sm font-medium`}
                  >
                    Gesture Name
                  </Label>
                  <Input
                    placeholder="e.g., Wave Hello"
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)}
                    className="h-10 bg-gray-50/80 border-gray-200 text-gray-900 placeholder:text-gray-500 dark:bg-white/5 dark:border-white/20 dark:text-white dark:placeholder:text-white/50 rounded-lg"
                    autoFocus
                  />
                </div>

                <div className="space-y-1">
                  <Label
                    className={`${textSecondaryClass} text-sm font-medium`}
                  >
                    Command <span className="text-gray-400">(Optional)</span>
                  </Label>
                  <Input
                    placeholder="e.g., open /Applications/Spotify.app"
                    value={templateCommand}
                    onChange={(e) => setTemplateCommand(e.target.value)}
                    className="h-10 bg-gray-50/80 border-gray-200 text-gray-900 placeholder:text-gray-500 dark:bg-white/5 dark:border-white/20 dark:text-white dark:placeholder:text-white/50 rounded-lg"
                  />
                </div>

                {/* Gesture Preview */}
                <div className="p-3 rounded-lg bg-gray-50/80 dark:bg-white/5 border border-gray-200/50 dark:border-white/10">
                  <div className="flex items-center justify-between">
                    <span className={`${textMutedClass} text-sm`}>
                      Trajectory Points
                    </span>
                    <span className="text-emerald-600 dark:text-emerald-400 text-sm font-medium">
                      {trajectory.length} points
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex space-x-3 pt-2">
                  <Button
                    onClick={() => setShowSavePanel(false)}
                    variant="ghost"
                    className="flex-1 h-10 bg-gray-50/80 hover:bg-gray-100/80 dark:bg-white/5 dark:hover:bg-white/10 border border-gray-200/50 dark:border-white/10 text-gray-700 dark:text-white/90 rounded-lg"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={saveTemplate}
                    disabled={!templateName.trim() || trajectory.length < 2}
                    className="flex-1 h-10 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white rounded-lg shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40 transition-all duration-300 hover:scale-[1.02] border-0"
                  >
                    <Save className="w-3 h-3 mr-1" />
                    Save Template
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Floating Bottom Stats */}
      <div className="absolute bottom-6 left-6 z-40 font-normal">
        <div className={`${panelClass} rounded-xl px-2 py-1 shadow-lg`}>
          <div
            className={`flex items-center space-x-3 ${textSecondaryClass} text-sm`}
          >
            <div className="flex items-center space-x-2 text-xs">
              <div
                className={`w-2 h-2 rounded-full ${
                  isConnected ? "bg-green-500" : "bg-red-500"
                }`}
              />
              <span>Backend</span>
            </div>
            <div className="w-px h-4 bg-gray-300 dark:bg-white/20" />
            <div className="flex items-center space-x-2 text-xs">
              <Activity className="w-3 h-3" />
              <span>{isConnected ? "30" : "-"} FPS</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <>
      <AppContent />
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: "rgba(0, 0, 0, 0.8)",
            color: "white",
            border: "1px solid rgba(255, 255, 255, 0.1)",
            backdropFilter: "blur(16px)",
          },
        }}
      />
    </>
  );
}
