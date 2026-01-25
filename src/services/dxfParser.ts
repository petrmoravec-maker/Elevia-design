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

// AutoCAD color index to hex
const ACI_COLORS: Record<number, string> = {
  1: '#FF0000', // Red
  2: '#FFFF00', // Yellow
  3: '#00FF00', // Green
  4: '#00FFFF', // Cyan
  5: '#0000FF', // Blue
  6: '#FF00FF', // Magenta
  7: '#FFFFFF', // White/Black
  8: '#808080', // Gray
  9: '#C0C0C0', // Light Gray
};

export function getColorFromAci(colorIndex: number): string {
  return ACI_COLORS[colorIndex] || '#FFFFFF';
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
        
        console.log('Parsed DXF:', dxf);
        
        // Extract layers
        const layers: DxfLayer[] = [];
        if (dxf.tables?.layer?.layers) {
          for (const [name, layer] of Object.entries(dxf.tables.layer.layers)) {
            layers.push({
              name,
              color: (layer as any).color || 7,
              visible: true,
            });
          }
        }
        
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
        
        // Handle blocks (expand INSERT entities)
        if (dxf.blocks) {
          // Store blocks for later reference
          console.log('Blocks found:', Object.keys(dxf.blocks));
        }
        
        resolve({
          layers,
          entities,
          bounds: {
            minX: minX === Infinity ? 0 : minX,
            minY: minY === Infinity ? 0 : minY,
            maxX: maxX === -Infinity ? 1000 : maxX,
            maxY: maxY === -Infinity ? 1000 : maxY,
          },
        });
        
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
        startAngle: entity.startAngle,
        endAngle: entity.endAngle,
      };
      
    case 'TEXT':
    case 'MTEXT':
      return {
        ...base,
        type: 'text',
        text: entity.text || entity.string || '',
        position: entity.position || entity.startPoint,
        height: entity.height || entity.textHeight || 10,
        rotation: entity.rotation || 0,
      };
      
    case 'INSERT':
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
      
    case 'DIMENSION':
      // Dimensions are complex - simplified handling
      return {
        ...base,
        type: 'dimension',
        text: entity.text,
        vertices: entity.vertices ? entity.vertices.map((v: any) => ({ x: v.x, y: v.y })) : [],
      };
      
    case 'HATCH':
      // Hatches have boundary paths
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
      // Splines need control points
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
        // majorAxis and ratio define the ellipse
      };
      
    default:
      console.log('Unhandled entity type:', entity.type);
      return null;
  }
}

/**
 * Convert DWG to DXF using external service
 * DWG is proprietary - needs conversion
 */
export async function convertDwgToDxf(_file: File): Promise<File> {
  // For now, throw an error - DWG conversion requires a backend service
  throw new Error(
    'DWG files need to be converted to DXF first. ' +
    'Please use a free converter like:\n' +
    '- ODA File Converter (free): https://www.opendesign.com/guestfiles/oda_file_converter\n' +
    '- LibreCAD (free): https://librecad.org\n' +
    '- AutoCAD web (online): https://web.autocad.com'
  );
}
