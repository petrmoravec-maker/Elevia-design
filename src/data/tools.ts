// Tool Registry - Add new tools here and they'll appear on the dashboard

export interface Tool {
  id: string;
  name: string;
  description: string;
  icon: string;
  status: 'active' | 'coming_soon' | 'beta';
  route: string;
  color: string;
}

export const TOOLS: Tool[] = [
  {
    id: 'floorplan',
    name: 'Floorplan',
    description: 'AI-assisted facility MEP design',
    icon: '📐',
    status: 'active',
    route: '/floorplan',
    color: '#6366f1', // Indigo
  },
  {
    id: 'product-designer',
    name: 'Product Designer',
    description: 'Design product packaging and labels',
    icon: '🎨',
    status: 'coming_soon',
    route: '/product-designer',
    color: '#ec4899', // Pink
  },
  {
    id: '3d-viewer',
    name: '3D Viewer',
    description: 'Visualize designs in 3D',
    icon: '📦',
    status: 'coming_soon',
    route: '/3d-viewer',
    color: '#10b981', // Emerald
  },
  {
    id: 'automation',
    name: 'Automation',
    description: 'Design control systems and workflows',
    icon: '⚡',
    status: 'coming_soon',
    route: '/automation',
    color: '#f59e0b', // Amber
  },
];

export function getActiveTool(toolId: string): Tool | undefined {
  return TOOLS.find(t => t.id === toolId && t.status === 'active');
}

export function getActiveTools(): Tool[] {
  return TOOLS.filter(t => t.status === 'active');
}
