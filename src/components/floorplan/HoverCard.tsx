/**
 * Small hover card next to the pointer with the key facts of the hovered entity.
 */

import { useTheme } from '../../contexts/ThemeContext';
import type {
  FloorplanEntity,
  RoomEntity,
  WallEntity,
  DoorEntity,
  EquipmentEntity,
  MeasureEntity,
  NoteEntity,
} from '../../types/floorplan';
import { ROOM_TYPES } from '../../data/roomTypes';
import { getEquipmentById } from '../../data/equipmentLibrary';
import { STATUS_COLOR, KIND_LABEL, lightsOnNow, type LabDevice, type LabRoom } from '../../services/labInventory';

interface HoverCardProps {
  entity: FloorplanEntity;
  x: number;
  y: number;
  containerWidth: number;
  containerHeight: number;
  /** Bound Lab device (equipment) / mapped Lab room (room), when loaded */
  device?: LabDevice;
  labRoom?: LabRoom;
}

export function HoverCard({ entity, x, y, containerWidth, containerHeight, device, labRoom }: HoverCardProps) {
  const { colors } = useTheme();
  const lines = describe(entity, device, labRoom);
  if (!lines) return null;
  const W = 260;
  const left = x + 16 + W > containerWidth ? Math.max(4, x - W - 12) : x + 16;
  const top = y + 12 + 90 > containerHeight ? Math.max(4, y - 90) : y + 12;
  return (
    <div style={{
      position: 'absolute',
      left,
      top,
      maxWidth: W,
      pointerEvents: 'none',
      backgroundColor: colors.bgPanel,
      color: colors.text,
      border: `1px solid ${colors.border}`,
      borderRadius: 8,
      boxShadow: `0 6px 20px ${colors.shadow}`,
      padding: '7px 10px',
      fontSize: 12,
      lineHeight: 1.4,
      zIndex: 15,
    }}>
      <div style={{ fontWeight: 600, marginBottom: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
        {lines.status && <span style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: lines.status, flexShrink: 0 }} />}
        <span>{lines.title}</span>
      </div>
      {lines.rows.map((r, i) => <div key={i} style={{ color: colors.textSecondary }}>{r}</div>)}
    </div>
  );
}

function mm(m: number): string { return `${Math.round(m * 1000)} mm`; }

function ago(d?: Date): string {
  if (!d) return '';
  const s = (Date.now() - d.getTime()) / 1000;
  return s < 90 ? 'just now' : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 172800 ? `${Math.round(s / 3600)} h ago` : d.toLocaleDateString();
}

function describe(e: FloorplanEntity, device?: LabDevice, labRoom?: LabRoom): { title: string; rows: string[]; status?: string } | null {
  switch (e.type) {
    case 'room': {
      const r = e as RoomEntity;
      const rt = ROOM_TYPES.find(t => t.id === r.roomTypeId);
      const size = typeof r.meta?.size_mm === 'string' ? `${(r.meta!.size_mm as string).replace('x', '×')} mm` : null;
      const lights = lightsOnNow(labRoom);
      return { title: r.name, rows: [
        `${r.area.toFixed(2)} m²${size ? ` · ${size}` : ''}`,
        `${rt?.name ?? r.roomTypeId} · clear height ${r.ceilingHeight} m`,
        ...(labRoom ? [`Lab: ${labRoom.name}${labRoom.status ? ` · ${labRoom.status}` : ''}${lights === undefined ? '' : lights ? ' · lights on' : ' · lights off'}`] : []),
      ], status: labRoom ? (labRoom.status === 'healthy' ? '#22c55e' : labRoom.status === 'offline' ? '#6b7280' : labRoom.status ? '#f59e0b' : undefined) : undefined };
    }
    case 'wall': {
      const w = e as WallEntity;
      const kind = String(w.meta?.kind ?? 'wall');
      const between = Array.isArray(w.meta?.between) ? (w.meta!.between as string[]).map(b => b.replace('ENV:', '')).join(' | ') : '';
      return { title: `${kind === 'exterior' ? 'Exterior wall' : kind === 'lining' ? 'Wall lining' : kind === 'partition' ? 'Partition' : 'Wall'} · ${mm(w.thickness)}`, rows: between ? [between] : [] };
    }
    case 'door': {
      const d = e as DoorEntity;
      const meta = d.meta ?? {};
      return { title: `Door ${typeof meta.code === 'string' ? meta.code : ''}`.trim(), rows: [
        `${mm(d.width)} × ${mm(d.height ?? 1.97)} · ${d.swing}`,
        typeof meta.from === 'string' && typeof meta.to === 'string' ? `${meta.from} → ${meta.to}` : '',
      ].filter(Boolean) };
    }
    case 'equipment': {
      const q = e as EquipmentEntity;
      const def = getEquipmentById(q.equipmentId);
      if (device) {
        return { title: device.name, status: STATUS_COLOR[device.status], rows: [
          `${KIND_LABEL[device.kind] ?? device.kind}${device.detail ? ` · ${device.detail}` : ''}${device.roomName ? ` · ${device.roomName}` : ''}`,
          `${device.status}${device.lastSeen ? ` · seen ${ago(device.lastSeen)}` : ''}${device.serialNumber ? ` · SN ${device.serialNumber}` : ''}${device.ipAddress ? ` · ${device.ipAddress}` : ''}`,
          ...(device.nextServiceDue ? [`Service due ${device.nextServiceDue.toLocaleDateString()}${device.nextServiceDue.getTime() < Date.now() ? ' (overdue)' : ''}`] : []),
        ] };
      }
      return { title: q.binding?.name ?? def?.name ?? q.equipmentId, rows: [
        `${Math.round(q.dimensions[0] * 1000)} × ${Math.round(q.dimensions[1] * 1000)} mm${def ? ` · ${def.watts} W` : ''}`,
        q.binding ? `Inventory: ${q.binding.collection}/${q.binding.docId}` : 'Not bound to inventory',
      ] };
    }
    case 'measure': {
      const m = e as MeasureEntity;
      const role = typeof m.meta?.role === 'string' ? (m.meta!.role as string).replace(/-/g, ' ') : (m.style === 'dimension' ? 'dimension' : 'measurement');
      return { title: `${Math.round(m.distance * 1000)} mm`, rows: [`${role}${typeof m.meta?.scope === 'string' && m.meta.scope ? ` · room ${m.meta.scope}` : ''}`] };
    }
    case 'note':
      return { title: (e as NoteEntity).text, rows: [] };
    default:
      return null;
  }
}
