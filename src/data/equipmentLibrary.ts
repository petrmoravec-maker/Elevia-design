// Default Equipment Library - Cultivation-specific items with specs

export interface EquipmentItem {
  id: string;
  name: string;
  category: string;
  watts: number;
  voltage: 120 | 240;
  amperage?: number;
  drain: boolean;
  water: boolean;
  // Category-specific fields
  btu?: number; // HVAC
  ppdCapacity?: number; // Dehumidifier (pints per day)
  ppfd?: number; // Lighting
  spectrum?: string; // Lighting
  coverage?: number; // Lighting (m²)
  zones?: number; // Irrigation
  gpm?: number; // Irrigation
}

export interface EquipmentCategory {
  id: string;
  name: string;
  icon: string;
}

export const EQUIPMENT_CATEGORIES: EquipmentCategory[] = [
  { id: 'lighting', name: 'Lighting', icon: '💡' },
  { id: 'hvac', name: 'HVAC', icon: '❄️' },
  { id: 'dehumidifier', name: 'Dehumidifier', icon: '💨' },
  { id: 'irrigation', name: 'Irrigation', icon: '💧' },
  { id: 'processing', name: 'Processing', icon: '⚙️' },
  { id: 'ventilation', name: 'Ventilation', icon: '🌀' },
  { id: 'co2', name: 'CO2 Systems', icon: '🫧' },
];

export const DEFAULT_EQUIPMENT: Record<string, EquipmentItem[]> = {
  lighting: [
    { id: 'led_bar_630w', name: 'LED Bar 630W', category: 'lighting', watts: 630, voltage: 240, drain: false, water: false, ppfd: 1800, spectrum: 'Full', coverage: 4.5 },
    { id: 'led_bar_320w', name: 'LED Bar 320W', category: 'lighting', watts: 320, voltage: 240, drain: false, water: false, ppfd: 1200, spectrum: 'Full', coverage: 2.5 },
    { id: 'led_bar_480w', name: 'LED Bar 480W', category: 'lighting', watts: 480, voltage: 240, drain: false, water: false, ppfd: 1500, spectrum: 'Full', coverage: 3.5 },
    { id: 'hps_1000w', name: 'HPS 1000W', category: 'lighting', watts: 1150, voltage: 240, drain: false, water: false, ppfd: 1600, spectrum: 'HPS', coverage: 4 },
    { id: 'hps_600w', name: 'HPS 600W', category: 'lighting', watts: 700, voltage: 240, drain: false, water: false, ppfd: 1000, spectrum: 'HPS', coverage: 3 },
  ],
  hvac: [
    { id: 'minisplit_12k', name: 'Mini-Split 12K BTU', category: 'hvac', watts: 1200, voltage: 240, drain: true, water: false, btu: 12000 },
    { id: 'minisplit_18k', name: 'Mini-Split 18K BTU', category: 'hvac', watts: 1800, voltage: 240, drain: true, water: false, btu: 18000 },
    { id: 'minisplit_24k', name: 'Mini-Split 24K BTU', category: 'hvac', watts: 2400, voltage: 240, drain: true, water: false, btu: 24000 },
    { id: 'minisplit_36k', name: 'Mini-Split 36K BTU', category: 'hvac', watts: 3600, voltage: 240, drain: true, water: false, btu: 36000 },
    { id: 'portable_ac_14k', name: 'Portable AC 14K BTU', category: 'hvac', watts: 1400, voltage: 120, drain: true, water: false, btu: 14000 },
  ],
  dehumidifier: [
    { id: 'dehu_90ppd', name: 'Dehumidifier 90 PPD', category: 'dehumidifier', watts: 850, voltage: 120, drain: true, water: false, ppdCapacity: 90 },
    { id: 'dehu_130ppd', name: 'Dehumidifier 130 PPD', category: 'dehumidifier', watts: 1200, voltage: 240, drain: true, water: false, ppdCapacity: 130 },
    { id: 'dehu_180ppd', name: 'Dehumidifier 180 PPD', category: 'dehumidifier', watts: 1650, voltage: 240, drain: true, water: false, ppdCapacity: 180 },
    { id: 'dehu_250ppd', name: 'Dehumidifier 250 PPD', category: 'dehumidifier', watts: 2200, voltage: 240, drain: true, water: false, ppdCapacity: 250 },
  ],
  irrigation: [
    { id: 'irrigation_controller', name: 'Irrigation Controller', category: 'irrigation', watts: 50, voltage: 120, drain: false, water: true, zones: 8 },
    { id: 'dosing_pump', name: 'Dosing Pump', category: 'irrigation', watts: 30, voltage: 120, drain: false, water: true, gpm: 0.5 },
    { id: 'water_pump_1hp', name: 'Water Pump 1HP', category: 'irrigation', watts: 750, voltage: 240, drain: false, water: true, gpm: 20 },
    { id: 'ro_system', name: 'RO System', category: 'irrigation', watts: 100, voltage: 120, drain: true, water: true },
  ],
  processing: [
    { id: 'trim_machine', name: 'Trim Machine', category: 'processing', watts: 500, voltage: 120, drain: false, water: false },
    { id: 'extraction_unit', name: 'Extraction Unit', category: 'processing', watts: 2000, voltage: 240, drain: true, water: true },
    { id: 'vacuum_sealer', name: 'Vacuum Sealer', category: 'processing', watts: 300, voltage: 120, drain: false, water: false },
    { id: 'scale_industrial', name: 'Industrial Scale', category: 'processing', watts: 50, voltage: 120, drain: false, water: false },
  ],
  ventilation: [
    { id: 'inline_fan_6in', name: 'Inline Fan 6"', category: 'ventilation', watts: 150, voltage: 120, drain: false, water: false },
    { id: 'inline_fan_8in', name: 'Inline Fan 8"', category: 'ventilation', watts: 300, voltage: 120, drain: false, water: false },
    { id: 'inline_fan_12in', name: 'Inline Fan 12"', category: 'ventilation', watts: 600, voltage: 240, drain: false, water: false },
    { id: 'carbon_filter', name: 'Carbon Filter', category: 'ventilation', watts: 0, voltage: 120, drain: false, water: false },
  ],
  co2: [
    { id: 'co2_controller', name: 'CO2 Controller', category: 'co2', watts: 20, voltage: 120, drain: false, water: false },
    { id: 'co2_burner', name: 'CO2 Burner', category: 'co2', watts: 50, voltage: 120, drain: false, water: false },
  ],
};

export function getEquipmentById(id: string): EquipmentItem | undefined {
  for (const category of Object.values(DEFAULT_EQUIPMENT)) {
    const item = category.find(e => e.id === id);
    if (item) return item;
  }
  return undefined;
}

export function getAllEquipment(): EquipmentItem[] {
  return Object.values(DEFAULT_EQUIPMENT).flat();
}

export function getEquipmentByCategory(categoryId: string): EquipmentItem[] {
  return DEFAULT_EQUIPMENT[categoryId] || [];
}
