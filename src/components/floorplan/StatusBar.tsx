import { useTheme } from '../../contexts/ThemeContext';
import { useSaveStatus, useFloorplanStore } from '../../stores/useFloorplanStore';
import { PIXELS_PER_METER } from '../../types/floorplan';

interface StatusBarProps {
  zoom: number;
  /** cursor position in canvas pixels at 100 % (world metres × PIXELS_PER_METER) */
  cursorX: number;
  cursorY: number;
  scale: string;
  selectedElement: string | null;
  onZoomChange: (zoom: number) => void;
  onZoomToFit?: () => void;
  readOnly?: boolean;
  /** Replaces the save indicator (e.g. dev preview that never persists) */
  saveOverride?: string;
  message?: string;
  counts?: { visible: number; total: number };
}

export function StatusBar({
  zoom, cursorX, cursorY, scale, selectedElement, onZoomChange, onZoomToFit, readOnly = false, saveOverride, message, counts,
}: StatusBarProps) {
  const { colors } = useTheme();
  const { saveStatus, lastSavedAt, isDirty } = useSaveStatus();
  const selected = useFloorplanStore(s => (selectedElement ? s.entities[selectedElement] : undefined));

  const saveLabel = (() => {
    if (saveOverride) return { text: saveOverride, color: colors.textMuted };
    if (readOnly) return { text: 'Read-only', color: colors.textMuted };
    if (saveStatus === 'saving') return { text: 'Saving…', color: colors.textMuted };
    if (saveStatus === 'error') return { text: 'Save failed', color: colors.error };
    if (saveStatus === 'offline') return { text: 'Offline — changes queued', color: colors.warning };
    if (isDirty) return { text: 'Unsaved changes', color: colors.textMuted };
    if (lastSavedAt) {
      const d = new Date(lastSavedAt);
      return { text: `Saved ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`, color: colors.success };
    }
    return { text: 'Ready', color: colors.textMuted };
  })();

  const xM = cursorX / PIXELS_PER_METER;
  const yM = cursorY / PIXELS_PER_METER;
  const num = (v: number) => (Math.abs(v) < 1e-9 ? 0 : v).toFixed(3);

  const item: React.CSSProperties = { whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };
  const btn: React.CSSProperties = {
    width: 22, height: 20, border: `1px solid ${colors.border}`, borderRadius: 4, backgroundColor: 'transparent',
    color: colors.textSecondary, cursor: 'pointer', fontSize: 12, lineHeight: 1, padding: 0,
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 16, padding: '4px 12px', backgroundColor: colors.bgPanel,
      borderTop: `1px solid ${colors.border}`, fontSize: 11.5, color: colors.textSecondary, flexShrink: 0, minHeight: 28,
    }}>
      <span style={{ ...item, minWidth: 190 }}>x {num(xM)} m &nbsp; y {num(yM)} m</span>
      <span style={item}>{scale}</span>
      {counts && <span style={item}>{counts.visible}/{counts.total} elements</span>}
      {selected && (
        <span style={{ ...item, color: colors.text }}>
          {selected.type}{'name' in selected && typeof (selected as { name?: string }).name === 'string' ? `: ${(selected as { name: string }).name}` : ''}
        </span>
      )}
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: colors.textMuted }}>{message}</span>
      <span style={{ ...item, color: saveLabel.color }}>{saveLabel.text}</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <button type="button" style={btn} title="Zoom out" onClick={() => onZoomChange(Math.max(8, zoom / 1.25))}>−</button>
        <button type="button" style={{ ...btn, width: 52 }} title="Zoom to fit (F)" onClick={onZoomToFit}>{Math.round(zoom)}%</button>
        <button type="button" style={btn} title="Zoom in" onClick={() => onZoomChange(Math.min(1600, zoom * 1.25))}>+</button>
      </span>
    </div>
  );
}
