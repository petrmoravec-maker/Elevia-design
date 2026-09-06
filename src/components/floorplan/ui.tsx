/**
 * Small shared UI atoms for the floorplan editor (inline styles, theme aware).
 */

import type { CSSProperties, ReactNode } from 'react';
import { useTheme } from '../../contexts/ThemeContext';

export function IconButton({
  title,
  active = false,
  disabled = false,
  onClick,
  children,
  size = 30,
  style,
}: {
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
  size?: number;
  style?: CSSProperties;
}) {
  const { colors } = useTheme();
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        border: 'none',
        borderRadius: 6,
        cursor: disabled ? 'default' : 'pointer',
        backgroundColor: active ? colors.accent : 'transparent',
        color: active ? '#fff' : disabled ? colors.textMuted : colors.textSecondary,
        opacity: disabled ? 0.5 : 1,
        flexShrink: 0,
        ...style,
      }}
      onMouseEnter={e => { if (!active && !disabled) e.currentTarget.style.backgroundColor = colors.bgHover; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.backgroundColor = 'transparent'; }}
    >
      {children}
    </button>
  );
}

export function TextButton({
  onClick,
  children,
  active = false,
  small = false,
  title,
  disabled = false,
}: {
  onClick?: () => void;
  children: ReactNode;
  active?: boolean;
  small?: boolean;
  title?: string;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      style={{
        font: 'inherit',
        fontSize: small ? 11 : 12,
        padding: small ? '2px 7px' : '4px 10px',
        border: `1px solid ${active ? colors.accent : colors.border}`,
        borderRadius: 6,
        backgroundColor: active ? colors.accent : colors.bgPanel,
        color: active ? '#fff' : disabled ? colors.textMuted : colors.text,
        cursor: disabled ? 'default' : 'pointer',
        whiteSpace: 'nowrap',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {children}
    </button>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  const { colors } = useTheme();
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      fontSize: 11,
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
      color: colors.textSecondary,
      margin: '12px 0 6px',
    }}>
      <span style={{ flex: 1 }}>{children}</span>
      {right}
    </div>
  );
}

export function KV({ rows }: { rows: [string, ReactNode][] }) {
  const { colors } = useTheme();
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '3px 12px', fontSize: 12 }}>
      {rows.map(([k, v], i) => (
        <FragmentRow key={i} k={k} v={v} muted={colors.textSecondary} />
      ))}
    </div>
  );
}

function FragmentRow({ k, v, muted }: { k: string; v: ReactNode; muted: string }) {
  return (
    <>
      <div style={{ color: muted, whiteSpace: 'nowrap' }}>{k}</div>
      <div style={{ fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>{v}</div>
    </>
  );
}

export function Chip({ children, color }: { children: ReactNode; color?: string }) {
  const { colors } = useTheme();
  return (
    <span style={{
      display: 'inline-block',
      fontSize: 11,
      padding: '1px 7px',
      borderRadius: 10,
      backgroundColor: color ? `${color}22` : colors.bgHover,
      color: color ?? colors.textSecondary,
      border: `1px solid ${color ? `${color}55` : colors.border}`,
      marginRight: 4,
      marginBottom: 2,
      whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  const { colors } = useTheme();
  return (
    <div style={{
      backgroundColor: colors.bg,
      border: `1px solid ${colors.border}`,
      borderRadius: 8,
      padding: '10px 12px',
      marginBottom: 10,
      ...style,
    }}>
      {children}
    </div>
  );
}

export function Mm({ m }: { m: number | undefined | null }) {
  if (m === undefined || m === null || !isFinite(m)) return <span>-</span>;
  return <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{Math.round(m * 1000)} mm</span>;
}

export const panelStyle = (colors: ReturnType<typeof useTheme>['colors'], side: 'left' | 'right', width: number): CSSProperties => ({
  width,
  backgroundColor: colors.bgPanel,
  borderLeft: side === 'right' ? `1px solid ${colors.border}` : undefined,
  borderRight: side === 'left' ? `1px solid ${colors.border}` : undefined,
  display: 'flex',
  flexDirection: 'column',
  flexShrink: 0,
  overflow: 'hidden',
  minHeight: 0,
});

export const panelHeaderStyle = (colors: ReturnType<typeof useTheme>['colors']): CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 10px 8px 14px',
  borderBottom: `1px solid ${colors.border}`,
  fontSize: 12,
  fontWeight: 600,
  color: colors.textSecondary,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  flexShrink: 0,
});
