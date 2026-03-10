import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, orderBy, getDocs, where, deleteDoc, doc, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';

interface Config3DProject {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  status: 'draft' | 'in_progress' | 'completed';
}

export function Config3DDashboard() {
  const { currentUser } = useAuth();
  const { colors } = useTheme();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Config3DProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [hoveredProject, setHoveredProject] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; projectId: string } | null>(null);

  useEffect(() => {
    loadProjects();
  }, [currentUser]);

  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  const loadProjects = async () => {
    if (!currentUser) return;

    try {
      const q = query(
        collection(db, 'design_projects'),
        where('userId', '==', currentUser.uid),
        where('toolId', '==', '3d-config'),
        orderBy('updatedAt', 'desc')
      );

      const snapshot = await getDocs(q);
      const projectList = snapshot.docs.map(d => ({
        id: d.id,
        name: d.data().name,
        createdAt: d.data().createdAt?.toDate() || new Date(),
        updatedAt: d.data().updatedAt?.toDate() || new Date(),
        status: d.data().status || 'draft',
      }));

      setProjects(projectList);
    } catch (error) {
      console.error('Error loading 3D config projects:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleNewProject = async () => {
    if (!currentUser) return;

    try {
      const docRef = await addDoc(collection(db, 'design_projects'), {
        name: 'Untitled Config',
        userId: currentUser.uid,
        toolId: '3d-config',
        status: 'draft',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        configData: null,
      });
      navigate(`/3d-config/${docRef.id}`);
    } catch (error) {
      console.error('Error creating project:', error);
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    if (!confirm('Delete this configuration? This cannot be undone.')) return;

    try {
      await deleteDoc(doc(db, 'design_projects', projectId));
      setProjects(prev => prev.filter(p => p.id !== projectId));
    } catch (error) {
      console.error('Error deleting project:', error);
    }
  };

  const handleContextMenu = (e: React.MouseEvent, projectId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, projectId });
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
    });
  };

  const styles = {
    container: {
      minHeight: '100vh',
      backgroundColor: colors.bg,
    } as const,
    header: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '20px 32px',
      borderBottom: `1px solid ${colors.border}`,
    } as const,
    headerLeft: {
      display: 'flex',
      alignItems: 'center',
      gap: '16px',
    } as const,
    backButton: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '36px',
      height: '36px',
      backgroundColor: 'transparent',
      border: `1px solid ${colors.border}`,
      borderRadius: '8px',
      color: colors.textSecondary,
      fontSize: '18px',
      cursor: 'pointer',
    } as const,
    title: {
      fontSize: '20px',
      fontWeight: 600,
      color: colors.text,
    } as const,
    newButton: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '10px 20px',
      backgroundColor: colors.accent,
      border: 'none',
      borderRadius: '8px',
      color: 'white',
      fontSize: '14px',
      fontWeight: 500,
      cursor: 'pointer',
    } as const,
    content: {
      padding: '32px',
      maxWidth: '1400px',
      margin: '0 auto',
    } as const,
    grid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
      gap: '20px',
    } as const,
    card: (isHovered: boolean) => ({
      backgroundColor: colors.bgPanel,
      border: `1px solid ${isHovered ? colors.accent : colors.border}`,
      borderRadius: '12px',
      overflow: 'hidden',
      cursor: 'pointer',
      transition: 'all 0.2s',
      transform: isHovered ? 'translateY(-2px)' : 'none',
      boxShadow: isHovered ? `0 8px 24px ${colors.shadow}` : 'none',
    }),
    thumbnail: {
      width: '100%',
      height: '160px',
      backgroundColor: colors.canvas,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '48px',
      color: colors.textMuted,
    } as const,
    cardContent: {
      padding: '16px',
    } as const,
    cardTitle: {
      fontSize: '15px',
      fontWeight: 600,
      color: colors.text,
      marginBottom: '4px',
    } as const,
    cardMeta: {
      fontSize: '12px',
      color: colors.textSecondary,
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
    } as const,
    statusBadge: (status: string) => ({
      padding: '2px 8px',
      borderRadius: '4px',
      fontSize: '11px',
      fontWeight: 500,
      backgroundColor: status === 'completed' ? `${colors.success}20` :
                       status === 'in_progress' ? `${colors.warning}20` :
                       `${colors.textMuted}20`,
      color: status === 'completed' ? colors.success :
             status === 'in_progress' ? colors.warning :
             colors.textMuted,
    }),
    emptyState: {
      textAlign: 'center' as const,
      padding: '80px 20px',
      color: colors.textSecondary,
    },
    emptyIcon: {
      fontSize: '64px',
      marginBottom: '16px',
    } as const,
    emptyTitle: {
      fontSize: '18px',
      fontWeight: 600,
      color: colors.text,
      marginBottom: '8px',
    } as const,
    emptyText: {
      fontSize: '14px',
      marginBottom: '24px',
    } as const,
    contextMenu: {
      position: 'fixed' as const,
      backgroundColor: colors.bgPanel,
      border: `1px solid ${colors.border}`,
      borderRadius: '8px',
      boxShadow: `0 8px 24px ${colors.shadowLg}`,
      overflow: 'hidden',
      zIndex: 1000,
    },
    contextMenuItem: {
      padding: '10px 16px',
      fontSize: '13px',
      color: colors.text,
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
    } as const,
  };

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <button style={styles.backButton} onClick={() => navigate('/')}>
            ←
          </button>
          <h1 style={styles.title}>3D Config Tool</h1>
        </div>
        <button style={styles.newButton} onClick={handleNewProject}>
          <span>+</span>
          New Configuration
        </button>
      </header>

      <div style={styles.content}>
        {loading ? (
          <div style={styles.emptyState}>Loading...</div>
        ) : projects.length === 0 ? (
          <div style={styles.emptyState}>
            <div style={styles.emptyIcon}>🎮</div>
            <div style={styles.emptyTitle}>No configurations yet</div>
            <div style={styles.emptyText}>
              Create your first 3D scroll animation configuration
            </div>
            <button style={styles.newButton} onClick={handleNewProject}>
              <span>+</span>
              New Configuration
            </button>
          </div>
        ) : (
          <div style={styles.grid}>
            {projects.map((project) => (
              <div
                key={project.id}
                style={styles.card(hoveredProject === project.id)}
                onClick={() => navigate(`/3d-config/${project.id}`)}
                onMouseEnter={() => setHoveredProject(project.id)}
                onMouseLeave={() => setHoveredProject(null)}
                onContextMenu={(e) => handleContextMenu(e, project.id)}
              >
                <div style={styles.thumbnail}>🎮</div>
                <div style={styles.cardContent}>
                  <div style={styles.cardTitle}>{project.name}</div>
                  <div style={styles.cardMeta}>
                    <span>{formatDate(project.updatedAt)}</span>
                    <span style={styles.statusBadge(project.status)}>
                      {project.status === 'in_progress' ? 'In Progress' : project.status.charAt(0).toUpperCase() + project.status.slice(1)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {contextMenu && (
        <div
          style={{ ...styles.contextMenu, left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            style={styles.contextMenuItem}
            onClick={() => navigate(`/3d-config/${contextMenu.projectId}`)}
          >
            ✏️ Open
          </div>
          <div
            style={{ ...styles.contextMenuItem, color: colors.error }}
            onClick={() => handleDeleteProject(contextMenu.projectId)}
          >
            🗑️ Delete
          </div>
        </div>
      )}
    </div>
  );
}
