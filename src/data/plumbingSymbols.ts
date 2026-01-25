// Plumbing Symbol Library

export interface PlumbingSymbol {
  id: string;
  name: string;
  icon: string;
  category: 'supply' | 'valve' | 'fixture' | 'drain';
  lineStyle?: 'solid' | 'dashed';
  color?: string;
  size?: string; // pipe diameter
}

export const PLUMBING_SYMBOLS: PlumbingSymbol[] = [
  // Supply lines
  { id: 'line_cold', name: 'Cold Water Line', icon: '―', category: 'supply', lineStyle: 'solid', color: '#3b82f6' },
  { id: 'line_hot', name: 'Hot Water Line', icon: '- -', category: 'supply', lineStyle: 'dashed', color: '#ef4444' },
  { id: 'supply_entry', name: 'Water Supply Entry', icon: '▼W', category: 'supply' },
  { id: 'line_irrigation', name: 'Irrigation Line', icon: '···', category: 'supply', lineStyle: 'dashed', color: '#22c55e' },
  
  // Valves
  { id: 'valve_gate', name: 'Gate Valve', icon: '◇', category: 'valve' },
  { id: 'valve_ball', name: 'Ball Valve', icon: '●', category: 'valve' },
  { id: 'valve_prv', name: 'Pressure Reducing Valve', icon: 'PRV', category: 'valve' },
  { id: 'valve_check', name: 'Check Valve', icon: '◁', category: 'valve' },
  { id: 'valve_shutoff', name: 'Shutoff Valve', icon: '⊗', category: 'valve' },
  { id: 'valve_solenoid', name: 'Solenoid Valve', icon: 'SV', category: 'valve' },
  
  // Fixtures
  { id: 'fixture_hose_bib', name: 'Hose Bib', icon: 'HB', category: 'fixture' },
  { id: 'fixture_floor_sink', name: 'Floor Sink', icon: 'FS', category: 'fixture' },
  { id: 'fixture_mop_sink', name: 'Mop Sink', icon: 'MS', category: 'fixture' },
  { id: 'fixture_sink', name: 'Sink', icon: '◠', category: 'fixture' },
  { id: 'fixture_toilet', name: 'Toilet', icon: 'WC', category: 'fixture' },
  { id: 'fixture_water_heater', name: 'Water Heater', icon: 'WH', category: 'fixture' },
  
  // Drain
  { id: 'drain_floor_2', name: '2" Floor Drain', icon: 'FD2', category: 'drain', size: '2"' },
  { id: 'drain_floor_3', name: '3" Floor Drain', icon: 'FD3', category: 'drain', size: '3"' },
  { id: 'drain_floor_4', name: '4" Floor Drain', icon: 'FD4', category: 'drain', size: '4"' },
  { id: 'drain_line', name: 'Drain Line', icon: '- -', category: 'drain', lineStyle: 'dashed', color: '#6b7280' },
  { id: 'drain_cleanout', name: 'Cleanout', icon: 'CO', category: 'drain' },
  { id: 'drain_ptrap', name: 'P-Trap', icon: '∪', category: 'drain' },
  { id: 'drain_vent', name: 'Vent Pipe', icon: 'V', category: 'drain' },
  { id: 'drain_sewer', name: 'Sewer Connection', icon: '▼S', category: 'drain' },
];

export interface DrainSlope {
  minPercent: number;
  maxPercent: number;
  description: string;
}

export const DRAIN_SLOPE_REQUIREMENTS: DrainSlope = {
  minPercent: 1,    // 1% minimum (1/8" per foot)
  maxPercent: 4,    // 4% maximum
  description: 'Drain lines require 1-4% slope (typically 2%)',
};

export interface CleanoutRequirements {
  maxDistanceFeet: number;
  description: string;
}

export const CLEANOUT_REQUIREMENTS: CleanoutRequirements = {
  maxDistanceFeet: 50,
  description: 'Cleanouts required every 50 feet and at direction changes',
};

export function getSymbolsByCategory(category: PlumbingSymbol['category']): PlumbingSymbol[] {
  return PLUMBING_SYMBOLS.filter(s => s.category === category);
}

export function validateDrainSlope(slopePercent: number): { valid: boolean; message: string } {
  if (slopePercent < DRAIN_SLOPE_REQUIREMENTS.minPercent) {
    return { valid: false, message: `Slope too shallow. Minimum ${DRAIN_SLOPE_REQUIREMENTS.minPercent}% required.` };
  }
  if (slopePercent > DRAIN_SLOPE_REQUIREMENTS.maxPercent) {
    return { valid: false, message: `Slope too steep. Maximum ${DRAIN_SLOPE_REQUIREMENTS.maxPercent}% recommended.` };
  }
  return { valid: true, message: 'Slope within acceptable range.' };
}
