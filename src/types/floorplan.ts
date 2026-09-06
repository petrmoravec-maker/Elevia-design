/**
 * Floorplan entity type definitions.
 * All coordinates use Y-up convention (matching DXF/engineering standard):
 *   - Positive Y = up/north
 *   - Positive X = right/east
 *   - Units = meters
 *
 * The canvas rendering layer is responsible for flipping Y to screen space.
 */

// [x, y] in meters, Y-up convention
export type Point2D = [number, number];

export interface BaseEntity {
  /** Unique ID with type prefix, e.g. "room_abc123" */
  id: string;
  type: FloorplanEntityType;
  /** Maps to a layer name for visibility/lock filtering */
  layer: string;
  visible: boolean;
  locked: boolean;
  /** Free-form metadata carried by generated entities (facility-design/build.py). */
  meta?: Record<string, unknown>;
}

/** Link from a placed piece of equipment to the Lab inventory (Phase 2). */
export interface EquipmentBinding {
  /** Firestore collection the device lives in */
  collection: 'devices' | 'network_devices' | 'controllers';
  docId: string;
  /** Cached display name, refreshed by labInventoryService */
  name?: string;
}

/** Room finish / HVAC data taken from the drawing legends. */
export interface RoomFinish {
  floor?: string;
  walls?: string;
  ceiling?: string;
}

export interface RoomEntity extends BaseEntity {
  type: 'room';
  /** Closed polygon boundary in meters, Y-up. At least 3 points. */
  polygon: Point2D[];
  /** References ROOM_TYPES.id from roomTypes.ts */
  roomTypeId: string;
  name: string;
  /** Auto-calculated m2 via Shoelace formula */
  area: number;
  /** Default 0.2m. Used when deriving wall geometry or rendering wall thickness. */
  wallThickness: number;
  /** Default 3.0m. Used for BTU calculations and future 3D extrusion. */
  ceilingHeight: number;
  /** Lab `rooms/{id}` this room maps to (Phase 2), null when unmapped. */
  labRoomId?: string | null;
}

export interface WallEntity extends BaseEntity {
  type: 'wall';
  /** Polyline of points in meters (standalone walls not derived from rooms) */
  points: Point2D[];
  /** Wall thickness in meters, default 0.2 */
  thickness: number;
  /** Wall height in meters, default 3.0 */
  height: number;
}

export interface DoorEntity extends BaseEntity {
  type: 'door';
  /** ID of parent RoomEntity or WallEntity this door is placed on */
  wallOwner: string;
  /** Which edge of the room polygon: index 0 = edge from vertex 0 to vertex 1 */
  edgeIndex: number;
  /** Parametric position along the edge, 0-1 */
  position: number;
  /** Door width in meters, default 0.9 */
  width: number;
  /** Door height in meters (facility standard 1.97) */
  height?: number;
  swing: 'left' | 'right' | 'double' | 'sliding';
}

export interface EquipmentEntity extends BaseEntity {
  type: 'equipment';
  /** References DEFAULT_EQUIPMENT item id from equipmentLibrary.ts */
  equipmentId: string;
  /** Center point in meters */
  center: Point2D;
  /** Rotation in degrees. 0/90/180/270 for snap rotations; free for fine rotation. */
  rotation: number;
  /** [width, depth] in meters */
  dimensions: Point2D;
  /** Auto-assigned by point-in-polygon containment test, not manually set */
  roomId?: string;
  /** Inventory binding (Phase 2) */
  binding?: EquipmentBinding | null;
}

export interface MeasureEntity extends BaseEntity {
  type: 'measure';
  start: Point2D;
  end: Point2D;
  /** Auto-calculated distance in meters */
  distance: number;
  /** Optional override label text */
  label?: string;
  /**
   * 'measure' (default): user measurement, dashed magenta line with arrowheads.
   * 'dimension': architectural dimension string - thin line with 45deg ticks, extension
   * lines to `meta.measured` anchors and the value in mm.
   */
  style?: 'measure' | 'dimension';
}

