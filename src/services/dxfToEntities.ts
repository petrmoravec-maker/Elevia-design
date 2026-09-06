/**
 * DXF-to-entity converter.
 *
 * Analyzes parsed DXF data and suggests editable floorplan entities:
 * - Closed polylines → candidate RoomEntity polygons
 * - Parallel/perpendicular line pairs → candidate WallEntity segments
 * - TEXT/MTEXT entities → candidate NoteEntity labels
 *
 * The user confirms/rejects suggestions before they are added to the store.
 */

import type { ParsedDxf, DxfEntity } from './dxfParser';
import type { RoomEntity, WallEntity, NoteEntity, Point2D } from '../types/floorplan';
import { polygonArea, isSelfIntersecting } from '../types/floorplan';
import { generateEntityIdSync } from '../stores/useFloorplanStore';

export interface ConversionCandidate {
  id: string;
  type: 'room' | 'wall' | 'note';
  entity: RoomEntity | WallEntity | NoteEntity;
  /** Source DXF entity index for reference highlighting */
  sourceDxfIndex: number;
  /** Human-readable description of what was detected */
  description: string;
}

export interface ConversionResult {
  candidates: ConversionCandidate[];
  stats: {
    totalEntities: number;
    closedPolylines: number;
    wallSegments: number;
    textLabels: number;
  };
}

// Minimum polygon area (m²) to consider as a room candidate
const MIN_ROOM_AREA = 1.0;
// Maximum polygon area to avoid converting the entire building outline
const MAX_ROOM_AREA = 5000;
// DXF center of the drawing (used to offset coordinates to world origin)
let dxfCenterX = 0;
let dxfCenterY = 0;

export function convertDxfToEntities(dxf: ParsedDxf): ConversionResult {
  dxfCenterX = (dxf.bounds.minX + dxf.bounds.maxX) / 2;
  dxfCenterY = (dxf.bounds.minY + dxf.bounds.maxY) / 2;

  const candidates: ConversionCandidate[] = [];
  let closedPolylines = 0;
  let wallSegments = 0;
  let textLabels = 0;

  dxf.entities.forEach((entity, index) => {
    // ── Closed polylines → room candidates ──────────────────────────────────
    if (entity.type === 'polyline' && entity.vertices && entity.vertices.length >= 4) {
      const verts = entity.vertices;
      const first = verts[0];
      const last = verts[verts.length - 1];
      const isClosed = Math.hypot(last.x - first.x, last.y - first.y) < 0.1;

      if (isClosed) {
        const polygon: Point2D[] = verts.slice(0, -1).map(v => [
          v.x - dxfCenterX,
          v.y - dxfCenterY,
        ] as Point2D);

        const area = polygonArea(polygon);
        if (area >= MIN_ROOM_AREA && area <= MAX_ROOM_AREA && !isSelfIntersecting(polygon)) {
          closedPolylines++;
          const room: RoomEntity = {
            id: generateEntityIdSync('room'),
            type: 'room',
            layer: 'rooms',
            visible: true,
            locked: false,
            polygon,
            roomTypeId: 'grow_veg',
            name: `Room ${closedPolylines}`,
            area,
            wallThickness: 0.2,
            ceilingHeight: 3.0,
          };
          candidates.push({
            id: room.id,
            type: 'room',
            entity: room,
            sourceDxfIndex: index,
            description: `Closed polyline (${polygon.length} vertices, ${area.toFixed(1)} m²)`,
          });
        }
      }
    }

    // ── LINE entities → wall candidates ─────────────────────────────────────
    if (entity.type === 'line' && entity.vertices && entity.vertices.length >= 2) {
      const [a, b] = entity.vertices;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len >= 0.5) { // Ignore very short lines
        wallSegments++;
        const wall: WallEntity = {
          id: generateEntityIdSync('wall'),
          type: 'wall',
          layer: 'walls',
          visible: true,
          locked: false,
          points: [
            [a.x - dxfCenterX, a.y - dxfCenterY],
            [b.x - dxfCenterX, b.y - dxfCenterY],
          ],
          thickness: 0.2,
          height: 3.0,
        };
        // Only include walls above a minimum length (1m) to avoid noisy short lines
        if (len >= 1.0 && wallSegments <= 200) {
          candidates.push({
            id: wall.id,
            type: 'wall',
            entity: wall,
            sourceDxfIndex: index,
            description: `Wall line (${len.toFixed(2)} m, layer: ${entity.layer})`,
          });
        }
      }
    }

    // ── TEXT / MTEXT → note candidates ───────────────────────────────────────
    if ((entity.type === 'text') && entity.text && entity.position) {
      textLabels++;
      if (textLabels <= 50) { // Cap at 50 text candidates
        const note: NoteEntity = {
          id: generateEntityIdSync('note'),
          type: 'note',
          layer: 'notes',
          visible: true,
          locked: false,
          position: [
            entity.position.x - dxfCenterX,
            entity.position.y - dxfCenterY,
          ],
          text: entity.text,
          fontSize: entity.height ?? 0.2,
        };
        candidates.push({
          id: note.id,
          type: 'note',
          entity: note,
          sourceDxfIndex: index,
          description: `Text: "${entity.text.slice(0, 40)}${entity.text.length > 40 ? '…' : ''}"`,
        });
      }
    }
  });

  return {
    candidates,
    stats: {
      totalEntities: dxf.entities.length,
      closedPolylines,
      wallSegments,
      textLabels,
    },
  };
}

/**
 * Convert candidates where the user has confirmed room names.
 * The roomTypeId can optionally be inferred from the room name.
 */
export function applyNameHeuristic(room: RoomEntity): RoomEntity {
  const lower = room.name.toLowerCase();
  const typeMap: Record<string, string> = {
    flower: 'grow_flower',
    flowering: 'grow_flower',
    veg: 'grow_veg',
    vegetative: 'grow_veg',
    clone: 'clone',
    cloning: 'clone',
    dry: 'dry',
    drying: 'dry',
    cure: 'cure',
    processing: 'processing',
    trim: 'processing',
    utility: 'utility',
    storage: 'storage',
    office: 'office',
    bathroom: 'bathroom',
  };
  for (const [key, typeId] of Object.entries(typeMap)) {
    if (lower.includes(key)) {
      return { ...room, roomTypeId: typeId };
    }
  }
  return room;
}
