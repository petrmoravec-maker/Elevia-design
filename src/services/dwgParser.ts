/**
 * DWG Parser Service
 * Parses DWG files using LibreDWG WebAssembly (completely free, client-side)
 */

import { Dwg_File_Type, LibreDwg } from '@mlightcad/libredwg-web';
import type { DxfEntity, DxfLayer, DxfPoint, ParsedDxf } from './dxfParser';

// Singleton instance of LibreDWG
let libredwgInstance: LibreDwg | null = null;

/**
 * Initialize the LibreDWG WebAssembly module
 */
async function getLibreDwg(): Promise<LibreDwg> {
  if (!libredwgInstance) {
    // Point to the WASM files location (copied by vite-plugin-static-copy)
    const wasmPath = import.meta.env.DEV 
      ? '/node_modules/@mlightcad/libredwg-web/wasm/'
      : '/wasm/';
    libredwgInstance = await LibreDwg.create(wasmPath);
  }
  return libredwgInstance;
}

/**
 * Parse a DWG file and return entities in the same format as DXF parser
 */
export async function parseDwgFile(file: File): Promise<ParsedDxf> {
  console.log('Starting DWG parsing with LibreDWG WASM...');
  
  // Read file as ArrayBuffer
  const arrayBuffer = await file.arrayBuffer();
  const fileContent = new Uint8Array(arrayBuffer);
  
  // Initialize LibreDWG
  const libredwg = await getLibreDwg();
  
  // Read the DWG file
  console.log('Reading DWG file, size:', fileContent.length);
  const dwg = libredwg.dwg_read_data(fileContent, Dwg_File_Type.DWG);
  
  if (!dwg) {
    throw new Error('Failed to read DWG file');
  }
  
  // Convert to DwgDatabase for easier access
  const db = libredwg.convert(dwg);
  console.log('DWG converted to database:', db);
  
  // Extract layers from tables.LAYER.entries
  const layers: DxfLayer[] = [];
  if (db.tables?.LAYER?.entries) {
    db.tables.LAYER.entries.forEach((layer, index) => {
      layers.push({
        name: layer.name || `Layer_${index}`,
        color: layer.colorIndex || layer.color || 7,
        visible: !layer.off,
      });
    });
  }
  
  // Extract entities and calculate bounds
  const entities: DxfEntity[] = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  
  const updateBounds = (x: number, y: number) => {
    if (isFinite(x) && isFinite(y)) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  };
  
  // Process entities (directly on db.entities)
  if (db.entities) {
    db.entities.forEach((entity: any, index: number) => {
      const parsed = convertEntity(entity, index);
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
  
  // Free memory
  libredwg.dwg_free(dwg);
  
  console.log(`DWG parsed: ${entities.length} entities, ${layers.length} layers`);
  
  return {
    layers,
    entities,
    bounds: {
      minX: minX === Infinity ? 0 : minX,
      minY: minY === Infinity ? 0 : minY,
      maxX: maxX === -Infinity ? 1000 : maxX,
      maxY: maxY === -Infinity ? 1000 : maxY,
    },
  };
}

/**
 * Convert a LibreDWG entity to our standard format
 */
function convertEntity(entity: any, index: number): DxfEntity | null {
  const base = {
    id: `dwg-entity-${index}`,
    layer: entity.layer || '0',
    color: entity.color,
  };
  
  const type = entity.type?.toLowerCase() || entity.entityType?.toLowerCase();
  
  switch (type) {
    case 'line':
      if (entity.start && entity.end) {
        return {
          ...base,
          type: 'line',
          vertices: [
            { x: entity.start.x, y: entity.start.y },
            { x: entity.end.x, y: entity.end.y },
          ],
        };
      }
      // Alternative format
      if (entity.startPoint && entity.endPoint) {
        return {
          ...base,
          type: 'line',
          vertices: [
            { x: entity.startPoint.x, y: entity.startPoint.y },
            { x: entity.endPoint.x, y: entity.endPoint.y },
          ],
        };
      }
      break;
      
    case 'lwpolyline':
    case 'polyline':
    case 'polyline_2d':
    case 'polyline_3d':
      if (entity.vertices || entity.points) {
        const points = entity.vertices || entity.points;
        return {
          ...base,
          type: 'polyline',
          vertices: points.map((v: any) => ({
            x: v.x ?? v.point?.x ?? 0,
            y: v.y ?? v.point?.y ?? 0,
          })),
        };
      }
      break;
      
    case 'circle':
      if (entity.center && entity.radius !== undefined) {
        return {
          ...base,
          type: 'circle',
          center: { x: entity.center.x, y: entity.center.y },
          radius: entity.radius,
        };
      }
      break;
      
    case 'arc':
      if (entity.center && entity.radius !== undefined) {
        return {
          ...base,
          type: 'arc',
          center: { x: entity.center.x, y: entity.center.y },
          radius: entity.radius,
          startAngle: entity.startAngle ?? entity.start_angle,
          endAngle: entity.endAngle ?? entity.end_angle,
        };
      }
      break;
      
    case 'text':
    case 'mtext':
      return {
        ...base,
        type: 'text',
        text: entity.text || entity.contents || entity.string || '',
        position: entity.insertionPoint || entity.position || entity.start,
        height: entity.height || entity.textHeight || 10,
        rotation: entity.rotation || 0,
      };
      
    case 'insert':
    case 'block_reference':
      if (entity.insertionPoint || entity.position) {
        const pos = entity.insertionPoint || entity.position;
        return {
          ...base,
          type: 'insert',
          blockName: entity.blockName || entity.name || entity.block,
          insertPoint: { x: pos.x, y: pos.y },
          scale: {
            x: entity.xScale ?? entity.scaleX ?? 1,
            y: entity.yScale ?? entity.scaleY ?? 1,
            z: entity.zScale ?? entity.scaleZ ?? 1,
          },
          rotation: entity.rotation || 0,
        };
      }
      break;
      
    case 'dimension':
    case 'dimension_linear':
    case 'dimension_aligned':
    case 'dimension_angular':
    case 'dimension_radius':
    case 'dimension_diameter':
      return {
        ...base,
        type: 'dimension',
        text: entity.text || entity.measurement?.toString() || '',
        vertices: extractDimensionPoints(entity),
      };
      
    case 'hatch':
      if (entity.boundaries || entity.boundary) {
        const boundaries = entity.boundaries || [entity.boundary];
        const vertices: DxfPoint[] = [];
        boundaries.forEach((b: any) => {
          if (b.vertices || b.points) {
            (b.vertices || b.points).forEach((v: any) => {
              vertices.push({ x: v.x, y: v.y });
            });
          }
        });
        return {
          ...base,
          type: 'hatch',
          vertices,
        };
      }
      break;
      
    case 'solid':
    case '3dsolid':
    case 'solid3d':
      if (entity.vertices || entity.points) {
        return {
          ...base,
          type: 'solid',
          vertices: (entity.vertices || entity.points).map((v: any) => ({
            x: v.x,
            y: v.y,
          })),
        };
      }
      break;
      
    case 'spline':
      if (entity.controlPoints || entity.fitPoints) {
        const points = entity.controlPoints || entity.fitPoints;
        return {
          ...base,
          type: 'spline',
          vertices: points.map((v: any) => ({ x: v.x, y: v.y })),
        };
      }
      break;
      
    case 'ellipse':
      if (entity.center) {
        return {
          ...base,
          type: 'ellipse',
          center: { x: entity.center.x, y: entity.center.y },
          radius: entity.majorRadius || entity.radius || 50,
        };
      }
      break;
      
    case 'point':
      if (entity.position || entity.point) {
        const pos = entity.position || entity.point;
        return {
          ...base,
          type: 'point',
          position: { x: pos.x, y: pos.y },
        };
      }
      break;
      
    default:
      // Log unhandled entity types for debugging
      console.log('Unhandled DWG entity type:', type, entity);
      return null;
  }
  
  return null;
}

/**
 * Extract dimension points from dimension entity
 */
function extractDimensionPoints(entity: any): DxfPoint[] {
  const points: DxfPoint[] = [];
  
  if (entity.defPoint) points.push({ x: entity.defPoint.x, y: entity.defPoint.y });
  if (entity.textMidPoint) points.push({ x: entity.textMidPoint.x, y: entity.textMidPoint.y });
  if (entity.defPoint1) points.push({ x: entity.defPoint1.x, y: entity.defPoint1.y });
  if (entity.defPoint2) points.push({ x: entity.defPoint2.x, y: entity.defPoint2.y });
  if (entity.start) points.push({ x: entity.start.x, y: entity.start.y });
  if (entity.end) points.push({ x: entity.end.x, y: entity.end.y });
  
  return points;
}

/**
 * Check if a file is a DWG file
 */
export function isDwgFile(file: File): boolean {
  return file.name.toLowerCase().endsWith('.dwg');
}
