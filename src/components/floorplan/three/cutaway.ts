/**
 * Cutaway logic for the 3D view: which room is the camera looking into, and which wall
 * segments stand between the camera and that room. Pure 2D (plan) geometry, no three.js.
 */

import type { Point2D } from '../../../types/floorplan';
import { pointInPolygon, polygonCentroid } from '../../../types/floorplan';

export interface WallSeg {
  id: string;
  a: Point2D;
  b: Point2D;
  /** room codes this wall separates (meta.between), "ENV:..." entries allowed */
  rooms: string[];
  exterior?: boolean;
}

export interface RoomShape {
  id: string;
  code: string;
  polygon: Point2D[];
}

export type Occlusion = 'own' | 'between';

/** Proper segment-segment intersection (excluding touching at endpoints within eps). */
export function segmentsIntersect(p1: Point2D, p2: Point2D, q1: Point2D, q2: Point2D, eps = 1e-9): boolean {
  const d1x = p2[0] - p1[0], d1y = p2[1] - p1[1];
  const d2x = q2[0] - q1[0], d2y = q2[1] - q1[1];
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < eps) return false;
  const t = ((q1[0] - p1[0]) * d2y - (q1[1] - p1[1]) * d2x) / den;
  const u = ((q1[0] - p1[0]) * d1y - (q1[1] - p1[1]) * d1x) / den;
  return t > eps && t < 1 - eps && u > eps && u < 1 - eps;
}

function distPointSeg(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy || 1e-12;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Does this wall lie on the boundary of the room (either by meta.between or geometrically within tol)? */
export function wallBelongsToRoom(w: WallSeg, room: RoomShape, tol = 0.25): boolean {
  if (w.rooms.includes(room.code)) return true;
  const mid: Point2D = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2];
  const n = room.polygon.length;
  for (let i = 0; i < n; i++) {
    if (distPointSeg(mid, room.polygon[i], room.polygon[(i + 1) % n]) < tol && distPointSeg(w.a, room.polygon[i], room.polygon[(i + 1) % n]) < tol * 2) return true;
  }
  return false;
}

/**
 * Room the camera is looking into: the room containing the orbit target. Corridors and points
 * outside every room keep the previous room as long as the target is within `keep` metres of it.
 */
export function activeRoomAt(target: Point2D, rooms: RoomShape[], last: string | null, keep = 2.5): string | null {
  for (const r of rooms) {
    if (pointInPolygon(target, r.polygon)) return r.id;
  }
  if (last) {
    const lr = rooms.find(r => r.id === last);
    if (lr) {
      const n = lr.polygon.length;
      let best = Infinity;
      for (let i = 0; i < n; i++) best = Math.min(best, distPointSeg(target, lr.polygon[i], lr.polygon[(i + 1) % n]));
      if (best <= keep) return last;
    }
  }
  return null;
}

/**
 * Walls that hide the active room from a camera at `cam` (plan projection).
 *  - 'own': a wall of the room itself whose outer side faces the camera (camera outside the room)
 *  - 'between': any other wall crossing the line from the camera to the room centroid
 */
export function occludingWalls(cam: Point2D, room: RoomShape, walls: WallSeg[]): Map<string, Occlusion> {
  const out = new Map<string, Occlusion>();
  const c = polygonCentroid(room.polygon);
  const inside = pointInPolygon(cam, room.polygon);
  for (const w of walls) {
    const own = wallBelongsToRoom(w, room);
    if (own) {
      if (inside) continue;
      const mid: Point2D = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2];
      // outward normal = away from the room centroid
      let nx = -(w.b[1] - w.a[1]), ny = w.b[0] - w.a[0];
      const toC = [c[0] - mid[0], c[1] - mid[1]];
      if (nx * toC[0] + ny * toC[1] > 0) { nx = -nx; ny = -ny; }
      const toCam = [cam[0] - mid[0], cam[1] - mid[1]];
      if (nx * toCam[0] + ny * toCam[1] > 0) out.set(w.id, 'own');
      continue;
    }
    if (!inside && segmentsIntersect(cam, c, w.a, w.b)) out.set(w.id, 'between');
  }
  return out;
}
