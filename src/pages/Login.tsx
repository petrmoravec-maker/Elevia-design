import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  
  const { login } = useAuth();
  const { colors } = useTheme();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(email, password);
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'Failed to sign in');
    } finally {
      setLoading(false);
    }
  };

  const styles = {
    container: {
      minHeight: '100vh',
      backgroundColor: colors.bg,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px',
    } as const,
    card: {
      backgroundColor: colors.bgPanel,
      borderRadius: '16px',
      padding: '40px',
      width: '100%',
      maxWidth: '400px',
      border: `1px solid ${colors.border}`,
    } as const,
    logo: {
      textAlign: 'center' as const,
      marginBottom: '32px',
    },
    logoText: {
      fontSize: '28px',
      fontWeight: 700,
      color: colors.text,
      letterSpacing: '-0.5px',
    } as const,
    tagline: {
      fontSize: '14px',
      color: colors.textSecondary,
      marginTop: '4px',
    } as const,
    form: {
      display: 'flex',
      flexDirection: 'column' as const,
      gap: '16px',
    },
    inputGroup: {
      display: 'flex',
      flexDirection: 'column' as const,
      gap: '6px',
    },
    label: {
      fontSize: '13px',
      fontWeight: 500,
      color: colors.textSecondary,
    } as const,
    input: {
      padding: '12px 14px',
      backgroundColor: colors.bg,
      border: `1px solid ${colors.border}`,
      borderRadius: '8px',
      color: colors.text,
      fontSize: '14px',
      outline: 'none',
      transition: 'border-color 0.2s',
    } as const,
    button: {
      padding: '12px 20px',
      backgroundColor: colors.accent,
      color: 'white',
      border: 'none',
      borderRadius: '8px',
      fontSize: '14px',
      fontWeight: 600,
      cursor: 'pointer',
      transition: 'background-color 0.2s',
      marginTop: '8px',
    } as const,
    error: {
      backgroundColor: 'rgba(239, 68, 68, 0.1)',
      border: '1px solid rgba(239, 68, 68, 0.3)',
      borderRadius: '8px',
      padding: '12px',
      color: colors.error,
      fontSize: '13px',
    } as const,
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.logo}>
          <div style={styles.logoText}>ELEVIA DESIGN</div>
          <div style={styles.tagline}>Your creative toolbox</div>
        </div>

        <form onSubmit={handleSubmit} style={styles.form}>
          {error && <div style={styles.error}>{error}</div>}
          
          <div style={styles.inputGroup}>
            <label style={styles.label}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={styles.input}
              placeholder="you@example.com"
              required
            />
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={styles.input}
              placeholder="••••••••"
              required
            />
          </div>

          <button 
            type="submit" 
            style={{
              ...styles.button,
              opacity: loading ? 0.7 : 1,
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
            disabled={loading}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
