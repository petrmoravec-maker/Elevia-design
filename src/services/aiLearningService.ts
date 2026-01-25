/**
 * AI Learning Service
 * 
 * Stores AI interactions and learns user preferences over time.
 * Similar to the irrigation AI learning system.
 */

import { 
  collection, 
  addDoc, 
  query, 
  where, 
  orderBy, 
  limit, 
  getDocs,
  doc,
  setDoc,
  serverTimestamp,
  Timestamp
} from 'firebase/firestore';
import { db } from '../firebase';

// Types
export interface AIInteraction {
  id?: string;
  userId: string;
  projectId: string;
  timestamp: Date;
  userMessage: string;
  aiResponse: string;
  toolsCalled: {
    name: string;
    params: Record<string, any>;
    result?: any;
  }[];
  tokensUsed: {
    input: number;
    output: number;
  };
  responseTimeMs?: number;
  feedback?: 'positive' | 'negative';
  feedbackComment?: string;
}

export interface AILearningEvent {
  id?: string;
  userId: string;
  timestamp: Date;
  type: 'pattern' | 'preference' | 'correction' | 'optimization';
  trigger: string;
  observation: string;
  adjustment: string;
  confidence: number;
  appliedTo: string[];
}

export interface UserPatterns {
  userId: string;
  lastUpdated: Date;
  preferences: {
    equipmentPreferences: Record<string, Record<string, string>>;
    layoutPatterns: Record<string, any>;
    electricalPreferences: Record<string, any>;
    plumbingPreferences: Record<string, any>;
  };
  confidence: number;
}

// Log an AI interaction
export async function logAIInteraction(
  interaction: Omit<AIInteraction, 'id' | 'timestamp'>
): Promise<string> {
  const ref = await addDoc(collection(db, 'design_ai_interactions'), {
    ...interaction,
    timestamp: serverTimestamp(),
  });
  return ref.id;
}

// Add feedback to an interaction
export async function addInteractionFeedback(
  interactionId: string,
  feedback: 'positive' | 'negative',
  comment?: string
): Promise<void> {
  const ref = doc(db, 'design_ai_interactions', interactionId);
  await setDoc(ref, {
    feedback,
    feedbackComment: comment || null,
  }, { merge: true });
}

// Get recent interactions for a user
export async function getRecentInteractions(
  userId: string,
  limitCount: number = 50
): Promise<AIInteraction[]> {
  const q = query(
    collection(db, 'design_ai_interactions'),
    where('userId', '==', userId),
    orderBy('timestamp', 'desc'),
    limit(limitCount)
  );
  
  const snapshot = await getDocs(q);
  return snapshot.docs.map(d => ({
    id: d.id,
    ...d.data(),
    timestamp: d.data().timestamp?.toDate(),
  })) as AIInteraction[];
}

// Log a learning event
export async function logLearningEvent(
  event: Omit<AILearningEvent, 'id' | 'timestamp'>
): Promise<string> {
  const ref = await addDoc(collection(db, 'design_ai_learning'), {
    ...event,
    timestamp: serverTimestamp(),
  });
  return ref.id;
}

// Get user's learned patterns
export async function getUserPatterns(userId: string): Promise<UserPatterns | null> {
  const q = query(
    collection(db, 'design_ai_patterns'),
    where('userId', '==', userId),
    orderBy('lastUpdated', 'desc'),
    limit(1)
  );
  
  const snapshot = await getDocs(q);
  if (snapshot.empty) return null;
  
  const doc = snapshot.docs[0];
  return {
    ...doc.data(),
    lastUpdated: doc.data().lastUpdated?.toDate(),
  } as UserPatterns;
}

// Update user patterns
export async function updateUserPatterns(
  userId: string,
  patterns: Partial<UserPatterns['preferences']>
): Promise<void> {
  const existing = await getUserPatterns(userId);
  
  const patternRef = doc(db, 'design_ai_patterns', `${userId}_patterns`);
  await setDoc(patternRef, {
    userId,
    lastUpdated: serverTimestamp(),
    preferences: {
      ...(existing?.preferences || {}),
      ...patterns,
    },
    confidence: existing ? Math.min(existing.confidence + 0.05, 1) : 0.3,
  }, { merge: true });
}

// Analyze interactions and detect patterns
export async function analyzeInteractionsForPatterns(userId: string): Promise<void> {
  // Get recent interactions
  const interactions = await getRecentInteractions(userId, 100);
  if (interactions.length < 10) return; // Need enough data
  
  // Analyze equipment choices
  const equipmentChoices: Record<string, Record<string, number>> = {};
  
  for (const interaction of interactions) {
    for (const tool of interaction.toolsCalled) {
      if (tool.name === 'placeEquipment' && tool.params.libraryId) {
        const roomType = tool.params.roomType || 'unknown';
        if (!equipmentChoices[roomType]) {
          equipmentChoices[roomType] = {};
        }
        const equipId = tool.params.libraryId;
        equipmentChoices[roomType][equipId] = (equipmentChoices[roomType][equipId] || 0) + 1;
      }
    }
  }
  
  // Find patterns (items used 3+ times)
  const patterns: Record<string, Record<string, string>> = {};
  
  for (const [roomType, equipment] of Object.entries(equipmentChoices)) {
    const mostUsed = Object.entries(equipment)
      .filter(([_, count]) => count >= 3)
      .sort((a, b) => b[1] - a[1]);
    
    if (mostUsed.length > 0) {
      patterns[roomType] = {};
      for (const [equipId] of mostUsed.slice(0, 5)) {
        // Determine equipment category
        const category = equipId.split('_')[0];
        patterns[roomType][category] = equipId;
      }
    }
  }
  
  // Update patterns if we found any
  if (Object.keys(patterns).length > 0) {
    await updateUserPatterns(userId, {
      equipmentPreferences: patterns,
    });
    
    // Log learning event
    await logLearningEvent({
      userId,
      type: 'pattern',
      trigger: 'Analyzed last 100 interactions',
      observation: `Found equipment patterns for ${Object.keys(patterns).length} room types`,
      adjustment: 'Will suggest these as defaults',
      confidence: 0.7,
      appliedTo: ['equipment'],
    });
  }
}

// Check if user prefers something different from what AI suggested
export async function detectCorrection(
  userId: string,
  aiSuggestion: { tool: string; params: Record<string, any> },
  userChoice: { tool: string; params: Record<string, any> }
): Promise<void> {
  // If user changed AI's suggestion, learn from it
  if (aiSuggestion.tool === userChoice.tool) {
    const differences: string[] = [];
    
    for (const [key, value] of Object.entries(userChoice.params)) {
      if (JSON.stringify(aiSuggestion.params[key]) !== JSON.stringify(value)) {
        differences.push(key);
      }
    }
    
    if (differences.length > 0) {
      await logLearningEvent({
        userId,
        type: 'correction',
        trigger: `User modified AI suggestion for ${aiSuggestion.tool}`,
        observation: `Changed: ${differences.join(', ')}`,
        adjustment: 'Will use user preference next time',
        confidence: 0.8,
        appliedTo: differences,
      });
    }
  }
}
