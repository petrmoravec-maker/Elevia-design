/**
 * Legend drawer: room legend, construction notes, symbols, section heights and the title
 * block of the source drawings (facility.legend on the project document).
 */

import { useState } from 'react';
import { X } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import type { DesignProject } from '../../services/designProject';
import type { RoomEntity, FloorplanEntity } from '../../types/floorplan';
import { IconButton, TextButton, KV, SectionTitle } from './ui';

interface LegendDrawerProps {
  project: DesignProject;
  entities: Record<string, FloorplanEntity>;
  onSelectRoom: (id: string) => void;
  onClose: () => void;
}

type Tab = 'rooms' | 'notes' | 'symbols' | 'sheet';

export function LegendDrawer({ project, entities, onSelectRoom, onClose }: LegendDrawerProps) {
  const { colors } = useTheme();
  const [tab, setTab] = useState<Tab>('rooms');
  const legend = project.facility?.legend;
  const rooms = (Object.values(entities).filter(e => e.type === 'room') as RoomEntity[])
    .sort((a, b) => String(a.meta?.code ?? a.name).localeCompare(String(b.meta?.code ?? b.name), undefined, { numeric: true }));

  return (
    <div
      role="dialog"
      aria-label="Legend"
      style={{
        position: 'absolute',
        top: 12,
        right: 12,
        bottom: 12,
        width: 520,
        maxWidth: 'calc(100% - 24px)',
        backgroundColor: colors.bgPanel,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        boxShadow: `0 12px 40px ${colors.shadowLg}`,
        display: 'flex',
        flexDirection: 'column',
        zIndex: 20,
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 10px 10px 16px', borderBottom: `1px solid ${colors.border}` }}>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>Legend & notes from the drawings</span>
        <IconButton title="Close legend (K)" onClick={onClose} size={26}><X size={15} /></IconButton>
      </div>
      <div style={{ display: 'flex', gap: 4, padding: '8px 12px 0' }}>
        {([['rooms', 'Rooms'], ['notes', 'Construction notes'], ['symbols', 'Symbols'], ['sheet', 'Sheet']] as [Tab, string][]).map(([id, label]) => (
          <TextButton key={id} small active={tab === id} onClick={() => setTab(id)}>{label}</TextButton>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 16px 16px', fontSize: 12.5 }}>
        {!legend && <div style={{ color: colors.textMuted }}>This project has no legend data (only the generated facility plan carries the drawing legends).</div>}

        {legend && tab === 'rooms' && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: colors.textSecondary, textAlign: 'left' }}>
                <th style={th}>No.</th><th style={th}>Name</th><th style={{ ...th, textAlign: 'right' }}>m² (legend)</th><th style={{ ...th, textAlign: 'right' }}>m² (model)</th>
                <th style={th}>Floor</th><th style={th}>Walls</th><th style={th}>Ceiling</th>
              </tr>
            </thead>
            <tbody>
              {rooms.map(r => {
                const code = String(r.meta?.code ?? r.name.split(' ')[0]);
                const lg = legend.rooms[code];
                const finish = (r.meta?.finish as Record<string, string> | undefined) ?? lg?.finish ?? {};
                const legendArea = (r.meta?.area_legend as number | undefined) ?? lg?.area_m2;
                const diff = legendArea !== undefined ? Math.abs(legendArea - r.area) : 0;
                return (
                  <tr key={r.id} onClick={() => onSelectRoom(r.id)} style={{ borderTop: `1px solid ${colors.border}`, cursor: 'pointer' }}
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = colors.bgHover)} onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}>
                    <td style={{ ...td, fontWeight: 600 }}>{code}</td>
                    <td style={td}>{r.name.replace(code, '').trim()}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{legendArea !== undefined ? legendArea.toFixed(2) : '-'}</td>
                    <td style={{ ...td, textAlign: 'right', color: diff > 0.5 ? colors.warning : colors.text }} title={diff > 0.5 ? 'Differs from the legend by more than 0.5 m²' : ''}>{r.area.toFixed(2)}</td>
                    <td style={tdSmall}>{finish.floor ?? ''}</td>
                    <td style={tdSmall}>{finish.walls ?? ''}</td>
                    <td style={tdSmall}>{finish.ceiling ?? ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {legend && tab === 'notes' && (
          <>
            <SectionTitle>Construction notes (architect sheet)</SectionTitle>
            <ol style={{ paddingLeft: 18, margin: 0, lineHeight: 1.5 }}>
              {legend.notes.map((n, i) => <li key={i} style={{ marginBottom: 8 }}>{n}</li>)}
            </ol>
            {project.facility && (
              <>
                <SectionTitle>Owner-confirmed values (not on the drawings)</SectionTitle>
                <KV rows={[
                  ['Exterior walls', `${project.facility.construction.exterior_wall_mm ?? 300} mm`],
                  ['Interior masonry walls', `${project.facility.construction.interior_masonry_wall_mm ?? 200} mm`],
                  ['Clear height', `${project.facility.construction.clear_height_m ?? 3.5} m (HVAC ducts, then lights below the ceiling)`],
                  ['Door height', `${project.facility.construction.door_height_mm ?? 1970} mm`],
                ]} />
              </>
            )}
          </>
        )}

        {legend && tab === 'symbols' && (
          <>
            <SectionTitle>Symbols on the architect sheet</SectionTitle>
            <ul style={{ paddingLeft: 18, margin: 0, lineHeight: 1.6 }}>
              {legend.symbols.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
            <SectionTitle>HVAC section levels (mm above floor)</SectionTitle>
            {Object.entries(legend.sections).map(([sec, levels]) => (
              <div key={sec} style={{ marginBottom: 4 }}><b>Section {sec}:</b> {levels.join(' · ')}</div>
            ))}
            <div style={{ color: colors.textMuted, marginTop: 8 }}>
              Levels read from the D.1.4.5 sections. Exact duct / light stack heights follow from the device datasheets (Phase 4).
            </div>
          </>
        )}

        {legend && tab === 'sheet' && (
          <>
            <SectionTitle>Title block</SectionTitle>
            <KV rows={Object.entries(legend.title).map(([k, v]) => [k.replace(/_/g, ' '), v] as [string, string])} />
            <SectionTitle>Model</SectionTitle>
            <KV rows={[
              ['Source', 'facility-design/build.py (model/existing.yaml + PDF extraction)'],
              ['Units', 'metres in the scene, millimetres on dimensions'],
              ['Origin', project.originNote ?? '-'],
              ['Guide DXF', project.guide ? `${project.guide.fileName} · ${project.guide.layers.length} layers` : '-'],
            ]} />
          </>
        )}
      </div>
    </div>
  );
}

const th: React.CSSProperties = { padding: '3px 5px', fontWeight: 500, fontSize: 11.5, whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '4px 5px', verticalAlign: 'top' };
const tdSmall: React.CSSProperties = { ...td, fontSize: 11, lineHeight: 1.3 };
