import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, orderBy, limit, getDocs, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { TOOLS, type Tool } from '../data/tools';

interface RecentProject {
  id: string;
  name: string;
  toolId: string;
  updatedAt: Date;
}

export function ToolsDashboard() {
  const { currentUser, userData, logout } = useAuth();
  const { colors, theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);

  useEffect(() => {
    loadRecentProjects();
  }, [currentUser]);

  const loadRecentProjects = async () => {
    if (!currentUser) return;
    
    try {
      const q = query(
        collection(db, 'design_projects'),
        where('userId', '==', currentUser.uid),
        orderBy('updatedAt', 'desc'),
        limit(5)
      );
      
      const snapshot = await getDocs(q);
      const projects = snapshot.docs.map(doc => ({
        id: doc.id,
        name: doc.data().name,
        toolId: doc.data().toolId || 'floorplan',
        updatedAt: doc.data().updatedAt?.toDate() || new Date(),
      }));
      
      setRecentProjects(projects);
    } catch (error) {
      console.error('Error loading recent projects:', error);
    } finally {
      setLoadingProjects(false);
    }
  };

  const handleToolClick = (tool: Tool) => {
    if (tool.status === 'active') {
      navigate(tool.route);
    }
  };

  const formatTimeAgo = (date: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const styles = {
    container: {
      minHeight: '100vh',
      backgroundColor: colors.bg,
      padding: '40px',
    } as const,
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '60px',
      maxWidth: '1200px',
      margin: '0 auto 60px',
    } as const,
    headerLeft: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
    } as const,
    headerRight: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
    } as const,
    userButton: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '8px 16px',
      backgroundColor: colors.bgPanel,
      border: `1px solid ${colors.border}`,
      borderRadius: '8px',
      color: colors.text,
      fontSize: '14px',
      cursor: 'pointer',
    } as const,
    iconButton: {
      width: '40px',
      height: '40px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.bgPanel,
      border: `1px solid ${colors.border}`,
      borderRadius: '8px',
      color: colors.textSecondary,
      fontSize: '18px',
      cursor: 'pointer',
    } as const,
    main: {
      maxWidth: '1200px',
      margin: '0 auto',
    } as const,
    hero: {
      textAlign: 'center' as const,
      marginBottom: '60px',
    },
    title: {
      fontSize: '42px',
      fontWeight: 700,
      color: colors.text,
      letterSpacing: '-1px',
      marginBottom: '12px',
    } as const,
    subtitle: {
      fontSize: '18px',
      color: colors.textSecondary,
    } as const,
    toolsGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
      gap: '20px',
      marginBottom: '60px',
    } as const,
    toolCard: (tool: Tool, isHovered: boolean) => ({
      backgroundColor: colors.bgPanel,
      border: `1px solid ${isHovered && tool.status === 'active' ? tool.color : colors.border}`,
      borderRadius: '16px',
      padding: '28px',
      cursor: tool.status === 'active' ? 'pointer' : 'default',
      transition: 'all 0.2s ease',
      transform: isHovered && tool.status === 'active' ? 'translateY(-4px)' : 'none',
      boxShadow: isHovered && tool.status === 'active' 
        ? `0 12px 40px ${colors.shadow}` 
        : 'none',
      opacity: tool.status === 'coming_soon' ? 0.6 : 1,
    }),
    toolIcon: {
      fontSize: '48px',
      marginBottom: '16px',
    } as const,
    toolName: {
      fontSize: '18px',
      fontWeight: 600,
      color: colors.text,
      marginBottom: '8px',
    } as const,
    toolDescription: {
      fontSize: '14px',
      color: colors.textSecondary,
      lineHeight: 1.5,
    } as const,
    badge: (color: string) => ({
      display: 'inline-block',
      padding: '4px 10px',
      backgroundColor: `${color}20`,
      color: color,
      borderRadius: '20px',
      fontSize: '11px',
      fontWeight: 600,
      textTransform: 'uppercase' as const,
      letterSpacing: '0.5px',
      marginTop: '12px',
    }),
    section: {
      marginBottom: '40px',
    } as const,
    sectionTitle: {
      fontSize: '14px',
      fontWeight: 600,
      color: colors.textSecondary,
      textTransform: 'uppercase' as const,
      letterSpacing: '1px',
      marginBottom: '16px',
    } as const,
    projectsList: {
      backgroundColor: colors.bgPanel,
      borderRadius: '12px',
      border: `1px solid ${colors.border}`,
      overflow: 'hidden',
    } as const,
    projectItem: (isHovered: boolean) => ({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '16px 20px',
      borderBottom: `1px solid ${colors.border}`,
      cursor: 'pointer',
      backgroundColor: isHovered ? colors.bgHover : 'transparent',
      transition: 'background-color 0.15s',
    }),
    projectInfo: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
    } as const,
    projectIcon: {
      fontSize: '24px',
    } as const,
    projectName: {
      fontSize: '14px',
      fontWeight: 500,
      color: colors.text,
    } as const,
    projectMeta: {
      display: 'flex',
      alignItems: 'center',
      gap: '16px',
    } as const,
    projectTool: {
      fontSize: '12px',
      color: colors.textSecondary,
      backgroundColor: colors.bg,
      padding: '4px 10px',
      borderRadius: '4px',
    } as const,
    projectTime: {
      fontSize: '12px',
      color: colors.textMuted,
    } as const,
    emptyState: {
      padding: '40px',
      textAlign: 'center' as const,
      color: colors.textSecondary,
    },
  };

  const [hoveredTool, setHoveredTool] = useState<string | null>(null);
  const [hoveredProject, setHoveredProject] = useState<string | null>(null);

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          {/* Logo could go here */}
        </div>
        <div style={styles.headerRight}>
          <button style={styles.iconButton} onClick={toggleTheme} title="Toggle theme">
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          <button style={styles.userButton} onClick={() => logout()}>
            <span>{userData?.displayName || currentUser?.email?.split('@')[0]}</span>
            <span style={{ color: colors.textMuted }}>↗</span>
          </button>
        </div>
      </header>

      <main style={styles.main}>
        <div style={styles.hero}>
          <h1 style={styles.title}>ELEVIA DESIGN</h1>
          <p style={styles.subtitle}>Your creative toolbox</p>
        </div>

        <div style={styles.toolsGrid}>
          {TOOLS.map((tool) => (
            <div
              key={tool.id}
              style={styles.toolCard(tool, hoveredTool === tool.id)}
              onClick={() => handleToolClick(tool)}
              onMouseEnter={() => setHoveredTool(tool.id)}
              onMouseLeave={() => setHoveredTool(null)}
            >
              <div style={styles.toolIcon}>{tool.icon}</div>
              <div style={styles.toolName}>{tool.name}</div>
              <div style={styles.toolDescription}>{tool.description}</div>
              {tool.status === 'coming_soon' && (
                <div style={styles.badge(colors.textMuted)}>Coming Soon</div>
              )}
              {tool.status === 'beta' && (
                <div style={styles.badge(colors.warning)}>Beta</div>
              )}
            </div>
          ))}
        </div>

        {recentProjects.length > 0 && (
          <div style={styles.section}>
            <h2 style={styles.sectionTitle}>Recent Projects</h2>
            <div style={styles.projectsList}>
              {recentProjects.map((project, index) => {
                const tool = TOOLS.find(t => t.id === project.toolId);
                return (
                  <div
                    key={project.id}
                    style={{
                      ...styles.projectItem(hoveredProject === project.id),
                      borderBottom: index === recentProjects.length - 1 ? 'none' : undefined,
                    }}
                    onClick={() => navigate(`/${project.toolId}/${project.id}`)}
                    onMouseEnter={() => setHoveredProject(project.id)}
                    onMouseLeave={() => setHoveredProject(null)}
                  >
                    <div style={styles.projectInfo}>
                      <span style={styles.projectIcon}>{tool?.icon || '📄'}</span>
                      <span style={styles.projectName}>{project.name}</span>
                    </div>
                    <div style={styles.projectMeta}>
                      <span style={styles.projectTool}>{tool?.name || 'Unknown'}</span>
                      <span style={styles.projectTime}>{formatTimeAgo(project.updatedAt)}</span>
                      <span style={{ color: colors.textMuted }}>→</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {!loadingProjects && recentProjects.length === 0 && (
          <div style={styles.section}>
            <h2 style={styles.sectionTitle}>Recent Projects</h2>
            <div style={{ ...styles.projectsList, ...styles.emptyState }}>
              No projects yet. Select a tool above to get started.
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
