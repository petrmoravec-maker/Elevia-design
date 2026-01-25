import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

type Theme = 'dark' | 'light';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  colors: typeof darkColors;
}

// Dark theme colors (Figma-style)
const darkColors = {
  // Backgrounds
  bg: '#0f0f0f',
  bgPanel: '#1a1a1a',
  bgHover: '#252525',
  bgActive: '#2a2a2a',
  
  // Canvas
  canvas: '#1e1e1e',
  canvasGrid: '#2a2a2a',
  
  // Text
  text: '#f5f5f5',
  textSecondary: '#a1a1a1',
  textMuted: '#6b6b6b',
  
  // Borders
  border: '#2a2a2a',
  borderHover: '#3a3a3a',
  
  // Accent (Indigo)
  accent: '#6366f1',
  accentHover: '#818cf8',
  accentMuted: '#4f46e5',
  
  // Status
  success: '#10b981',
  warning: '#f59e0b',
  error: '#ef4444',
  info: '#3b82f6',
  
  // Shadows
  shadow: 'rgba(0, 0, 0, 0.3)',
  shadowLg: 'rgba(0, 0, 0, 0.5)',
};

// Light theme colors
const lightColors = {
  bg: '#ffffff',
  bgPanel: '#f5f5f5',
  bgHover: '#e5e5e5',
  bgActive: '#d4d4d4',
  
  canvas: '#fafafa',
  canvasGrid: '#e5e5e5',
  
  text: '#171717',
  textSecondary: '#525252',
  textMuted: '#a3a3a3',
  
  border: '#e5e5e5',
  borderHover: '#d4d4d4',
  
  accent: '#6366f1',
  accentHover: '#4f46e5',
  accentMuted: '#818cf8',
  
  success: '#10b981',
  warning: '#f59e0b',
  error: '#ef4444',
  info: '#3b82f6',
  
  shadow: 'rgba(0, 0, 0, 0.1)',
  shadowLg: 'rgba(0, 0, 0, 0.2)',
};

const ThemeContext = createContext<ThemeContextType | null>(null);

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('elevia-design-theme');
    return (saved as Theme) || 'dark';
  });

  useEffect(() => {
    localStorage.setItem('elevia-design-theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  const colors = theme === 'dark' ? darkColors : lightColors;

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, colors }}>
      {children}
    </ThemeContext.Provider>
  );
}
