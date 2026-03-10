import { useParams } from 'react-router-dom';
import { SplineConfigTool } from '@/components/3d-config';

export default function Config3DEditor() {
  const { projectId } = useParams<{ projectId: string }>();

  return (
    <div style={{ width: '100%', height: '100vh', overflow: 'hidden' }}>
      <SplineConfigTool projectId={projectId} />
    </div>
  );
}
