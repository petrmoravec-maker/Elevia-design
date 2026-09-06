/**
 * DXF Parser Service
 * Parses DXF files and extracts geometry for 1:1 rendering
 */

import DxfParser from 'dxf-parser';

export interface DxfPoint {
  x: number;
  y: number;
  z?: number;
}

export interface DxfEntity {
  id: string;
  type: string;
  layer: string;
  color?: number;
  // Line/Polyline
  vertices?: DxfPoint[];
  // Circle/Arc
  center?: DxfPoint;
  radius?: number;
  startAngle?: number;
  endAngle?: number;
  // Text
  text?: string;
  position?: DxfPoint;
  height?: number;
  rotation?: number;
  // Insert (Block reference)
  blockName?: string;
  insertPoint?: DxfPoint;
  scale?: { x: number; y: number; z: number };
}

export interface DxfLayer {
  name: string;
  color: number;
  visible: boolean;
}

export interface ParsedDxf {
  layers: DxfLayer[];
  entities: DxfEntity[];
  bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
  units?: string;
}

/**
 * Full AutoCAD Color Index (ACI) to hex mapping for all 256 standard colors.
 * Colors 1-9 are standard colors; 10-249 follow a repeating hue/lightness pattern;
 * 250-255 are grays.
 */
const ACI_COLORS: Record<number, string> = {
  0: '#000000',   // ByBlock
  1: '#FF0000',   // Red
  2: '#FFFF00',   // Yellow
  3: '#00FF00',   // Green
  4: '#00FFFF',   // Cyan
  5: '#0000FF',   // Blue
  6: '#FF00FF',   // Magenta
  7: '#FFFFFF',   // White/Black
  8: '#808080',   // Dark gray
  9: '#C0C0C0',   // Light gray
  10: '#FF0000',  11: '#FF7F7F',  12: '#A50000',  13: '#A57F7F',  14: '#7F0000',  15: '#7F5F5F',
  16: '#FF3F00',  17: '#FF9F7F',  18: '#A52800',  19: '#A5677F',  20: '#7F1E00',  21: '#7F4F5F',
  22: '#FF7F00',  23: '#FFBF7F',  24: '#A55000',  25: '#A5807F',  26: '#7F3E00',  27: '#7F605F',
  28: '#FFBF00',  29: '#FFDF7F',  30: '#A57800',  31: '#A5987F',  32: '#7F5E00',  33: '#7F705F',
  34: '#FFFF00',  35: '#FFFF7F',  36: '#A5A500',  37: '#A5A57F',  38: '#7F7F00',  39: '#7F7F5F',
  40: '#BFFF00',  41: '#DFFF7F',  42: '#7CA500',  43: '#8CA57F',  44: '#5E7F00',  45: '#6A7F5F',
  46: '#7FFF00',  47: '#BFFF7F',  48: '#52A500',  49: '#78A57F',  50: '#3E7F00',  51: '#5B7F5F',
  52: '#3FFF00',  53: '#9FFF7F',  54: '#28A500',  55: '#64A57F',  56: '#1E7F00',  57: '#4C7F5F',
  58: '#00FF00',  59: '#7FFF7F',  60: '#00A500',  61: '#50A57F',  62: '#007F00',  63: '#3D7F5F',
  64: '#00FF3F',  65: '#7FFF9F',  66: '#00A528',  67: '#50A578',  68: '#007F1E',  69: '#3D7F5B',
  70: '#00FF7F',  71: '#7FFFBF',  72: '#00A552',  73: '#50A57C',  74: '#007F3E',  75: '#3D7F5E',
  76: '#00FFBF',  77: '#7FFFDF',  78: '#00A57C',  79: '#50A58C',  80: '#007F5E',  81: '#3D7F6A',
  82: '#00FFFF',  83: '#7FFFFF',  84: '#00A5A5',  85: '#50A5A5',  86: '#007F7F',  87: '#3D7F7F',
  88: '#00BFFF',  89: '#7FDFFF',  90: '#007CA5',  91: '#508CA5',  92: '#005E7F',  93: '#3D6A7F',
  94: '#007FFF',  95: '#7FBFFF',  96: '#0052A5',  97: '#5078A5',  98: '#003E7F',  99: '#3D5B7F',
  100: '#003FFF', 101: '#7F9FFF', 102: '#0028A5', 103: '#5064A5', 104: '#001E7F', 105: '#3D4C7F',
  106: '#0000FF', 107: '#7F7FFF', 108: '#0000A5', 109: '#5050A5', 110: '#00007F', 111: '#3D3D7F',
  112: '#3F00FF', 113: '#9F7FFF', 114: '#2800A5', 115: '#6450A5', 116: '#1E007F', 117: '#4C3D7F',
  118: '#7F00FF', 119: '#BF7FFF', 120: '#5200A5', 121: '#7850A5', 122: '#3E007F', 123: '#5B3D7F',
  124: '#BF00FF', 125: '#DF7FFF', 126: '#7C00A5', 127: '#8C50A5', 128: '#5E007F', 129: '#6A3D7F',
  130: '#FF00FF', 131: '#FF7FFF', 132: '#A500A5', 133: '#A550A5', 134: '#7F007F', 135: '#7F3D7F',
  136: '#FF00BF', 137: '#FF7FDF', 138: '#A5007C', 139: '#A5508C', 140: '#7F005E', 141: '#7F3D6A',
  142: '#FF007F', 143: '#FF7FBF', 144: '#A50052', 145: '#A55078', 146: '#7F003E', 147: '#7F3D5B',
  148: '#FF003F', 149: '#FF7F9F', 150: '#A50028', 151: '#A55064', 152: '#7F001E', 153: '#7F3D4C',
  // 154-249: Extended palette
  154: '#FF0000', 155: '#FF7F7F', 156: '#A50000', 157: '#A57F7F', 158: '#7F0000', 159: '#7F5F5F',
  160: '#BF4040', 161: '#DF8080', 162: '#7C2828', 163: '#8C6464', 164: '#5E1E1E', 165: '#6A4C4C',
  166: '#804040', 167: '#C08080', 168: '#522828', 169: '#786464', 170: '#3E1E1E', 171: '#5B4C4C',
  172: '#FF8040', 173: '#FFC080', 174: '#A55228', 175: '#A57864', 176: '#7F3E1E', 177: '#7F5B4C',
  178: '#FF8000', 179: '#FFBF80', 180: '#A55200', 181: '#A57880', 182: '#7F3E00', 183: '#7F5B60',
  184: '#FF8080', 185: '#FFC0C0', 186: '#A55050', 187: '#A57880', 188: '#7F3C3C', 189: '#7F5B5B',
  190: '#FF6060', 191: '#FFA0A0', 192: '#A53C3C', 193: '#A56060', 194: '#7F2D2D', 195: '#7F4848',
  196: '#FF4040', 197: '#FF8080', 198: '#A52828', 199: '#A55050', 200: '#7F1E1E', 201: '#7F3C3C',
  202: '#E04040', 203: '#F08080', 204: '#922828', 205: '#986464', 206: '#6E1E1E', 207: '#704C4C',
  208: '#C04040', 209: '#E08080', 210: '#7C2828', 211: '#8C6464', 212: '#5C1E1E', 213: '#6A4C4C',
  214: '#A04040', 215: '#C08080', 216: '#662828', 217: '#806464', 218: '#4C1E1E', 219: '#604C4C',
  220: '#804040', 221: '#A08080', 222: '#502828', 223: '#686464', 224: '#3C1E1E', 225: '#504C4C',
  226: '#604040', 227: '#808080', 228: '#3C2828', 229: '#506464', 230: '#2C1E1E', 231: '#3C4C4C',
  232: '#404040', 233: '#606060', 234: '#282828', 235: '#404040', 236: '#1E1E1E', 237: '#2E2E2E',
  238: '#202020', 239: '#404040', 240: '#181818', 241: '#282828', 242: '#101010', 243: '#181818',
  244: '#080808', 245: '#101010', 246: '#000000', 247: '#080808', 248: '#000000', 249: '#000000',
  // Grays 250-255
  250: '#333333', 251: '#505050', 252: '#696969', 253: '#828282', 254: '#BEBEBE', 255: '#FFFFFF',
};

