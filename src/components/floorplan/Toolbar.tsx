import {
  MousePointer2, Hand, Ruler, Square, Minus, DoorOpen, Wrench, Tag, Undo2, Redo2,
  Maximize, Grid3x3, Magnet, Type as TypeIcon,
} from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import type { EditorTool } from '../../stores/useFloorplanStore';
import { IconButton } from './ui';

interface ToolbarProps {
  activeTool: EditorTool;
  onToolChange: (tool: EditorTool) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  /** Hide the drawing tools (viewer without edit rights) */
  readOnly?: boolean;
  onZoomToFit?: () => void;
  showLabels?: boolean;
  onToggleLabels?: () => void;
  snapToGrid?: boolean;
  onToggleSnap?: () => void;
  showGrid?: boolean;
  onToggleGrid?: () => void;
  vertical?: boolean;
}

interface ToolButton {
  id: EditorTool;
  icon: React.ReactNode;
  label: string;
  shortcut: string;
  group: 'navigation' | 'drawing';
}

const TOOLS: ToolButton[] = [
  { id: 'select', icon: <MousePointer2 size={16} />, label: 'Select / inspect', shortcut: 'V', group: 'navigation' },
  { id: 'pan', icon: <Hand size={16} />, label: 'Pan (or drag with the middle button)', shortcut: 'H', group: 'navigation' },
  { id: 'measure', icon: <Ruler size={16} />, label: 'Measure: click two points', shortcut: 'M', group: 'navigation' },
  { id: 'room', icon: <Square size={16} />, label: 'Draw room', shortcut: 'R', group: 'drawing' },
  { id: 'wall', icon: <Minus size={16} />, label: 'Draw wall', shortcut: 'W', group: 'drawing' },
  { id: 'door', icon: <DoorOpen size={16} />, label: 'Place door', shortcut: 'D', group: 'drawing' },
  { id: 'equipment', icon: <Wrench size={16} />, label: 'Place equipment', shortcut: 'E', group: 'drawing' },
  { id: 'note', icon: <Tag size={16} />, label: 'Add note', shortcut: 'N', group: 'drawing' },
];

export function Toolbar({
  activeTool, onToolChange, onUndo, onRedo, readOnly = false, onZoomToFit,
  showLabels = true, onToggleLabels, snapToGrid = true, onToggleSnap, showGrid = true, onToggleGrid, vertical = true,
}: ToolbarProps) {
  const { colors } = useTheme();
  const navigationTools = TOOLS.filter(t => t.group === 'navigation');
  const drawingTools = TOOLS.filter(t => t.group === 'drawing');

  const sep = (
    <div style={{
      width: vertical ? 20 : 1,
      height: vertical ? 1 : 20,
      backgroundColor: colors.border,
      margin: vertical ? '3px auto' : '0 3px',
    }} />
  );

  return (
    <div
      role="toolbar"
      aria-label="Tools"
      style={{
        display: 'flex',
        flexDirection: vertical ? 'column' : 'row',
        alignItems: 'center',
        gap: 2,
        padding: 4,
        backgroundColor: colors.bgPanel,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        boxShadow: `0 2px 8px ${colors.shadow}`,
      }}
    >
      {navigationTools.map(t => (
        <IconButton key={t.id} title={`${t.label} (${t.shortcut})`} active={activeTool === t.id} onClick={() => onToolChange(t.id)}>{t.icon}</IconButton>
      ))}
      {!readOnly && (
        <>
          {sep}
          {drawingTools.map(t => (
            <IconButton key={t.id} title={`${t.label} (${t.shortcut})`} active={activeTool === t.id} onClick={() => onToolChange(t.id)}>{t.icon}</IconButton>
          ))}
          {sep}
          <IconButton title="Undo (Cmd/Ctrl+Z)" onClick={onUndo}><Undo2 size={16} /></IconButton>
          <IconButton title="Redo (Cmd/Ctrl+Shift+Z)" onClick={onRedo}><Redo2 size={16} /></IconButton>
        </>
      )}
      {sep}
      <IconButton title="Zoom to fit (F)" onClick={onZoomToFit}><Maximize size={16} /></IconButton>
      <IconButton title="Labels and dimension values (T)" active={showLabels} onClick={onToggleLabels}><TypeIcon size={16} /></IconButton>
      <IconButton title="Grid (G)" active={showGrid} onClick={onToggleGrid}><Grid3x3 size={16} /></IconButton>
      <IconButton title="Snap to grid (S)" active={snapToGrid} onClick={onToggleSnap}><Magnet size={16} /></IconButton>
    </div>
  );
}
