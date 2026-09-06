import { useState, useRef, useCallback } from 'react';
import { useTheme } from '../../contexts/ThemeContext';

interface AiCommandBarProps {
  projectId: string;
  onAction?: (action: ParsedAction) => void;
}

export interface ParsedAction {
  type: 'createRoom' | 'placeEquipment' | 'addNote' | 'unknown';
  params: Record<string, unknown>;
  rawText: string;
}

interface CommandHistoryItem {
  id: string;
  userMessage: string;
  aiResponse: string;
  timestamp: Date;
}

/**
 * Parse a natural-language command into a structured action.
 * This is a lightweight local parser that handles common facility planning phrases.
 * Intended to be replaced with a Cloud Function (designAiChat) once deployed.
 */
function parseCommand(text: string): { response: string; action?: ParsedAction } {
  const lower = text.toLowerCase().trim();

  // "add a [room type] room [W]x[H]m?" e.g. "add a flower room 5x4m"
  const roomMatch = lower.match(
    /(?:add|create|draw|place)\s+(?:a\s+)?(?:new\s+)?(\w[\w\s]*?)\s+room(?:\s+(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?))?/
  );
  if (roomMatch) {
    const roomTypeRaw = roomMatch[1].trim();
    const width = roomMatch[2] ? parseFloat(roomMatch[2]) : undefined;
    const height = roomMatch[3] ? parseFloat(roomMatch[3]) : undefined;
    const roomTypeMap: Record<string, string> = {
      flower: 'grow_flower', flowering: 'grow_flower',
      veg: 'grow_veg', vegetative: 'grow_veg', vegetation: 'grow_veg',
      clone: 'clone', cloning: 'clone', propagation: 'clone',
      dry: 'dry', drying: 'dry',
      cure: 'cure', curing: 'cure',
      processing: 'processing', trim: 'processing', trimming: 'processing',
      utility: 'utility', mechanical: 'utility',
      storage: 'storage',
      office: 'office',
      bathroom: 'bathroom', restroom: 'bathroom',
    };
    const roomTypeId = roomTypeMap[roomTypeRaw] ?? 'grow_veg';
    const sizeNote = width && height ? ` (${width}m × ${height}m)` : '';
    return {
      response: `Creating a ${roomTypeRaw} room${sizeNote}. Click on the canvas to place it, or switch to the Room tool to draw manually.`,
      action: {
        type: 'createRoom',
        params: { roomTypeId, width, height },
        rawText: text,
      },
    };
  }

  // "place [equipment]" e.g. "place a dehumidifier 180ppd in room 2"
  const equipMatch = lower.match(/(?:place|add|install|put)\s+(?:a\s+)?(.+?)(?:\s+in\s+.+)?$/);
  if (equipMatch) {
    const equipDesc = equipMatch[1].trim();
    return {
      response: `To place equipment: switch to the Equipment tool (E), select "${equipDesc}" from the catalog, and click on the canvas to place it.`,
      action: {
        type: 'placeEquipment',
        params: { description: equipDesc },
        rawText: text,
      },
    };
  }

  // Help and info
  if (lower.includes('help') || lower === '?') {
    return {
      response: 'Try commands like: "add a flower room 5x4m", "create a veg room", "place a dehumidifier". ' +
        'You can also use the toolbar tools directly: Room (R), Wall (W), Equipment (E), Measure (M).',
    };
  }

  return {
    response: `Command understood: "${text}". Use the toolbar tools to draw rooms (R), walls (W), place equipment (E), or measure (M). ` +
      'AI-powered commands will be available once the cloud service is connected.',
    action: { type: 'unknown', params: {}, rawText: text },
  };
}

export function AiCommandBar({ projectId: _projectId, onAction }: AiCommandBarProps) {
  const { colors } = useTheme();
  const inputRef = useRef<HTMLInputElement>(null);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<CommandHistoryItem[]>([]);
  const [lastResponse, setLastResponse] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);

  const handleSubmit = useCallback(async () => {
    const userMessage = input.trim();
    if (!userMessage || isProcessing) return;

    setInput('');
    setIsProcessing(true);
    setLastResponse(null);

    try {
      const { response, action } = parseCommand(userMessage);

      setHistory(prev => [{
        id: Date.now().toString(),
        userMessage,
        aiResponse: response,
        timestamp: new Date(),
      }, ...prev].slice(0, 10));

      setLastResponse(response);

      if (action && onAction) {
        onAction(action);
      }
    } catch (error: any) {
      setLastResponse(`Error: ${error.message || 'Failed to process command'}`);
    } finally {
      setIsProcessing(false);
    }
  }, [input, isProcessing, onAction]);

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

  const handleVoiceToggle = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setLastResponse('Voice input is not supported in this browser. Try Chrome or Edge.');
      return;
    }

    if (isRecording && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsRecording(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setInput(transcript);
      setIsRecording(false);
    };

    recognition.onerror = () => {
      setIsRecording(false);
    };

    recognition.onend = () => {
      setIsRecording(false);
    };

    recognition.start();
    setIsRecording(true);
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
      alignItems: 'flex-start',
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
          onClick={handleVoiceToggle}
          title={isRecording ? 'Stop recording' : 'Voice input'}
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
          placeholder={isProcessing ? 'Processing...' : 'Try: "add a flower room 5x4m" or press /'}
          style={styles.input}
          disabled={isProcessing}
        />
        <button
          style={styles.historyButton(showHistory)}
          onClick={() => setShowHistory(!showHistory)}
          title={showHistory ? 'Hide history' : 'Show history'}
        >
          {showHistory ? '▼' : '▲'}
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

      {lastResponse && (
        <div style={styles.toast}>
          <span style={{ color: colors.accent, flexShrink: 0 }}>✓</span>
          <span style={{ flex: 1 }}>{lastResponse}</span>
          <button
            style={{ background: 'none', border: 'none', color: colors.textMuted, cursor: 'pointer', flexShrink: 0 }}
            onClick={() => setLastResponse(null)}
          >
            ×
          </button>
        </div>
      )}

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
