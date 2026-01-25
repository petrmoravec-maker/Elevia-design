import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, orderBy, getDocs, where, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';

interface Project {
  id: string;
  name: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
  thumbnail?: string;
  roomCount?: number;
  status?: 'draft' | 'in_progress' | 'completed';
}

export function FloorplanDashboard() {
  const { currentUser } = useAuth();
  const { colors } = useTheme();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
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
        where('toolId', '==', 'floorplan'),
        orderBy('updatedAt', 'desc')
      );
      
      const snapshot = await getDocs(q);
      const projectList = snapshot.docs.map(doc => ({
        id: doc.id,
        name: doc.data().name,
        description: doc.data().description,
        createdAt: doc.data().createdAt?.toDate() || new Date(),
        updatedAt: doc.data().updatedAt?.toDate() || new Date(),
        thumbnail: doc.data().thumbnail,
        roomCount: doc.data().roomCount || 0,
        status: doc.data().status || 'draft',
      }));
      
      setProjects(projectList);
    } catch (error) {
      console.error('Error loading projects:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    if (!confirm('Delete this project? This cannot be undone.')) return;
    
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
          <h1 style={styles.title}>📐 Floorplan</h1>
        </div>
        <button style={styles.newButton} onClick={() => navigate('/floorplan/new')}>
          <span>+</span>
          New Project
        </button>
      </header>

      <div style={styles.content}>
        {loading ? (
          <div style={styles.emptyState}>Loading...</div>
        ) : projects.length === 0 ? (
          <div style={styles.emptyState}>
            <div style={styles.emptyIcon}>📐</div>
            <div style={styles.emptyTitle}>No projects yet</div>
            <div style={styles.emptyText}>
              Create your first floorplan project to get started
            </div>
            <button style={styles.newButton} onClick={() => navigate('/floorplan/new')}>
              <span>+</span>
              New Project
            </button>
          </div>
        ) : (
          <div style={styles.grid}>
            {projects.map((project) => (
              <div
                key={project.id}
                style={styles.card(hoveredProject === project.id)}
                onClick={() => navigate(`/floorplan/${project.id}`)}
                onMouseEnter={() => setHoveredProject(project.id)}
                onMouseLeave={() => setHoveredProject(null)}
                onContextMenu={(e) => handleContextMenu(e, project.id)}
              >
                <div style={styles.thumbnail}>
                  {project.thumbnail ? (
                    <img src={project.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    '📐'
                  )}
                </div>
                <div style={styles.cardContent}>
                  <div style={styles.cardTitle}>{project.name}</div>
                  <div style={styles.cardMeta}>
                    <span>{formatDate(project.updatedAt)}</span>
                    <span>•</span>
                    <span>{project.roomCount} rooms</span>
                    <span style={styles.statusBadge(project.status || 'draft')}>
                      {project.status || 'Draft'}
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
            onClick={() => navigate(`/floorplan/${contextMenu.projectId}`)}
          >
            ✏️ Open
          </div>
          <div 
            style={styles.contextMenuItem}
            onClick={() => {/* duplicate logic */}}
          >
            📋 Duplicate
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
