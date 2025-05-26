import { create } from "zustand";
import { Template } from "@/types";
import { toast } from "sonner";

// Types for the store
interface AppState {
  // Connection & tracking state
  isConnected: boolean;
  connectionError: string | null;
  isDrawing: boolean;

  // Detection & trajectory state
  fingerDetection: any | null;
  trajectory: Array<{ x: number; y: number }>;
  lastGestureResult: any | null;

  // Auto-start detection state
  isWaitingToStart: boolean;

  // Template management
  templates: Template[];
  templateName: string;
  templateCommand: string;

  // Settings state
  handDetectionConfidence: number;
  gestureConfidence: number;
  autoStartDelay: number;
  autoRecognitionDelay: number;

  // Theme state
  isDarkMode: boolean;

  // UI state
  showTemplates: boolean;
  showSavePanel: boolean;
  loadingToastId: string | number | null;

  // Actions
  setIsConnected: (connected: boolean) => void;
  setConnectionError: (error: string | null) => void;
  setIsDrawing: (drawing: boolean) => void;
  setFingerDetection: (detection: any | null) => void;
  setTrajectory: (trajectory: Array<{ x: number; y: number }>) => void;
  addTrajectoryPoint: (point: { x: number; y: number }) => void;
  clearTrajectory: () => void;
  setLastGestureResult: (result: any | null) => void;
  setIsWaitingToStart: (waiting: boolean) => void;
  setTemplates: (templates: Template[]) => void;
  addTemplate: (template: Template) => void;
  removeTemplate: (templateId: string) => void;
  setTemplateName: (name: string) => void;
  setTemplateCommand: (command: string) => void;
  setHandDetectionConfidence: (confidence: number) => void;
  setGestureConfidence: (confidence: number) => void;
  setAutoStartDelay: (delay: number) => void;
  setAutoRecognitionDelay: (delay: number) => void;
  setIsDarkMode: (darkMode: boolean) => void;
  toggleTheme: () => void;
  setShowTemplates: (show: boolean) => void;
  setShowSavePanel: (show: boolean) => void;
  setLoadingToastId: (id: string | number | null) => void;

  // Complex actions
  loadTemplatesFromStorage: () => void;
  saveTemplatesToStorage: () => void;
  saveTemplate: () => void;
  updateTemplate: (
    templateId: string,
    updates: Partial<Pick<Template, "name" | "command">>
  ) => void;
  deleteTemplate: (templateId: string) => void;
  clearGesture: () => void;

  // Toast management
  dismissLoadingToast: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  // Initial state
  isConnected: false,
  connectionError: null,
  isDrawing: false,
  fingerDetection: null,
  trajectory: [],
  lastGestureResult: null,
  isWaitingToStart: false,
  templates: [],
  templateName: "",
  templateCommand: "",
  handDetectionConfidence: 0.75,
  gestureConfidence: 0.85,
  autoStartDelay: 0.5,
  autoRecognitionDelay: 0.7,
  isDarkMode: true,
  showTemplates: false,
  showSavePanel: false,
  loadingToastId: null,

  // Simple setters
  setIsConnected: (connected) => set({ isConnected: connected }),
  setConnectionError: (error) => set({ connectionError: error }),
  setIsDrawing: (drawing) => set({ isDrawing: drawing }),
  setFingerDetection: (detection) => set({ fingerDetection: detection }),
  setTrajectory: (trajectory) => set({ trajectory }),
  setLastGestureResult: (result) => set({ lastGestureResult: result }),
  setIsWaitingToStart: (waiting) => set({ isWaitingToStart: waiting }),
  setTemplates: (templates) => set({ templates }),
  setTemplateName: (name) => set({ templateName: name }),
  setTemplateCommand: (command) => set({ templateCommand: command }),
  setHandDetectionConfidence: (confidence) =>
    set({ handDetectionConfidence: confidence }),
  setGestureConfidence: (confidence) => set({ gestureConfidence: confidence }),
  setAutoStartDelay: (delay) => set({ autoStartDelay: delay }),
  setIsDarkMode: (darkMode) => set({ isDarkMode: darkMode }),
  setShowTemplates: (show) => set({ showTemplates: show }),
  setShowSavePanel: (show) => set({ showSavePanel: show }),
  setLoadingToastId: (id) => set({ loadingToastId: id }),
  setAutoRecognitionDelay: (delay) => set({ autoRecognitionDelay: delay }),

