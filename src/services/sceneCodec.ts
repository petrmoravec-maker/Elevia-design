/**
 * Firestore codec for scene entities.
 *
 * Firestore rejects arrays nested directly inside arrays, and the scene model is full of
 * them (room polygons, wall polylines, dimension anchors). Points inside arrays are stored
 * as `{x, y}` objects and turned back into `[x, y]` tuples on load. Undefined values are
 * dropped (Firestore rejects those too).
 */

import type { FloorplanEntity } from '../types/floorplan';

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

function encodeValue(v: unknown, insideArray: boolean): Json | undefined {
  if (v === undefined) return undefined;
  if (v === null || typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
  if (Array.isArray(v)) {
    if (insideArray) {
      // Array element that is itself an array: encode as an object.
      if (v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number') {
        return { x: v[0], y: v[1] };
      }
      return { __list: v.map(item => encodeValue(item, true)).filter(item => item !== undefined) as Json[] };
    }
    return v.map(item => encodeValue(item, true)).filter(item => item !== undefined) as Json[];
  }
  if (typeof v === 'object') {
    const out: { [k: string]: Json } = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const enc = encodeValue(val, false);
      if (enc !== undefined) out[k] = enc;
    }
    return out;
  }
  return undefined;
}

function decodeValue(v: Json, insideArray: boolean): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(item => decodeValue(item, true));
  const obj = v as { [k: string]: Json };
  const keys = Object.keys(obj);
  if (insideArray && keys.length === 2 && 'x' in obj && 'y' in obj && typeof obj.x === 'number' && typeof obj.y === 'number') {
    return [obj.x, obj.y];
  }
  if (insideArray && keys.length === 1 && Array.isArray(obj.__list)) {
    return obj.__list.map(item => decodeValue(item, true));
  }
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(obj)) out[k] = decodeValue(val, false);
  return out;
}

/** Entities -> Firestore-safe plain object. */
export function encodeEntities(entities: Record<string, FloorplanEntity>): Record<string, unknown> {
  return encodeValue(entities, false) as Record<string, unknown>;
}

/** Firestore document data -> entities with tuple points. */
export function decodeEntities(data: unknown): Record<string, FloorplanEntity> {
  if (!data || typeof data !== 'object') return {};
  return decodeValue(data as Json, false) as Record<string, FloorplanEntity>;
}
