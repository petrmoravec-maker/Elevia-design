/**
 * Inventory drawer: the Lab asset register (devices / network devices / controllers) next to
 * the plan. Unplaced items first, grouped by Lab room; "Place" arms the equipment tool with the
 * binding so the next click drops a bound symbol, "Bind" attaches the item to the selected
 * equipment, placed items zoom to their symbol.
 */

import { useMemo, useState } from 'react';
import { X, Search, MapPin, Link2, Crosshair, AlertTriangle } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import { useFloorplanStore } from '../../stores/useFloorplanStore';
import type { EquipmentEntity } from '../../types/floorplan';
import {
  useInventoryStore, bindingKey, STATUS_COLOR, KIND_LABEL,
  type LabDevice, type LabCollection,
} from '../../services/labInventory';
import { IconButton, TextButton, panelStyle, panelHeaderStyle } from './ui';

interface InventoryDrawerProps {
  width?: number;
  readOnly: boolean;
  /** Currently selected equipment entity (bind target), if any */
  selectedEquipmentId: string | null;
  onPlace: (device: LabDevice) => void;
  onBindSelected: (device: LabDevice) => void;
  onZoomTo: (entityId: string) => void;
  onClose: () => void;
}

const TABS: { id: LabCollection; label: string }[] = [
  { id: 'devices', label: 'Devices' },
  { id: 'network_devices', label: 'Network' },
  { id: 'controllers', label: 'Controllers' },
];

type Filter = 'all' | 'unplaced' | 'placed' | 'offline';