  // Trajectory actions
  addTrajectoryPoint: (point) => {
    const state = get();
    const prev = state.trajectory;

    // Only add if it's different enough from the last point
    if (
      prev.length === 0 ||
      Math.abs(prev[prev.length - 1].x - point.x) > 0.005 ||
      Math.abs(prev[prev.length - 1].y - point.y) > 0.005
    ) {
      set({ trajectory: [...prev, point] });
    }
  },

  clearTrajectory: () => set({ trajectory: [], lastGestureResult: null }),

  // Template actions
  addTemplate: (template) => {
    const state = get();
    const updatedTemplates = [...state.templates, template];
    set({ templates: updatedTemplates });
    get().saveTemplatesToStorage();
  },

  removeTemplate: (templateId) => {
    const state = get();
    const updatedTemplates = state.templates.filter((t) => t.id !== templateId);
    set({ templates: updatedTemplates });
    get().saveTemplatesToStorage();
  },

  // Theme actions
  toggleTheme: () => {
    const state = get();
    const newDarkMode = !state.isDarkMode;

    if (newDarkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }

    set({ isDarkMode: newDarkMode });
  },

  // Storage actions
  loadTemplatesFromStorage: () => {
    try {
      const stored = localStorage.getItem("gesture-templates");
      if (stored) {
        const loadedTemplates = JSON.parse(stored);
        set({ templates: loadedTemplates });
        console.log(
          "📁 Loaded",
          loadedTemplates.length,
          "templates from localStorage"
        );
      } else {
        console.log("📁 No templates found in localStorage");
      }
    } catch (error) {
      console.error("Failed to load templates from storage:", error);
    }
  },

  saveTemplatesToStorage: () => {
    try {
      const state = get();
      localStorage.setItem(
        "gesture-templates",
        JSON.stringify(state.templates)
      );
      console.log(
        "💾 Saved",
        state.templates.length,
        "templates to localStorage"
      );
    } catch (error) {
      console.error("Failed to save templates to storage:", error);
    }
  },

  // Complex actions
  saveTemplate: () => {
    const state = get();

    if (!state.templateName.trim()) {
      toast.error("Please enter a template name");
      return;
    }

    if (state.trajectory.length < 2) {
      toast.error("Please record a gesture first");
      return;
    }

    const template: Template = {
      id: `template_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: state.templateName,
      command: state.templateCommand || "",
      points: state.trajectory.map(
        (point) => [point.x, point.y] as [number, number]
      ),
    };

    try {
      // Add template and save to storage
      get().addTemplate(template);

      // Clear UI state
      set({
        templateName: "",
        templateCommand: "",
        trajectory: [],
        lastGestureResult: null,
        showSavePanel: false,
      });

      console.log(
        "💾 Template saved:",
        template.name,
        "Total templates:",
        state.templates.length + 1
      );
      toast.success(`Template "${template.name}" saved successfully!`);
    } catch (error) {
      console.error("❌ Failed to save template:", error);
      toast.error("Failed to save template");
    }
  },

  updateTemplate: (templateId, updates) => {
    const state = get();
    const templateToUpdate = state.templates.find((t) => t.id === templateId);

    if (!templateToUpdate) {
      toast.error("Template not found");
      return;
    }

    const updatedTemplates = state.templates.map((template) =>
      template.id === templateId ? { ...template, ...updates } : template
    );

    set({ templates: updatedTemplates });
    get().saveTemplatesToStorage();

    console.log("✏️ Template updated:", templateToUpdate.name, "->", updates);
    toast.success(
      `Template "${
        updates.name || templateToUpdate.name
      }" updated successfully!`
    );
  },

  deleteTemplate: (templateId) => {
    const state = get();
    const templateToDelete = state.templates.find((t) => t.id === templateId);

    if (!templateToDelete) {
      toast.error("Template not found");
      return;
    }

    get().removeTemplate(templateId);
    console.log(
      "🗑️ Template deleted:",
      templateToDelete.name,
      "Remaining templates:",
      state.templates.length - 1
    );
    toast.success(`Template "${templateToDelete.name}" deleted`);
  },

  clearGesture: () => {
    set({ trajectory: [], lastGestureResult: null });
    toast.success("Gesture cleared");
  },

  // Toast management
  dismissLoadingToast: () => {
    const state = get();
    if (state.loadingToastId) {
      toast.dismiss(state.loadingToastId);
      set({ loadingToastId: null });
      console.log("🎯 Loading toast dismissed");
    }
  },
}));
