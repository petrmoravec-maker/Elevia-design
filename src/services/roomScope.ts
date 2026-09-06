/**
 * Room scope: the set of entity ids that belong to one room, used to isolate a room on the
 * canvas (its polygon, doors, equipment, dimensions, walls and notes) the way the static
 * viewer does.
 */

import type {
  FloorplanEntity,
  RoomEntity,
  DoorEntity,
  EquipmentEntity,
  MeasureEntity,
  WallEntity,
  NoteEntity,
  Point2D,
} from '../types/floorplan';
import { pointInPolygon, distanceToSegment } from '../types/floorplan';

function roomCode(room: RoomEntity): string {
  const code = room.meta?.code;
  return typeof code === 'string' ? code : room.name.split(' ')[0];
}

function nearPolygon(p: Point2D, poly: Point2D[], tol: number): boolean {
  if (pointInPolygon(p, poly)) return true;
  for (let i = 0; i < poly.length; i++) {
    if (distanceToSegment(p, poly[i], poly[(i + 1) % poly.length]) <= tol) return true;
  }
  return false;
}

export function computeRoomScope(
  entities: Record<string, FloorplanEntity>,
  roomId: string,
): Set<string> {
  const scope = new Set<string>();
  const room = entities[roomId];
  if (!room || room.type !== 'room') return scope;
  const r = room as RoomEntity;
  const code = roomCode(r);
  scope.add(r.id);

  for (const e of Object.values(entities)) {
    switch (e.type) {
      case 'door': {
        const d = e as DoorEntity;
        const meta = d.meta ?? {};
        if (d.wallOwner === r.id || meta.from === code || meta.to === code) scope.add(d.id);
        break;
      }
      case 'equipment': {
        const eq = e as EquipmentEntity;
        if (eq.roomId === r.id || pointInPolygon(eq.center, r.polygon)) scope.add(eq.id);
        break;
      }
      case 'measure': {
        const m = e as MeasureEntity;
        const meta = m.meta ?? {};
        if (meta.scope === code) scope.add(m.id);
        else if (!meta.scope && m.style !== 'dimension'
          && (pointInPolygon(m.start, r.polygon) || pointInPolygon(m.end, r.polygon))) scope.add(m.id);
        break;
      }
      case 'wall': {
        const w = e as WallEntity;
        const between = Array.isArray(w.meta?.between) ? (w.meta!.between as string[]) : [];
        if (between.includes(code)) { scope.add(w.id); break; }
        // wall centre line within half a thickness of the room boundary
        const mid: Point2D = [
          (w.points[0][0] + w.points[w.points.length - 1][0]) / 2,
          (w.points[0][1] + w.points[w.points.length - 1][1]) / 2,
        ];
        if (nearPolygon(mid, r.polygon, w.thickness / 2 + 0.05)) scope.add(w.id);
        break;
      }
      case 'note': {
        const n = e as NoteEntity;
        if (pointInPolygon(n.position, r.polygon)) scope.add(n.id);
        break;
      }
      default:
        break;
    }
  }
  return scope;
}

export function bboxOf(entities: FloorplanEntity[], pad = 0): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = ([x, y]: Point2D) => {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  };
  for (const e of entities) {
    switch (e.type) {
      case 'room': (e as RoomEntity).polygon.forEach(add); break;
      case 'wall': (e as WallEntity).points.forEach(add); break;
      case 'equipment': {
        const eq = e as EquipmentEntity;
        const hw = eq.dimensions[0] / 2, hd = eq.dimensions[1] / 2;
        add([eq.center[0] - hw, eq.center[1] - hd]); add([eq.center[0] + hw, eq.center[1] + hd]);
        break;
      }
      case 'measure': add((e as MeasureEntity).start); add((e as MeasureEntity).end); break;
      case 'note': add((e as NoteEntity).position); break;
      default: break;
    }
  }
  if (!isFinite(minX)) return null;
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}