export function InventoryDrawer({ width = 300, readOnly, selectedEquipmentId, onPlace, onBindSelected, onZoomTo, onClose }: InventoryDrawerProps) {
  const { colors } = useTheme();
  const devices = useInventoryStore(s => s.devices);
  const loaded = useInventoryStore(s => s.loaded);
  const errors = useInventoryStore(s => s.errors);
  const entities = useFloorplanStore(s => s.entities);
  const [tab, setTab] = useState<LabCollection>('devices');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  // binding key -> equipment entity id
  const placedBy = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of Object.values(entities)) {
      if (e.type === 'equipment' && (e as EquipmentEntity).binding) m.set(bindingKey((e as EquipmentEntity).binding!), e.id);
    }
    return m;
  }, [entities]);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return Object.values(devices)
      .filter(d => d.collection === tab)
      .filter(d => !needle || `${d.name} ${d.kind} ${d.detail ?? ''} ${d.roomName ?? ''} ${d.serialNumber ?? ''} ${d.ipAddress ?? ''}`.toLowerCase().includes(needle))
      .filter(d => {
        const placed = placedBy.has(bindingKey({ collection: d.collection, docId: d.id }));
        if (filter === 'unplaced') return !placed;
        if (filter === 'placed') return placed;
        if (filter === 'offline') return d.status === 'offline' || d.status === 'maintenance';
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [devices, tab, q, filter, placedBy]);

  // group: unplaced first, then by room
  const groups = useMemo(() => {
    const g = new Map<string, LabDevice[]>();
    for (const d of list) {
      const key = d.roomName || 'No room';
      if (!g.has(key)) g.set(key, []);
      g.get(key)!.push(d);
    }
    const unplacedCount = (arr: LabDevice[]) => arr.filter(d => !placedBy.has(bindingKey({ collection: d.collection, docId: d.id }))).length;
    return [...g.entries()].sort((a, b) => unplacedCount(b[1]) - unplacedCount(a[1]) || a[0].localeCompare(b[0]));
  }, [list, placedBy]);

  const counts = useMemo(() => {
    const all = Object.values(devices).filter(d => d.collection === tab);
    const placed = all.filter(d => placedBy.has(bindingKey({ collection: d.collection, docId: d.id }))).length;
    return { all: all.length, placed, unplaced: all.length - placed };
  }, [devices, tab, placedBy]);

  const selectedIsEquipment = !!selectedEquipmentId && entities[selectedEquipmentId]?.type === 'equipment';

  return (
    <aside style={panelStyle(colors, 'left', width)} aria-label="Inventory">
      <div style={panelHeaderStyle(colors)}>
        <span style={{ flex: 1 }}>Inventory</span>
        <IconButton title="Close inventory (B)" onClick={onClose} size={26}><X size={14} /></IconButton>
      </div>

      <div style={{ display: 'flex', gap: 2, padding: '8px 10px 0' }}>
        {TABS.map(t => (
          <TextButton key={t.id} small active={tab === t.id} onClick={() => setTab(t.id)}>{t.label}</TextButton>
        ))}
      </div>

      <div style={{ padding: '8px 10px 4px', display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <Search size={13} style={{ position: 'absolute', left: 8, top: 8, color: colors.textMuted }} />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search name, type, room, serial, IP"
            aria-label="Search inventory"
            style={{
              width: '100%', boxSizing: 'border-box', font: 'inherit', fontSize: 12, padding: '5px 8px 5px 26px',
              border: `1px solid ${colors.border}`, borderRadius: 6, backgroundColor: colors.bg, color: colors.text,
            }}
          />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 4, padding: '0 10px 6px', fontSize: 11, alignItems: 'center' }}>
        {(['all', 'unplaced', 'placed', 'offline'] as Filter[]).map(f => (
          <TextButton key={f} small active={filter === f} onClick={() => setFilter(f)}>
            {f === 'all' ? `All ${counts.all}` : f === 'unplaced' ? `Unplaced ${counts.unplaced}` : f === 'placed' ? `Placed ${counts.placed}` : 'Offline / service'}
          </TextButton>
        ))}
      </div>

      {selectedIsEquipment && !readOnly && (
        <div style={{ margin: '0 10px 6px', padding: '6px 8px', fontSize: 11, borderRadius: 6, backgroundColor: `${colors.accent}18`, color: colors.text, border: `1px solid ${colors.accent}55` }}>
          Equipment selected - use <b>Bind</b> on an item to attach it.
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 6px 10px' }}>
        {!loaded[tab] && <div style={{ padding: 14, fontSize: 12, color: colors.textMuted }}>Loading {TABS.find(t => t.id === tab)?.label.toLowerCase()}…</div>}
        {errors[tab] && (
          <div style={{ margin: 8, padding: 8, fontSize: 12, borderRadius: 6, color: colors.textSecondary, backgroundColor: colors.bg, border: `1px solid ${colors.border}`, display: 'flex', gap: 6 }}>
            <AlertTriangle size={14} color={colors.warning ?? '#f59e0b'} />
            <span>Not available for your role ({errors[tab]}).</span>
          </div>
        )}
        {loaded[tab] && !errors[tab] && list.length === 0 && (
          <div style={{ padding: 14, fontSize: 12, color: colors.textMuted }}>Nothing matches.</div>
        )}
        {groups.map(([room, items]) => (
          <div key={room}>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: colors.textSecondary, padding: '10px 6px 4px' }}>
              {room} <span style={{ fontWeight: 400 }}>· {items.length}</span>
            </div>
            {items.map(d => {
              const key = bindingKey({ collection: d.collection, docId: d.id });
              const placedId = placedBy.get(key);
              return (
                <div
                  key={key}
                  style={{
                    display: 'grid', gridTemplateColumns: '10px 1fr auto', gap: 8, alignItems: 'center',
                    padding: '6px 6px', borderRadius: 6, fontSize: 12,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.backgroundColor = colors.bgHover; }}
                  onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                >
                  <span title={d.status} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: STATUS_COLOR[d.status] }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: placedId ? colors.text : colors.textSecondary }}>{d.name}</div>
                    <div style={{ fontSize: 11, color: colors.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {KIND_LABEL[d.kind] ?? d.kind}{d.detail ? ` · ${d.detail}` : ''}{d.ipAddress ? ` · ${d.ipAddress}` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {placedId ? (
                      <IconButton title="Show on plan" size={24} onClick={() => onZoomTo(placedId)}><Crosshair size={13} /></IconButton>
                    ) : readOnly ? (
                      <span style={{ fontSize: 10, color: colors.textMuted }}>unplaced</span>
                    ) : (
                      <>
                        {selectedIsEquipment && (
                          <IconButton title="Bind to the selected equipment" size={24} onClick={() => onBindSelected(d)}><Link2 size={13} /></IconButton>
                        )}
                        <IconButton title="Place on the plan (then click a spot)" size={24} onClick={() => onPlace(d)}><MapPin size={13} /></IconButton>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </aside>
  );
}
