import { useTheme } from '../../contexts/ThemeContext';
import type { EditorTool } from '../../pages/floorplan/FloorplanEditor';

interface ToolbarProps {
  activeTool: EditorTool;
  onToolChange: (tool: EditorTool) => void;
}

interface ToolButton {
  id: EditorTool;
  icon: string;
  label: string;
  shortcut: string;
  group: 'navigation' | 'drawing';
}

const TOOLS: ToolButton[] = [
  { id: 'select', icon: '↖', label: 'Select', shortcut: 'V', group: 'navigation' },
  { id: 'pan', icon: '✋', label: 'Pan', shortcut: 'H', group: 'navigation' },
  { id: 'measure', icon: '📏', label: 'Measure', shortcut: 'M', group: 'navigation' },
  { id: 'room', icon: '⬜', label: 'Room', shortcut: 'R', group: 'drawing' },
  { id: 'equipment', icon: '🔧', label: 'Equipment', shortcut: 'E', group: 'drawing' },
  { id: 'electrical', icon: '⚡', label: 'Electrical', shortcut: 'L', group: 'drawing' },
  { id: 'plumbing', icon: '💧', label: 'Plumbing', shortcut: 'P', group: 'drawing' },
];

export function Toolbar({ activeTool, onToolChange }: ToolbarProps) {
  const { colors } = useTheme();

  const navigationTools = TOOLS.filter(t => t.group === 'navigation');
  const drawingTools = TOOLS.filter(t => t.group === 'drawing');

  const styles = {
    container: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
    } as const,
    group: {
      display: 'flex',
      alignItems: 'center',
      gap: '2px',
      padding: '4px',
      backgroundColor: colors.bg,
      borderRadius: '8px',
    } as const,
    separator: {
      width: '1px',
      height: '24px',
      backgroundColor: colors.border,
      margin: '0 8px',
    } as const,
    button: (isActive: boolean) => ({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '36px',
      height: '36px',
      backgroundColor: isActive ? colors.accent : 'transparent',
      border: 'none',
      borderRadius: '6px',
      color: isActive ? 'white' : colors.textSecondary,
      fontSize: '16px',
      cursor: 'pointer',
      transition: 'all 0.15s',
      position: 'relative' as const,
    }),
    tooltip: {
      position: 'absolute' as const,
      bottom: '-32px',
      left: '50%',
      transform: 'translateX(-50%)',
      padding: '4px 8px',
      backgroundColor: colors.bgPanel,
      border: `1px solid ${colors.border}`,
      borderRadius: '4px',
      fontSize: '11px',
      color: colors.text,
      whiteSpace: 'nowrap' as const,
      pointerEvents: 'none' as const,
      zIndex: 100,
      opacity: 0,
      transition: 'opacity 0.15s',
    },
  };

  return (
    <div style={styles.container}>
      {/* Navigation Tools */}
      <div style={styles.group}>
        {navigationTools.map((tool) => (
          <button
            key={tool.id}
            style={styles.button(activeTool === tool.id)}
            onClick={() => onToolChange(tool.id)}
            title={`${tool.label} (${tool.shortcut})`}
          >
            {tool.icon}
          </button>
        ))}
      </div>

      <div style={styles.separator} />

      {/* Drawing Tools */}
      <div style={styles.group}>
        {drawingTools.map((tool) => (
          <button
            key={tool.id}
            style={styles.button(activeTool === tool.id)}
            onClick={() => onToolChange(tool.id)}
            title={`${tool.label} (${tool.shortcut})`}
          >
            {tool.icon}
          </button>
        ))}
      </div>
    </div>
  );
}
