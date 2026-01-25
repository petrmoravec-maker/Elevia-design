import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import type { ReactNode } from 'react';

interface PrivateRouteProps {
  children: ReactNode;
}

export function PrivateRoute({ children }: PrivateRouteProps) {
  const { currentUser, loading } = useAuth();
  const { colors } = useTheme();

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        backgroundColor: colors.bg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '16px',
        }}>
          {/* Loading spinner */}
          <div style={{
            width: '40px',
            height: '40px',
            border: `3px solid ${colors.border}`,
            borderTopColor: colors.accent,
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
          }} />
          <style>{`
            @keyframes spin {
              to { transform: rotate(360deg); }
            }
          `}</style>
          <span style={{ color: colors.textSecondary, fontSize: '14px' }}>
            Loading...
          </span>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