export function getColorFromAci(colorIndex: number): string {
  return ACI_COLORS[colorIndex] ?? '#FFFFFF';
}

export async function parseDxfFile(file: File): Promise<ParsedDxf> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const parser = new DxfParser();
        const dxf = parser.parseSync(content);
        
        if (!dxf) {
          throw new Error('Failed to parse DXF file');
        }
        
        // Extract layers, respecting actual DXF layer frozen/off state
        const layers: DxfLayer[] = [];
        if (dxf.tables?.layer?.layers) {
          for (const [name, layer] of Object.entries(dxf.tables.layer.layers)) {
            const l = layer as any;
            // frozen flag (bit 1 of flags) or off (negative color) means not visible
            const frozen = !!(l.frozen || (l.flags & 1));
            const off = typeof l.color === 'number' && l.color < 0;
            layers.push({
              name,
              color: Math.abs(l.color ?? 7),
              visible: !frozen && !off,
            });
          }
        }
        
        // Build layer map for O(1) lookups during rendering
        const layerMap = new Map<string, DxfLayer>(layers.map(l => [l.name.toLowerCase(), l]));
        
        // Extract entities
        const entities: DxfEntity[] = [];
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        
        const updateBounds = (x: number, y: number) => {
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        };
        
        if (dxf.entities) {
          dxf.entities.forEach((entity: any, index: number) => {
            const parsed = parseEntity(entity, index);
            if (parsed) {
              entities.push(parsed);
              
              // Update bounds
              if (parsed.vertices) {
                parsed.vertices.forEach(v => updateBounds(v.x, v.y));
              }
              if (parsed.center) {
                updateBounds(parsed.center.x - (parsed.radius || 0), parsed.center.y - (parsed.radius || 0));
                updateBounds(parsed.center.x + (parsed.radius || 0), parsed.center.y + (parsed.radius || 0));
              }
              if (parsed.position) {
                updateBounds(parsed.position.x, parsed.position.y);
              }
              if (parsed.insertPoint) {
                updateBounds(parsed.insertPoint.x, parsed.insertPoint.y);
              }
            }
          });
        }
        
        // Attach layerMap to the result so Canvas can use it for O(1) lookups
        const result: ParsedDxf & { layerMap?: Map<string, DxfLayer> } = {
          layers,
          entities,
          bounds: {
            minX: minX === Infinity ? 0 : minX,
            minY: minY === Infinity ? 0 : minY,
            maxX: maxX === -Infinity ? 1000 : maxX,
            maxY: maxY === -Infinity ? 1000 : maxY,
          },
        };
        // Attach layerMap as a non-enumerable property to avoid Firestore serialization
        Object.defineProperty(result, 'layerMap', { value: layerMap, enumerable: false });
        
        resolve(result);
        
      } catch (error) {
        console.error('DXF parse error:', error);
        reject(error);
      }
    };
    
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

