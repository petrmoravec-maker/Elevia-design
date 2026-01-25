// Electrical Symbol Library

export interface ElectricalSymbol {
  id: string;
  name: string;
  icon: string;
  category: 'outlet' | 'switch' | 'light' | 'panel' | 'misc';
  voltage?: 120 | 240;
  defaultLoad?: number; // watts
}

export const ELECTRICAL_SYMBOLS: ElectricalSymbol[] = [
  // Outlets
  { id: 'outlet_duplex', name: 'Duplex Outlet', icon: '⊙', category: 'outlet', voltage: 120 },
  { id: 'outlet_gfci', name: 'GFCI Outlet', icon: '⊙G', category: 'outlet', voltage: 120 },
  { id: 'outlet_240v', name: '240V Outlet', icon: '⊙240', category: 'outlet', voltage: 240 },
  { id: 'outlet_dedicated', name: 'Dedicated Circuit', icon: '⊙D', category: 'outlet', voltage: 120 },
  { id: 'outlet_quad', name: 'Quad Outlet', icon: '⊙⊙', category: 'outlet', voltage: 120 },
  
  // Switches
  { id: 'switch_single', name: 'Single-Pole Switch', icon: 'S', category: 'switch' },
  { id: 'switch_3way', name: '3-Way Switch', icon: 'S3', category: 'switch' },
  { id: 'switch_dimmer', name: 'Dimmer Switch', icon: 'SD', category: 'switch' },
  { id: 'switch_timer', name: 'Timer Switch', icon: 'ST', category: 'switch' },
  
  // Lights
  { id: 'light_recessed', name: 'Recessed Light', icon: '○', category: 'light', defaultLoad: 15 },
  { id: 'light_surface', name: 'Surface Mount', icon: '□', category: 'light', defaultLoad: 20 },
  { id: 'light_emergency', name: 'Emergency Light', icon: 'EM', category: 'light', defaultLoad: 10 },
  { id: 'light_exit', name: 'Exit Sign', icon: 'EXIT', category: 'light', defaultLoad: 5 },
  { id: 'light_fluorescent', name: 'Fluorescent Fixture', icon: '═', category: 'light', defaultLoad: 40 },
  
  // Panels
  { id: 'panel_100a', name: '100A Panel', icon: '▣100', category: 'panel', voltage: 240 },
  { id: 'panel_200a', name: '200A Panel', icon: '▣200', category: 'panel', voltage: 240 },
  { id: 'panel_400a', name: '400A Panel', icon: '▣400', category: 'panel', voltage: 240 },
  { id: 'subpanel_60a', name: '60A Sub-Panel', icon: '▢60', category: 'panel', voltage: 240 },
  { id: 'subpanel_100a', name: '100A Sub-Panel', icon: '▢100', category: 'panel', voltage: 240 },
  
  // Misc
  { id: 'junction_box', name: 'Junction Box', icon: 'J', category: 'misc' },
  { id: 'disconnect', name: 'Disconnect', icon: 'D', category: 'misc' },
  { id: 'transformer', name: 'Transformer', icon: 'T', category: 'misc' },
  { id: 'meter', name: 'Electric Meter', icon: 'M', category: 'misc' },
];

export interface PanelConfig {
  id: string;
  name: string;
  slots: number;
  mainBreaker: number; // amps
  voltage: 120 | 240;
}

export const PANEL_CONFIGS: PanelConfig[] = [
  { id: 'panel_100a', name: '100A Panel', slots: 24, mainBreaker: 100, voltage: 240 },
  { id: 'panel_200a', name: '200A Panel', slots: 42, mainBreaker: 200, voltage: 240 },
  { id: 'panel_400a', name: '400A Panel', slots: 84, mainBreaker: 400, voltage: 240 },
  { id: 'subpanel_60a', name: '60A Sub-Panel', slots: 12, mainBreaker: 60, voltage: 240 },
  { id: 'subpanel_100a', name: '100A Sub-Panel', slots: 24, mainBreaker: 100, voltage: 240 },
];

export interface BreakerSize {
  amps: number;
  poles: 1 | 2;
  maxWatts120: number;
  maxWatts240: number;
}

export const BREAKER_SIZES: BreakerSize[] = [
  { amps: 15, poles: 1, maxWatts120: 1440, maxWatts240: 0 },
  { amps: 20, poles: 1, maxWatts120: 1920, maxWatts240: 0 },
  { amps: 15, poles: 2, maxWatts120: 0, maxWatts240: 2880 },
  { amps: 20, poles: 2, maxWatts120: 0, maxWatts240: 3840 },
  { amps: 30, poles: 2, maxWatts120: 0, maxWatts240: 5760 },
  { amps: 40, poles: 2, maxWatts120: 0, maxWatts240: 7680 },
  { amps: 50, poles: 2, maxWatts120: 0, maxWatts240: 9600 },
  { amps: 60, poles: 2, maxWatts120: 0, maxWatts240: 11520 },
];

export function getSymbolsByCategory(category: ElectricalSymbol['category']): ElectricalSymbol[] {
  return ELECTRICAL_SYMBOLS.filter(s => s.category === category);
}

export function suggestBreakerSize(watts: number, voltage: 120 | 240): BreakerSize | undefined {
  const safetyFactor = 0.8; // 80% rule
  const sortedBreakers = BREAKER_SIZES
    .filter(b => voltage === 120 ? b.poles === 1 : b.poles === 2)
    .sort((a, b) => a.amps - b.amps);
  
  const maxWattsKey = voltage === 120 ? 'maxWatts120' : 'maxWatts240';
  
  return sortedBreakers.find(b => b[maxWattsKey] * safetyFactor >= watts);
}
