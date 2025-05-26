"use client";

import { CameraComponent } from "./CameraComponent";
import { Button } from "@/components/ui/button";
import { Sparkles, Trash2, HandIcon } from "lucide-react";

interface VideoFeedProps {
  isConnected: boolean;
  fingerDetection?: {
    x: number;
    y: number;
    width: number;
    height: number;
    confidence: number;
    class: string;
  } | null;
  isTracking: boolean;
  trajectory: Array<{ x: number; y: number }>;
  lastGestureResult?: {
    name: string;
    command: string;
    similarity: number;
  } | null;
  onClearTrajectory?: () => void;
  onRecognizeGesture?: (trajectory: Array<{ x: number; y: number }>) => void;
  onLoadTemplates?: () => void;
  onReconnect?: () => void;
  isActive: boolean;
}

export function VideoFeed({
  isConnected,
  fingerDetection,
  isTracking,
  trajectory,
  lastGestureResult = null,
  onClearTrajectory,
  onRecognizeGesture,
  onReconnect,
  isActive,
}: VideoFeedProps) {
  return (
    <div className="relative w-full max-w-[532px] mx-auto  h-full ">
      {/* Status indicator (minimalist) */}
      {(isTracking || trajectory.length > 0) && (
        <div className="absolute -top-10 left-1/2 transform -translate-x-1/2 z-10">
          <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-black/5 dark:bg-white/10 backdrop-blur-md">
            {isTracking ? (
              <>
                <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse"></span>
                <span className="text-xs font-medium text-gray-700 dark:text-white">
                  Recording • {trajectory.length} points
                </span>
              </>
            ) : trajectory.length > 0 ? (
              <span className="text-xs font-medium text-gray-700 dark:text-white">
                {trajectory.length} points captured
              </span>
            ) : null}
          </div>
        </div>
      )}

      {/* Camera Feed - No border, clean design */}
      <div className="relative w-full  rounded-2xl overflow-hidden bg-gray-50 dark:bg-slate-800  h-full">
        <CameraComponent
          isConnected={isConnected && isActive}
          isTracking={isTracking}
          trajectory={trajectory}
          onReconnect={onReconnect}
          lastGestureResult={lastGestureResult}
          showGestureResult={false}
          showRecordingStatus={false}
          className="w-full h-full object-cover"
        />

        {/* Minimal controls overlay */}
        <div className="absolute inset-0 pointer-events-none">
          {/* Action buttons - only show when needed */}
          {trajectory.length > 0 && !isTracking && (
            <div className="absolute bottom-4 right-4 flex gap-2 pointer-events-auto">
              {onRecognizeGesture && (
                <Button
                  onClick={() => onRecognizeGesture(trajectory)}
                  className="h-9 bg-gray-800/40 hover:bg-gray-800/60 dark:bg-white/20 dark:hover:bg-white/30 backdrop-blur-md text-white border-0 rounded-full shadow-md"
                >
                  <Sparkles className="w-4 h-4" strokeWidth={1.5} />
                  Recognize
                </Button>
              )}

              {onClearTrajectory && (
                <Button
                  onClick={onClearTrajectory}
                  variant="outline"
                  className="h-9 w-9 p-0 bg-gray-800/40 hover:bg-gray-800/60 dark:bg-white/10 dark:hover:bg-white/20 backdrop-blur-md text-white border-0 rounded-full shadow-md"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </div>
          )}

          {/* Hand detection indicator */}
          {isConnected && fingerDetection && (
            <div className="absolute bottom-4 right-4 flex items-center gap-2 px-3 py-1.5 rounded-full bg-gray-800/40 dark:bg-white/10 backdrop-blur-md">
              <HandIcon className="w-4 h-4 text-white dark:text-white" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
