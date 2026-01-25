// Room Type Templates - Define room characteristics and typical requirements

export interface RoomType {
  id: string;
  name: string;
  icon: string;
  color: string;
  typicalEquipment: string[]; // Equipment IDs
  requiresDrain: boolean;
  requiresWater: boolean;
  powerDensity: 'low' | 'medium' | 'high';
  description: string;
}

export const ROOM_TYPES: RoomType[] = [
  {
    id: 'grow_veg',
    name: 'Vegetative Room',
    icon: '🌱',
    color: '#22c55e',
    typicalEquipment: ['led_bar_320w', 'minisplit_18k', 'dehu_90ppd', 'inline_fan_6in'],
    requiresDrain: true,
    requiresWater: true,
    powerDensity: 'high',
    description: 'Room for vegetative growth stage with 18/6 light cycle',
  },
  {
    id: 'grow_flower',
    name: 'Flower Room',
    icon: '🌸',
    color: '#a855f7',
    typicalEquipment: ['led_bar_630w', 'minisplit_24k', 'dehu_180ppd', 'inline_fan_8in', 'co2_controller'],
    requiresDrain: true,
    requiresWater: true,
    powerDensity: 'high',
    description: 'Room for flowering stage with 12/12 light cycle',
  },
  {
    id: 'clone',
    name: 'Clone Room',
    icon: '🧬',
    color: '#06b6d4',
    typicalEquipment: ['led_bar_320w', 'dehu_90ppd'],
    requiresDrain: true,
    requiresWater: true,
    powerDensity: 'medium',
    description: 'Room for cloning and propagation',
  },
  {
    id: 'dry',
    name: 'Dry Room',
    icon: '🍂',
    color: '#f97316',
    typicalEquipment: ['dehu_130ppd', 'inline_fan_6in'],
    requiresDrain: true,
    requiresWater: false,
    powerDensity: 'medium',
    description: 'Room for drying harvested material',
  },
  {
    id: 'cure',
    name: 'Cure Room',
    icon: '🫙',
    color: '#eab308',
    typicalEquipment: ['dehu_90ppd', 'minisplit_12k'],
    requiresDrain: false,
    requiresWater: false,
    powerDensity: 'low',
    description: 'Room for curing and long-term storage',
  },
  {
    id: 'processing',
    name: 'Processing Area',
    icon: '⚙️',
    color: '#64748b',
    typicalEquipment: ['trim_machine', 'vacuum_sealer', 'scale_industrial'],
    requiresDrain: true,
    requiresWater: true,
    powerDensity: 'medium',
    description: 'Area for trimming, packaging, and processing',
  },
  {
    id: 'utility',
    name: 'Utility/Mechanical',
    icon: '🔧',
    color: '#6b7280',
    typicalEquipment: [],
    requiresDrain: true,
    requiresWater: true,
    powerDensity: 'high',
    description: 'Room for electrical panels, HVAC equipment, water systems',
  },
  {
    id: 'storage',
    name: 'Storage',
    icon: '📦',
    color: '#78716c',
    typicalEquipment: [],
    requiresDrain: false,
    requiresWater: false,
    powerDensity: 'low',
    description: 'General storage area',
  },
  {
    id: 'office',
    name: 'Office',
    icon: '🏢',
    color: '#3b82f6',
    typicalEquipment: [],
    requiresDrain: false,
    requiresWater: false,
    powerDensity: 'low',
    description: 'Office and administrative space',
  },
  {
    id: 'bathroom',
    name: 'Bathroom',
    icon: '🚻',
    color: '#0ea5e9',
    typicalEquipment: [],
    requiresDrain: true,
    requiresWater: true,
    powerDensity: 'low',
    description: 'Restroom facilities',
  },
];

export function getRoomTypeById(id: string): RoomType | undefined {
  return ROOM_TYPES.find(r => r.id === id);
}

export function getRoomTypesByPowerDensity(density: 'low' | 'medium' | 'high'): RoomType[] {
  return ROOM_TYPES.filter(r => r.powerDensity === density);
}
