export interface Keyframe {
  position: number;
  name: string;
  posX: number;
  posY: number;
  posZ: number;
  rotX: number;
  rotY: number;
  rotZ: number;
}

export interface BreakpointConfig {
  minWidth: number;
  maxXRange: number;
  keyframes: Keyframe[];
}

export interface Config {
  name: string;
  splineUrl: string;
  targetObject: string | null;
  originalPosition: { x: number; y: number; z: number } | null;
  backgroundColor: string;
  backgroundImage: string | null;
  backgroundMode: 'color' | 'picture';
  scrollPosition: number;
  livePreview: boolean;
  activeBreakpoint: 'monitor' | 'desktop' | 'laptop' | 'tablet' | 'mobile';
  breakpoints: {
    monitor: BreakpointConfig;
    desktop: BreakpointConfig;
    laptop: BreakpointConfig;
    tablet: BreakpointConfig;
    mobile: BreakpointConfig;
  };
}

export interface SplineApp {
  _scene: any;
  _runtime: {
    _renderer: {
      render: () => void;
    };
  };
  findObjectByName: (name: string) => any;
  emitEvent: (event: string, data?: any) => void;
  load: (url: string) => Promise<void>;
}

export const BREAKPOINT_LABELS: Record<string, string> = {
  monitor: 'Monitor',
  desktop: 'Desktop',
  laptop: 'Laptop',
  tablet: 'Tablet',
  mobile: 'Mobile'
};

export const DEFAULT_CONFIG: Config = {
  name: 'Untitled Config',
  splineUrl: '',
  targetObject: null,
  originalPosition: null,
  backgroundColor: '#0a0a0f',
  backgroundImage: null,
  backgroundMode: 'color',
  scrollPosition: 0,
  livePreview: false,
  activeBreakpoint: 'laptop',
  breakpoints: {
    monitor: { minWidth: 1440, maxXRange: 500, keyframes: [] },
    desktop: { minWidth: 1280, maxXRange: 500, keyframes: [] },
    laptop: { minWidth: 992, maxXRange: 500, keyframes: [] },
    tablet: { minWidth: 768, maxXRange: 500, keyframes: [] },
    mobile: { minWidth: 0, maxXRange: 500, keyframes: [] }
  }
};