export interface NoteEntity extends BaseEntity {
  type: 'note';
  position: Point2D;
  text: string;
  /** Font size in meters (world units, scaled for rendering) */
  fontSize: number;
}

export type FloorplanEntityType = 'room' | 'wall' | 'door' | 'equipment' | 'measure' | 'note';

export type FloorplanEntity =
  | RoomEntity
  | WallEntity
  | DoorEntity
  | EquipmentEntity
  | MeasureEntity
  | NoteEntity;

// ─── Scale conversion utilities ────────────────────────────────────────────────

/** Pixels per meter at 1:100 scale. 50px = 1m. Must be used consistently everywhere. */
export const PIXELS_PER_METER = 50;

/** Convert pixels (canvas space) to world meters. */
export function toWorld(px: number): number {
  return px / PIXELS_PER_METER;
}

/** Convert world meters to pixels (canvas space). */
export function toCanvas(meters: number): number {
  return meters * PIXELS_PER_METER;
}

// ─── Geometry helpers ──────────────────────────────────────────────────────────

/**
 * Calculate the signed area of a polygon using the Shoelace formula.
 * Positive = counter-clockwise winding (Y-up), Negative = clockwise.
 */
export function signedArea(polygon: Point2D[]): number {
  const n = polygon.length;
  if (n < 3) return 0;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = polygon[i];
    const [x2, y2] = polygon[(i + 1) % n];
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
}

/** Calculate the area of a polygon in square meters (always positive). */
export function polygonArea(polygon: Point2D[]): number {
  return Math.abs(signedArea(polygon));
}

/** Return the centroid of a polygon. */
export function polygonCentroid(polygon: Point2D[]): Point2D {
  const n = polygon.length;
  if (n === 0) return [0, 0];
  const A = signedArea(polygon);
  if (Math.abs(A) < 1e-10) {
    // Degenerate polygon, return average of points
    const sx = polygon.reduce((s, [x]) => s + x, 0) / n;
    const sy = polygon.reduce((s, [, y]) => s + y, 0) / n;
    return [sx, sy];
  }
  let cx = 0, cy = 0;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = polygon[i];
    const [x2, y2] = polygon[(i + 1) % n];
    const cross = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  const f = 1 / (6 * A);
  return [cx * f, cy * f];
}

/** Check if a point is inside a polygon (ray casting algorithm). */
export function pointInPolygon(point: Point2D, polygon: Point2D[]): boolean {
  const [px, py] = point;
  const n = polygon.length;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersect =
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Check if a polygon is self-intersecting.
 * Rejects figure-8s and other invalid room shapes.
 */
export function isSelfIntersecting(polygon: Point2D[]): boolean {
  const n = polygon.length;
  if (n < 4) return false;

  const segmentsIntersect = (
    [ax, ay]: Point2D, [bx, by]: Point2D,
    [cx, cy]: Point2D, [dx, dy]: Point2D,
  ): boolean => {
    const d1x = bx - ax, d1y = by - ay;
    const d2x = dx - cx, d2y = dy - cy;
    const cross = d1x * d2y - d1y * d2x;
    if (Math.abs(cross) < 1e-10) return false; // Parallel
    const t = ((cx - ax) * d2y - (cy - ay) * d2x) / cross;
    const u = ((cx - ax) * d1y - (cy - ay) * d1x) / cross;
    return t > 1e-10 && t < 1 - 1e-10 && u > 1e-10 && u < 1 - 1e-10;
  };

  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // Adjacent edges share a vertex
      if (segmentsIntersect(polygon[i], polygon[(i + 1) % n], polygon[j], polygon[(j + 1) % n])) {
        return true;
      }
    }
  }
  return false;
}

/** Distance from point to line segment. Returns distance in meters. */
export function distanceToSegment(point: Point2D, a: Point2D, b: Point2D): number {
  const [px, py] = point;
  const [ax, ay] = a;
  const [bx, by] = b;
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-10) {
    return Math.hypot(px - ax, py - ay);
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