function parseEntity(entity: any, index: number): DxfEntity | null {
  const base = {
    id: `entity-${index}`,
    layer: entity.layer || '0',
    color: entity.color,
  };
  
  switch (entity.type) {
    case 'LINE':
      if (!entity.vertices || entity.vertices.length < 2) return null;
      return {
        ...base,
        type: 'line',
        vertices: [
          { x: entity.vertices[0].x, y: entity.vertices[0].y },
          { x: entity.vertices[1].x, y: entity.vertices[1].y },
        ],
      };
      
    case 'LWPOLYLINE':
    case 'POLYLINE':
      return {
        ...base,
        type: 'polyline',
        vertices: entity.vertices.map((v: any) => ({
          x: v.x,
          y: v.y,
        })),
      };
      
    case 'CIRCLE':
      return {
        ...base,
        type: 'circle',
        center: { x: entity.center.x, y: entity.center.y },
        radius: entity.radius,
      };
      
    case 'ARC':
      return {
        ...base,
        type: 'arc',
        center: { x: entity.center.x, y: entity.center.y },
        radius: entity.radius,
        // DXF angles are in degrees, CCW from +X axis (standard math convention)
        startAngle: entity.startAngle,
        endAngle: entity.endAngle,
      };
      
    case 'TEXT':
    case 'MTEXT':
      return {
        ...base,
        type: 'text',
        text: entity.text || entity.string || '',
        position: entity.position || entity.startPoint || null,
        height: entity.height || entity.textHeight || 10,
        rotation: entity.rotation || 0,
      };
      
    case 'INSERT': {
      // Guard against null position to prevent crashes
      if (!entity.position) return null;
      return {
        ...base,
        type: 'insert',
        blockName: entity.name,
        insertPoint: { x: entity.position.x, y: entity.position.y },
        scale: {
          x: entity.xScale || 1,
          y: entity.yScale || 1,
          z: entity.zScale || 1,
        },
        rotation: entity.rotation || 0,
      };
    }
      
    case 'DIMENSION':
      return {
        ...base,
        type: 'dimension',
        text: entity.text,
        vertices: entity.vertices ? entity.vertices.map((v: any) => ({ x: v.x, y: v.y })) : [],
      };
      
    case 'HATCH':
      if (entity.boundary) {
        return {
          ...base,
          type: 'hatch',
          vertices: entity.boundary.map((b: any) => 
            b.vertices ? b.vertices.map((v: any) => ({ x: v.x, y: v.y })) : []
          ).flat(),
        };
      }
      return null;
      
    case 'SOLID':
    case '3DFACE':
      return {
        ...base,
        type: 'solid',
        vertices: entity.vertices?.map((v: any) => ({ x: v.x, y: v.y })) || [],
      };
      
    case 'SPLINE':
      return {
        ...base,
        type: 'spline',
        vertices: entity.controlPoints?.map((v: any) => ({ x: v.x, y: v.y })) || [],
      };
      
    case 'ELLIPSE':
      return {
        ...base,
        type: 'ellipse',
        center: { x: entity.center.x, y: entity.center.y },
      };
      
    default:
      return null;
  }
}

export async function convertDwgToDxf(_file: File): Promise<File> {
  throw new Error(
    'DWG files need to be converted to DXF first. ' +
    'Please use a free converter like:\n' +
    '- ODA File Converter (free): https://www.opendesign.com/guestfiles/oda_file_converter\n' +
    '- LibreCAD (free): https://librecad.org\n' +
    '- AutoCAD web (online): https://web.autocad.com'
  );
}
