import { useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';

type ImportMethod = 'dwg' | 'pdf' | 'blank';

export function FloorplanImport() {
  const { currentUser } = useAuth();
  const { colors } = useTheme();
  const navigate = useNavigate();
  const { projectId } = useParams();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [projectName, setProjectName] = useState('');
  const [selectedMethod, setSelectedMethod] = useState<ImportMethod | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState('');

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      if (!projectName) {
        setProjectName(file.name.replace(/\.(dwg|pdf|dxf)$/i, ''));
      }
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) {
      const ext = file.name.split('.').pop()?.toLowerCase();
      if ((selectedMethod === 'dwg' && (ext === 'dwg' || ext === 'dxf')) ||
          (selectedMethod === 'pdf' && ext === 'pdf')) {
        setSelectedFile(file);
        if (!projectName) {
          setProjectName(file.name.replace(/\.(dwg|pdf|dxf)$/i, ''));
        }
      } else {
        setError(`Please select a ${selectedMethod?.toUpperCase()} file`);
      }
    }
  };

  const handleCreate = async () => {
    if (!projectName.trim()) {
      setError('Please enter a project name');
      return;
    }
    if (!currentUser) return;

    setUploading(true);
    setError('');

    try {
      // Create project document
      const projectData = {
        name: projectName.trim(),
        userId: currentUser.uid,
        toolId: 'floorplan',
        status: 'draft',
        importMethod: selectedMethod,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        roomCount: 0,
        scale: '1:100',
      };

      const docRef = await addDoc(collection(db, 'design_projects'), projectData);
      const newProjectId = docRef.id;

      // Upload file if selected
      if (selectedFile && (selectedMethod === 'dwg' || selectedMethod === 'pdf')) {
        const ext = selectedFile.name.split('.').pop()?.toLowerCase();
        const storagePath = `design/${newProjectId}/source/${selectedFile.name}`;
        const storageRef = ref(storage, storagePath);
        
        await uploadBytes(storageRef, selectedFile);
        const downloadURL = await getDownloadURL(storageRef);

        // Add file record
        await addDoc(collection(db, 'design_projects', newProjectId, 'files'), {
          name: selectedFile.name,
          type: ext,
          storagePath,
          downloadURL,
          status: selectedMethod === 'dwg' ? 'pending_conversion' : 'pending_analysis',
          uploadedAt: serverTimestamp(),
        });

        // TODO: Trigger conversion/analysis Cloud Function
      }

      // Navigate to editor or PDF review
      if (selectedMethod === 'pdf') {
        navigate(`/floorplan/${newProjectId}?review=true`);
      } else {
        navigate(`/floorplan/${newProjectId}`);
      }
    } catch (err: any) {
      console.error('Error creating project:', err);
      setError(err.message || 'Failed to create project');
    } finally {
      setUploading(false);
    }
  };

  const styles = {
    container: {
      minHeight: '100vh',
      backgroundColor: colors.bg,
    } as const,
    header: {
      display: 'flex',
      alignItems: 'center',
      padding: '20px 32px',
      borderBottom: `1px solid ${colors.border}`,
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
      marginRight: '16px',
    } as const,
    title: {
      fontSize: '20px',
      fontWeight: 600,
      color: colors.text,
    } as const,
    content: {
      maxWidth: '800px',
      margin: '0 auto',
      padding: '40px 32px',
    } as const,
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
    input: {
      width: '100%',
      padding: '14px 16px',
      backgroundColor: colors.bgPanel,
      border: `1px solid ${colors.border}`,
      borderRadius: '8px',
      color: colors.text,
      fontSize: '15px',
      outline: 'none',
    } as const,
    methodGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: '16px',
    } as const,
    methodCard: (isSelected: boolean) => ({
      backgroundColor: colors.bgPanel,
      border: `2px solid ${isSelected ? colors.accent : colors.border}`,
      borderRadius: '12px',
      padding: '24px',
      cursor: 'pointer',
      transition: 'all 0.2s',
      textAlign: 'center' as const,
    }),
    methodIcon: {
      fontSize: '40px',
      marginBottom: '12px',
    } as const,
    methodTitle: {
      fontSize: '15px',
      fontWeight: 600,
      color: colors.text,
      marginBottom: '4px',
    } as const,
    methodDesc: {
      fontSize: '12px',
      color: colors.textSecondary,
    } as const,
    dropzone: (isDragging: boolean) => ({
      border: `2px dashed ${isDragging ? colors.accent : colors.border}`,
      borderRadius: '12px',
      padding: '40px',
      textAlign: 'center' as const,
      cursor: 'pointer',
      transition: 'all 0.2s',
      backgroundColor: isDragging ? `${colors.accent}10` : 'transparent',
    }),
    dropzoneIcon: {
      fontSize: '48px',
      marginBottom: '16px',
    } as const,
    dropzoneText: {
      fontSize: '15px',
      color: colors.text,
      marginBottom: '8px',
    } as const,
    dropzoneHint: {
      fontSize: '13px',
      color: colors.textSecondary,
    } as const,
    selectedFile: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '12px 16px',
      backgroundColor: colors.bgPanel,
      border: `1px solid ${colors.accent}`,
      borderRadius: '8px',
      marginTop: '16px',
    } as const,
    fileName: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      fontSize: '14px',
      color: colors.text,
    } as const,
    removeFile: {
      background: 'none',
      border: 'none',
      color: colors.textSecondary,
      cursor: 'pointer',
      fontSize: '18px',
    } as const,
    actions: {
      display: 'flex',
      justifyContent: 'flex-end',
      gap: '12px',
      paddingTop: '20px',
      borderTop: `1px solid ${colors.border}`,
    } as const,
    cancelButton: {
      padding: '12px 24px',
      backgroundColor: 'transparent',
      border: `1px solid ${colors.border}`,
      borderRadius: '8px',
      color: colors.text,
      fontSize: '14px',
      fontWeight: 500,
      cursor: 'pointer',
    } as const,
    createButton: (disabled: boolean) => ({
      padding: '12px 24px',
      backgroundColor: disabled ? colors.textMuted : colors.accent,
      border: 'none',
      borderRadius: '8px',
      color: 'white',
      fontSize: '14px',
      fontWeight: 500,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.6 : 1,
    }),
    error: {
      backgroundColor: `${colors.error}15`,
      border: `1px solid ${colors.error}30`,
      borderRadius: '8px',
      padding: '12px 16px',
      color: colors.error,
      fontSize: '13px',
      marginBottom: '20px',
    } as const,
  };

  const [isDragging, setIsDragging] = useState(false);

  const canCreate = projectName.trim() && selectedMethod && 
    (selectedMethod === 'blank' || selectedFile);

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <button style={styles.backButton} onClick={() => navigate('/floorplan')}>
          ←
        </button>
        <h1 style={styles.title}>New Floorplan Project</h1>
      </header>

      <div style={styles.content}>
        {error && <div style={styles.error}>{error}</div>}

        <div style={styles.section}>
          <div style={styles.sectionTitle}>Project Name</div>
          <input
            type="text"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="My Facility Expansion"
            style={styles.input}
          />
        </div>

        <div style={styles.section}>
          <div style={styles.sectionTitle}>Start From</div>
          <div style={styles.methodGrid}>
            <div
              style={styles.methodCard(selectedMethod === 'dwg')}
              onClick={() => { setSelectedMethod('dwg'); setSelectedFile(null); }}
            >
              <div style={styles.methodIcon}>📁</div>
              <div style={styles.methodTitle}>DWG/DXF File</div>
              <div style={styles.methodDesc}>Import CAD drawing</div>
            </div>
            <div
              style={styles.methodCard(selectedMethod === 'pdf')}
              onClick={() => { setSelectedMethod('pdf'); setSelectedFile(null); }}
            >
              <div style={styles.methodIcon}>📄</div>
              <div style={styles.methodTitle}>PDF Plan</div>
              <div style={styles.methodDesc}>AI analyzes & redraws</div>
            </div>
            <div
              style={styles.methodCard(selectedMethod === 'blank')}
              onClick={() => { setSelectedMethod('blank'); setSelectedFile(null); }}
            >
              <div style={styles.methodIcon}>✨</div>
              <div style={styles.methodTitle}>Start Blank</div>
              <div style={styles.methodDesc}>Draw with AI from scratch</div>
            </div>
          </div>
        </div>

        {(selectedMethod === 'dwg' || selectedMethod === 'pdf') && (
          <div style={styles.section}>
            <div style={styles.sectionTitle}>Upload File</div>
            <div
              style={styles.dropzone(isDragging)}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => { setIsDragging(false); handleDrop(e); }}
              onClick={() => fileInputRef.current?.click()}
            >
              <div style={styles.dropzoneIcon}>
                {selectedMethod === 'dwg' ? '📐' : '📄'}
              </div>
              <div style={styles.dropzoneText}>
                Drop your {selectedMethod === 'dwg' ? 'DWG/DXF' : 'PDF'} file here
              </div>
              <div style={styles.dropzoneHint}>
                or click to browse
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept={selectedMethod === 'dwg' ? '.dwg,.dxf' : '.pdf'}
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />
            {selectedFile && (
              <div style={styles.selectedFile}>
                <div style={styles.fileName}>
                  <span>{selectedMethod === 'dwg' ? '📐' : '📄'}</span>
                  <span>{selectedFile.name}</span>
                  <span style={{ color: colors.textMuted }}>
                    ({(selectedFile.size / 1024 / 1024).toFixed(2)} MB)
                  </span>
                </div>
                <button
                  style={styles.removeFile}
                  onClick={(e) => { e.stopPropagation(); setSelectedFile(null); }}
                >
                  ×
                </button>
              </div>
            )}
          </div>
        )}

        {selectedMethod === 'pdf' && selectedFile && (
          <div style={{
            padding: '16px',
            backgroundColor: `${colors.info}15`,
            border: `1px solid ${colors.info}30`,
            borderRadius: '8px',
            fontSize: '13px',
            color: colors.info,
          }}>
            💡 AI will analyze your PDF and recreate the floor plan. You'll be able to review and adjust before continuing.
          </div>
        )}

        <div style={styles.actions}>
          <button style={styles.cancelButton} onClick={() => navigate('/floorplan')}>
            Cancel
          </button>
          <button
            style={styles.createButton(!canCreate || uploading)}
            disabled={!canCreate || uploading}
            onClick={handleCreate}
          >
            {uploading ? 'Creating...' : selectedMethod === 'pdf' ? 'Create & Analyze' : 'Create Project'}
          </button>
        </div>
      </div>
    </div>
  );
}
