/**
 * Layer tree: guide (drawing) layers and scene layers grouped by discipline, tri-state group
 * eyes, solo (alt-click / button), presets, guide opacity and room isolation.
 */

import { useMemo, useState } from 'react';
import { Eye, EyeOff, Lock, ChevronRight, X, Crosshair } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import { IconButton, TextButton, SectionTitle, panelStyle, panelHeaderStyle } from './ui';

export interface UILayer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  color: string;
  count?: number;
  source: 'guide' | 'scene';
  /** Small tag, e.g. the source sheet (ARCH / HVAC / KOORD) */
  tag?: string;
}

export interface UILayerGroup {
  id: string;
  name: string;
  layers: UILayer[];
}

export interface LayerPreset {
  id: string;
  name: string;
  hint?: string;
}

interface LayerPanelProps {
  groups: UILayerGroup[];
  presets: LayerPreset[];
  onPreset: (id: string) => void;
  onToggleLayer: (layer: UILayer) => void;
  onSoloLayer: (layer: UILayer) => void;
  onSetGroupVisible: (group: UILayerGroup, visible: boolean) => void;
  onSetAllVisible: (visible: boolean) => void;
  guideOpacity: number;
  onGuideOpacity: (v: number) => void;
  hasGuide: boolean;
  rooms: { id: string; label: string }[];
  scopeRoomId: string | null;
  onScopeRoom: (id: string | null) => void;
  filter: string;
  onClose?: () => void;
}

