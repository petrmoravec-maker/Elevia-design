import { useState, useRef, useCallback } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase';
import { useTheme } from '../../contexts/ThemeContext';

interface AiCommandBarProps {
  projectId: string;
}

interface CommandHistoryItem {
  id: string;
  userMessage: string;
  aiResponse: string;
  timestamp: Date;
}

export function AiCommandBar({ projectId }: AiCommandBarProps) {
  const { colors } = useTheme();
  const inputRef = useRef<HTMLInputElement>(null);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<CommandHistoryItem[]>([]);
  const [lastResponse, setLastResponse] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    if (!input.trim() || isProcessing) return;

    const userMessage = input.trim();
    setInput('');
    setIsProcessing(true);
    setLastResponse(null);

    try {
      // Call Claude API via Cloud Function
      const designAiChat = httpsCallable(functions, 'designAiChat');
      const result = await designAiChat({
        projectId,
        message: userMessage,
      });

      const response = result.data as { text: string; actions?: any[] };
      
      // Add to history
      setHistory(prev => [{
        id: Date.now().toString(),
        userMessage,
        aiResponse: response.text,
        timestamp: new Date(),
      }, ...prev].slice(0, 10));

      setLastResponse(response.text);

      // TODO: Execute actions on canvas
      if (response.actions) {
        // Apply actions to canvas
      }
    } catch (error: any) {
      console.error('AI command error:', error);
      setLastResponse(`Error: ${error.message || 'Failed to process command'}`);
    } finally {
      setIsProcessing(false);
    }
  }, [input, projectId, isProcessing]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') {
      setInput('');
      inputRef.current?.blur();
    }
  };

  const handleVoiceStart = () => {
    // Check for browser support
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setLastResponse('Voice input not supported in this browser');
      return;
    }

    setIsRecording(true);
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setInput(transcript);
      setIsRecording(false);
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      setIsRecording(false);
    };

    recognition.onend = () => {
      setIsRecording(false);
    };

    recognition.start();
  };

  const styles = {
    container: {
      padding: '8px 16px',
      borderBottom: `1px solid ${colors.border}`,
    } as const,
    bar: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '8px 12px',
      backgroundColor: colors.bg,
      borderRadius: '8px',
      border: `1px solid ${colors.border}`,
    } as const,
    voiceButton: (isActive: boolean) => ({
      width: '32px',
      height: '32px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: isActive ? colors.error : 'transparent',
      border: 'none',
      borderRadius: '6px',
      color: isActive ? 'white' : colors.textSecondary,
      fontSize: '16px',
      cursor: 'pointer',
      transition: 'all 0.2s',
    }),
    input: {
      flex: 1,
      backgroundColor: 'transparent',
      border: 'none',
      color: colors.text,
      fontSize: '14px',
      outline: 'none',
    } as const,
    historyButton: (isActive: boolean) => ({
      width: '32px',
      height: '32px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: isActive ? colors.bgActive : 'transparent',
      border: 'none',
      borderRadius: '6px',
      color: colors.textSecondary,
      fontSize: '14px',
      cursor: 'pointer',
    }),
    sendButton: {
      padding: '6px 12px',
      backgroundColor: colors.accent,
      border: 'none',
      borderRadius: '6px',
      color: 'white',
      fontSize: '12px',
      fontWeight: 500,
      cursor: 'pointer',
    } as const,
    toast: {
      marginTop: '8px',
      padding: '10px 14px',
      backgroundColor: colors.bgPanel,
      border: `1px solid ${colors.border}`,
      borderRadius: '8px',
      fontSize: '13px',
      color: colors.text,
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
    } as const,
    historyPanel: {
      marginTop: '8px',
      maxHeight: '200px',
      overflow: 'auto',
      backgroundColor: colors.bgPanel,
      border: `1px solid ${colors.border}`,
      borderRadius: '8px',
    } as const,
    historyItem: {
      padding: '10px 14px',
      borderBottom: `1px solid ${colors.border}`,
    } as const,
    historyUser: {
      fontSize: '12px',
      color: colors.textSecondary,
      marginBottom: '4px',
    } as const,
    historyAi: {
      fontSize: '13px',
      color: colors.text,
    } as const,
  };

  return (
    <div style={styles.container}>
      <div style={styles.bar}>
        <button
          style={styles.voiceButton(isRecording)}
          onClick={handleVoiceStart}
          disabled={isRecording}
          title="Voice input (hold to speak)"
        >
          🎤
        </button>
        <input
          ref={inputRef}
          id="ai-command-input"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isProcessing ? 'Processing...' : 'Type a command or press / ...'}
          style={styles.input}
          disabled={isProcessing}
        />
        <button
          style={styles.historyButton(showHistory)}
          onClick={() => setShowHistory(!showHistory)}
          title="Show history"
        >
          ▲
        </button>
        <button
          style={{
            ...styles.sendButton,
            opacity: !input.trim() || isProcessing ? 0.5 : 1,
          }}
          onClick={handleSubmit}
          disabled={!input.trim() || isProcessing}
        >
          {isProcessing ? '...' : 'Send'}
        </button>
      </div>

      {/* Last response toast */}
      {lastResponse && (
        <div style={styles.toast}>
          <span style={{ color: colors.accent }}>✓</span>
          {lastResponse}
          <button
            style={{ marginLeft: 'auto', background: 'none', border: 'none', color: colors.textMuted, cursor: 'pointer' }}
            onClick={() => setLastResponse(null)}
          >
            ×
          </button>
        </div>
      )}

      {/* History panel */}
      {showHistory && history.length > 0 && (
        <div style={styles.historyPanel}>
          {history.map((item, index) => (
            <div 
              key={item.id} 
              style={{
                ...styles.historyItem,
                borderBottom: index === history.length - 1 ? 'none' : undefined,
              }}
            >
              <div style={styles.historyUser}>You: {item.userMessage}</div>
              <div style={styles.historyAi}>{item.aiResponse}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
