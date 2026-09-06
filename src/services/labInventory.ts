/**
 * Lab inventory feed for the facility plan (Phase 2).
 *
 * Subscribes to the cultivation app's `devices` (asset register), `network_devices`,
 * `controllers` and `rooms` collections and exposes them as one normalised list, so the
 * plan can bind placed equipment to real inventory and show live state. Same Firebase
 * project; access follows the Lab rules (devices/network_devices: any signed-in user,
 * controllers/rooms: room / controller permissions - failures degrade to "unavailable").
 */

import { create } from 'zustand';
import { collection, onSnapshot, doc, updateDoc, type Unsubscribe, type Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import type { EquipmentBinding } from '../types/floorplan';

export type LabCollection = EquipmentBinding['collection'];

export type LabStatus = 'online' | 'offline' | 'active' | 'maintenance' | 'retired' | 'unknown';

export interface LabDevice {
  id: string;
  collection: LabCollection;
  name: string;
  /** device type / network category / "controller" */
  kind: string;
  /** subType, network type or controller hostname */
  detail?: string;
  roomName?: string;
  roomId?: string;
  status: LabStatus;
  online?: boolean;
  lastSeen?: Date;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  companyDeviceId?: string;
  ipAddress?: string;
  nextServiceDue?: Date;
  notes?: string;
}

export interface LabRoom {
  id: string;
  name: string;
  type?: string;
  status?: string;
  planRoomCode?: string;
  lighting?: { onTime?: string; offTime?: string };
  activeBatchId?: string;
}

interface InventoryState {
  devices: Record<string, LabDevice>;
  rooms: LabRoom[];
  loaded: Partial<Record<LabCollection | 'rooms', boolean>>;
  errors: Partial<Record<LabCollection | 'rooms', string>>;
  start(): void;
  stop(): void;
}

const LAB_APP_URL: string =
  (import.meta.env.VITE_LAB_APP_URL as string | undefined) ||
  (import.meta.env.DEV ? 'http://localhost:5173' : 'https://elevia-cultivaton.web.app');

export function bindingKey(b: { collection: LabCollection; docId: string }): string {
  return `${b.collection}/${b.docId}`;
}

/** Deep link into the Lab for a bound device. */
export function labUrlFor(device: Pick<LabDevice, 'collection' | 'id'>): string {
  switch (device.collection) {
    case 'devices': return `${LAB_APP_URL}/lab/equipment/${device.id}`;
    case 'network_devices': return `${LAB_APP_URL}/lab/settings?tab=network`;
    case 'controllers': return `${LAB_APP_URL}/lab/room-controls`;
    default: return LAB_APP_URL;
  }
}

export function labRoomUrl(roomId: string): string {
  return `${LAB_APP_URL}/lab/rooms/${roomId}`;
}

function toDate(v: unknown): Date | undefined {
  if (!v) return undefined;
  if (v instanceof Date) return v;
  const t = v as Timestamp;
  if (typeof t.toDate === 'function') return t.toDate();
  if (typeof v === 'number') return new Date(v);
  if (typeof v === 'string') { const d = new Date(v); return isNaN(d.getTime()) ? undefined : d; }
  return undefined;
}

function normDevice(id: string, x: Record<string, any>): LabDevice {
  return {
    id, collection: 'devices',
    name: x.name ?? id,
    kind: x.type ?? 'other',
    detail: x.subType || undefined,
    roomName: x.roomName || undefined,
    roomId: x.roomId || undefined,
    status: (x.status as LabStatus) ?? 'unknown',
    manufacturer: x.manufacturer || undefined,
    model: x.model || undefined,
    serialNumber: x.serialNumber || undefined,
    companyDeviceId: x.companyDeviceId || undefined,
    nextServiceDue: toDate(x.nextServiceDue),
  };
}

function normNetwork(id: string, x: Record<string, any>): LabDevice {
  const status = (x.status as LabStatus) ?? 'unknown';
  return {
    id, collection: 'network_devices',
    name: x.name ?? id,
    kind: x.category ?? 'network',
    detail: x.type || undefined,
    roomName: x.location || undefined,
    status,
    online: status === 'online' ? true : status === 'offline' ? false : undefined,
    lastSeen: toDate(x.lastSeen),
    ipAddress: x.ipAddress || undefined,
    notes: x.notes || undefined,
  };
}

function normController(id: string, x: Record<string, any>): LabDevice {
  const online = x.online === true || x.status === 'online';
  return {
    id, collection: 'controllers',
    name: x.name ?? id,
    kind: 'controller',
    detail: x.hostname || x.version || undefined,
    status: online ? 'online' : 'offline',
    online,
    lastSeen: toDate(x.lastSeen ?? x.lastHeartbeat),
    ipAddress: x.apiUrl || undefined,
  };
}

let unsubs: Unsubscribe[] = [];
let started = false;

export const useInventoryStore = create<InventoryState>()((set) => ({
  devices: {},
  rooms: [],
  loaded: {},
  errors: {},

  start() {
    if (started) return;
    started = true;
    const listen = (
      name: LabCollection | 'rooms',
      handler: (docs: { id: string; data: Record<string, any> }[]) => void,
    ) => {
      const unsub = onSnapshot(
        collection(db, name),
        snap => {
          handler(snap.docs.map(d => ({ id: d.id, data: d.data() })));
          set(s => ({ loaded: { ...s.loaded, [name]: true }, errors: { ...s.errors, [name]: undefined } }));
        },
        err => {
          console.warn(`labInventory: ${name} unavailable`, err.code ?? err.message);
          set(s => ({ loaded: { ...s.loaded, [name]: true }, errors: { ...s.errors, [name]: err.code ?? String(err) } }));
        },
      );
      unsubs.push(unsub);
    };
    const mergeCollection = (col: LabCollection, list: LabDevice[]) => {
      set(s => {
        const next: Record<string, LabDevice> = {};
        for (const d of Object.values(s.devices)) if (d.collection !== col) next[bindingKey({ collection: d.collection, docId: d.id })] = d;
        for (const d of list) next[bindingKey({ collection: col, docId: d.id })] = d;
        return { devices: next };
      });
    };
    listen('devices', docs => mergeCollection('devices', docs.map(d => normDevice(d.id, d.data))));
    listen('network_devices', docs => mergeCollection('network_devices', docs.map(d => normNetwork(d.id, d.data))));
    listen('controllers', docs => mergeCollection('controllers', docs.map(d => normController(d.id, d.data))));
    listen('rooms', docs => set({
      rooms: docs
        .map(d => ({
          id: d.id, name: d.data.name ?? d.id, type: d.data.type, status: d.data.status,
          planRoomCode: d.data.planRoomCode || undefined, lighting: d.data.lighting?.schedule, activeBatchId: d.data.activeBatchId,
        }))
        .sort((a, b) => numIn(a.name) - numIn(b.name) || a.name.localeCompare(b.name)),
    }));
  },

  stop() {
    unsubs.forEach(u => u());
    unsubs = [];
    started = false;
  },
}));

// sort helper: "Room 2" before "Room 10"
function numIn(name: string): number {
  const m = /(\d+)/.exec(name);
  return m ? parseInt(m[1], 10) : 0;
}

/** Look up a bound device (undefined while loading / when the doc is gone). */
export function findBound(devices: Record<string, LabDevice>, b?: EquipmentBinding | null): LabDevice | undefined {
  return b ? devices[bindingKey(b)] : undefined;
}

/** Lights in a Lab room are on right now according to its schedule (undefined when unknown). */
export function lightsOnNow(room?: LabRoom, now = new Date()): boolean | undefined {
  const on = room?.lighting?.onTime, off = room?.lighting?.offTime;
  if (!on || !off) return undefined;
  const mins = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
  const n = now.getHours() * 60 + now.getMinutes(), a = mins(on), b = mins(off);
  return a <= b ? n >= a && n < b : n >= a || n < b;
}

/** Write the drawing room number back onto the Lab room so RoomDetail can link to the plan. */
export async function setLabRoomPlanCode(labRoomId: string, planRoomCode: string | null): Promise<void> {
  await updateDoc(doc(db, 'rooms', labRoomId), { planRoomCode: planRoomCode ?? null });
}

export const STATUS_COLOR: Record<LabStatus, string> = {
  online: '#22c55e', active: '#22c55e', offline: '#ef4444', maintenance: '#f59e0b', retired: '#6b7280', unknown: '#9ca3af',
};

export const KIND_LABEL: Record<string, string> = {
  climate: 'Climate', lighting: 'Lighting', irrigation: 'Irrigation', sensors: 'Sensors', extraction: 'Extraction', other: 'Other',
  controller: 'Controller', sensor: 'Sensor', hvac: 'HVAC', network: 'Network',
};

/** Suggested catalog item for a Lab device (drives the footprint and the 2D/3D symbol). */
export function suggestEquipmentId(dev: LabDevice): string {
  const t = `${dev.kind} ${dev.detail ?? ''} ${dev.name}`.toLowerCase();
  if (dev.collection === 'controllers' || dev.kind === 'controller') return 'co2_controller';
  if (/dehumid|quest/.test(t)) return 'dehu_130ppd';
  if (/ac unit|mini ?split|sinclair|asd-/.test(t)) return 'hvac_unit_external';
  if (/recuperation|ventilat|heat recovery|aterra/.test(t)) return 'inline_fan_12in';
  if (/filter/.test(t)) return 'carbon_filter';
  if (/led|light/.test(t)) return 'led_bar_630w';
  if (/dosatron|doser|dosing/.test(t)) return 'dosing_pump';
  if (/pump/.test(t)) return 'water_pump_1hp';
  if (/osmos|ro /.test(t)) return 'ro_system';
  if (/valve|irrigation|sterili/.test(t)) return 'irrigation_controller';
  if (/co2/.test(t)) return 'co2_burner';
  if (/scale|ohaus/.test(t)) return 'scale_industrial';
  if (/sensor|comet/.test(t)) return 'co2_controller';
  return 'equipment_generic';
}