export function LayerPanel({
  groups,
  presets,
  onPreset,
  onToggleLayer,
  onSoloLayer,
  onSetGroupVisible,
  onSetAllVisible,
  guideOpacity,
  onGuideOpacity,
  hasGuide,
  rooms,
  scopeRoomId,
  onScopeRoom,
  filter,
  onClose,
}: LayerPanelProps) {
  const { colors } = useTheme();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const q = filter.trim().toLowerCase();
  const shown = useMemo(() => {
    if (!q) return groups;
    return groups
      .map(g => ({ ...g, layers: g.layers.filter(l => l.name.toLowerCase().includes(q) || g.name.toLowerCase().includes(q)) }))
      .filter(g => g.layers.length > 0);
  }, [groups, q]);

  const row: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '3px 6px 3px 8px',
    borderRadius: 5,
    fontSize: 12.5,
    minHeight: 26,
  };

  return (
    <aside style={panelStyle(colors, 'left', 290)} aria-label="Layers">
      <div style={panelHeaderStyle(colors)}>
        <span style={{ flex: 1 }}>Layers</span>
        <TextButton small onClick={() => onSetAllVisible(true)} title="Show all layers">all</TextButton>
        <TextButton small onClick={() => onSetAllVisible(false)} title="Hide all layers">none</TextButton>
        {onClose && <IconButton title="Close layers (L)" onClick={onClose} size={24}><X size={14} /></IconButton>}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 8px 12px' }}>
        <SectionTitle>Presets</SectionTitle>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {presets.map(p => (
            <TextButton key={p.id} small onClick={() => onPreset(p.id)} title={p.hint}>{p.name}</TextButton>
          ))}
        </div>

        <SectionTitle
          right={scopeRoomId
            ? <TextButton small onClick={() => onScopeRoom(null)} title="Show all rooms (Esc)">clear</TextButton>
            : undefined}
        >
          Room isolation
        </SectionTitle>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Crosshair size={14} color={scopeRoomId ? colors.accent : colors.textMuted} />
          <select
            value={scopeRoomId ?? ''}
            onChange={e => onScopeRoom(e.target.value || null)}
            aria-label="Isolate a room"
            style={{
              flex: 1,
              font: 'inherit',
              fontSize: 12,
              padding: '4px 6px',
              border: `1px solid ${scopeRoomId ? colors.accent : colors.border}`,
              borderRadius: 6,
              backgroundColor: colors.bg,
              color: colors.text,
            }}
          >
            <option value="">All rooms</option>
            {rooms.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </div>

        {hasGuide && (
          <>
            <SectionTitle>Drawing opacity</SectionTitle>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: colors.textSecondary }}>
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={guideOpacity}
                onChange={e => onGuideOpacity(parseFloat(e.target.value))}
                aria-label="Guide drawing opacity"
                style={{ flex: 1 }}
              />
              <span style={{ width: 34, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{Math.round(guideOpacity * 100)}%</span>
            </div>
          </>
        )}

        <SectionTitle>Groups</SectionTitle>
        {shown.length === 0 && (
          <div style={{ fontSize: 12, color: colors.textMuted, padding: '6px 2px' }}>No layer matches “{filter}”.</div>
        )}
        {shown.map(g => {
          const visibleCount = g.layers.filter(l => l.visible).length;
          const state: 'on' | 'off' | 'mixed' = visibleCount === 0 ? 'off' : visibleCount === g.layers.length ? 'on' : 'mixed';
          const isCollapsed = collapsed[g.id] ?? false;
          return (
            <div key={g.id} style={{ borderTop: `1px solid ${colors.border}`, padding: '3px 0' }}>
              <div
                style={{ ...row, cursor: 'pointer', userSelect: 'none', fontWeight: 600 }}
                onClick={() => setCollapsed(c => ({ ...c, [g.id]: !isCollapsed }))}
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = colors.bgHover)}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                <ChevronRight
                  size={13}
                  color={colors.textMuted}
                  style={{ transform: isCollapsed ? 'none' : 'rotate(90deg)', transition: 'transform .12s', flexShrink: 0 }}
                />
                <span style={{ flex: 1, color: state === 'off' ? colors.textMuted : colors.text }}>{g.name}</span>
                <span style={{ fontSize: 11, color: colors.textMuted }}>{visibleCount}/{g.layers.length}</span>
                <IconButton
                  title={state === 'on' ? 'Hide group' : 'Show group'}
                  size={24}
                  onClick={() => onSetGroupVisible(g, state !== 'on')}
                  style={{ color: state === 'off' ? colors.textMuted : state === 'mixed' ? colors.textSecondary : colors.text }}
                >
                  {state === 'off' ? <EyeOff size={15} /> : <Eye size={15} style={{ opacity: state === 'mixed' ? 0.55 : 1 }} />}
                </IconButton>
              </div>
              {!isCollapsed && g.layers.map(l => (
                <div
                  key={`${l.source}:${l.id}`}
                  style={{ ...row, paddingLeft: 26, color: l.visible ? colors.text : colors.textMuted }}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = colors.bgHover)}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                  title={`${l.name}${l.count !== undefined ? ` · ${l.count} elements` : ''}\nClick the eye to toggle, Alt+click (or “solo”) to show only this layer`}
                >
                  <span style={{
                    width: 10, height: 10, borderRadius: 2, flexShrink: 0,
                    backgroundColor: l.visible ? l.color : 'transparent',
                    border: `1px solid ${l.color}`,
                  }} />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</span>
                  {l.tag && (
                    <span style={{ fontSize: 9.5, color: colors.textMuted, border: `1px solid ${colors.border}`, borderRadius: 3, padding: '0 3px' }}>{l.tag}</span>
                  )}
                  {l.count !== undefined && <span style={{ fontSize: 10.5, color: colors.textMuted, minWidth: 28, textAlign: 'right' }}>{l.count}</span>}
                  {l.locked && <Lock size={11} color={colors.textMuted} aria-label="Locked (generated)" />}
                  <button
                    type="button"
                    title="Solo: show only this layer"
                    onClick={() => onSoloLayer(l)}
                    style={{ border: 'none', background: 'none', color: colors.textMuted, fontSize: 10, cursor: 'pointer', padding: '0 3px' }}
                  >
                    solo
                  </button>
                  <IconButton
                    title={l.visible ? 'Hide layer' : 'Show layer'}
                    size={22}
                    onClick={() => onToggleLayer(l)}
                    style={{ color: l.visible ? colors.text : colors.textMuted }}
                  >
                    {l.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                  </IconButton>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
