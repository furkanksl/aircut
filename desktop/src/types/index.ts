export interface Template {
  id: string;
  name: string;
  points: [number, number][];
  command: string;
}

export interface WebSocketMessage {
  type: string;

  // For finger_detection message
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  confidence?: number;
  class?: string;

  // For tracking_stopped message
  trajectory?: [number, number][];

  // For gesture_recognized message
  template_name?: string;
  similarity?: number;
  command?: string;

  // For template_saved message
  id?: string;
  name?: string;

  // For error message
  message?: string;
}
