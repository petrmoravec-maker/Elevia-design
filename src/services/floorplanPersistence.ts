/**
 * Firestore persistence service for floorplan scene data.
 *
 * Schema extension to design_projects/{projectId}:
 *   scene: {
 *     entities: Record<string, FloorplanEntity>
 *     sceneRevision: number   // monotonic counter for optimistic concurrency
 *     updatedAt: Timestamp
 *   }
 *
 * Size budget: ~900KB soft limit per project (leaving 100KB headroom under 1MB Firestore limit).
 */

import {
  doc,
  getDoc,
  updateDoc,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useFloorplanStore } from '../stores/useFloorplanStore';
import type { SceneLayer } from '../stores/useFloorplanStore';
import { encodeEntities, decodeEntities } from './sceneCodec';

const DEBOUNCE_MS = 500;
const MAX_SCENE_BYTES = 900 * 1024; // 900 KB soft limit

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let isSaving = false;
let saveQueue = false; // True if another save was requested while one is in progress

let currentProjectId: string | null = null;
let currentRevision = 0;

/**
 * Initialize the persistence service for a project.
 * Loads the scene from Firestore and starts watching the store for changes.
 */
export async function initPersistence(projectId: string): Promise<void> {
  currentProjectId = projectId;
  await loadScene(projectId);
  startWatching();
}

/**
 * Load scene from Firestore into the Zustand store.
 */
export async function loadScene(projectId: string): Promise<void> {
  useFloorplanStore.getState().setSaveStatus('idle');

  try {
    const docRef = doc(db, 'design_projects', projectId);
    const snap = await getDoc(docRef);

    if (!snap.exists()) return;

    const data = snap.data();
    const scene = data.scene;
    const declared = Array.isArray(data.sceneLayers) ? (data.sceneLayers as Partial<SceneLayer>[]) : [];

    if (scene?.entities && typeof scene.entities === 'object') {
      useFloorplanStore.getState().loadScene(decodeEntities(scene.entities), declared);
      currentRevision = scene.sceneRevision ?? 0;
    } else {
      useFloorplanStore.getState().loadScene({}, declared);
    }
  } catch (error) {
    console.error('[floorplanPersistence] Error loading scene:', error);
    useFloorplanStore.getState().setSaveStatus('error');
  }
}

/**
 * Subscribe to store changes and debounce saves.
 */
let unsubscribe: (() => void) | null = null;

function startWatching(): void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }

  // Subscribe to the entire store; check isDirty on each update
  unsubscribe = useFloorplanStore.subscribe(
    (state) => {
      if (state.isDirty) {
        scheduleSave();
      }
    },
  );

  // Handle tab close / navigation away -- flush pending save immediately
  window.addEventListener('beforeunload', flushSave, { once: false });
}

export function stopPersistence(): void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  window.removeEventListener('beforeunload', flushSave);
  currentProjectId = null;
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(doSave, DEBOUNCE_MS);
}

async function flushSave(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  await doSave();
}

async function doSave(): Promise<void> {
  if (!currentProjectId) return;
  if (isSaving) {
    saveQueue = true;
    return;
  }

  const state = useFloorplanStore.getState();
  if (!state.isDirty) return;
  if (state.readOnly) {
    // Viewer without edit rights: never write. Drop the dirty flag so we do not retry.
    state.markSaved();
    return;
  }

  isSaving = true;
  state.setSaveStatus('saving');

  try {
    const entities = encodeEntities(state.entities);

    // Size guard
    const serialized = JSON.stringify(entities);
    if (serialized.length > MAX_SCENE_BYTES) {
      console.warn(
        `[floorplanPersistence] Scene size ${(serialized.length / 1024).toFixed(0)}KB exceeds soft limit of 900KB. ` +
        'Consider splitting into a subcollection model for large facilities.'
      );
    }

    const nextRevision = currentRevision + 1;

    // Reverse index "<collection>__<docId>" -> equipment id so the Lab can deep-link a device
    // to the plan without parsing the scene (mirrors scripts/seed_design_project.cjs).
    const bindings: Record<string, string> = {};
    for (const e of Object.values(state.entities)) {
      if (e.type === 'equipment' && e.binding?.collection && e.binding.docId) bindings[`${e.binding.collection}__${e.binding.docId}`] = e.id;
    }

    await updateDoc(doc(db, 'design_projects', currentProjectId), {
      'scene.entities': entities,
      'scene.sceneRevision': nextRevision,
      'scene.updatedAt': serverTimestamp(),
      updatedAt: serverTimestamp(),
      roomCount: Object.values(state.entities).filter(e => e.type === 'room').length,
      bindings,
    });
    // small index for the Lab (DeviceDetail "Show on plan") - keep in sync with the main doc
    await setDoc(doc(db, 'design_projects', currentProjectId, 'meta', 'bindings'), { bindings, updatedAt: serverTimestamp() }, { merge: true });

    currentRevision = nextRevision;
    useFloorplanStore.getState().markSaved();
  } catch (error: any) {
    console.error('[floorplanPersistence] Save error:', error);

    // Handle optimistic concurrency failure
    if (error?.code === 'permission-denied') {
      useFloorplanStore.getState().setSaveStatus('error');
    } else if (
      error?.code === 'unavailable' ||
      error?.message?.includes('offline') ||
      !navigator.onLine
    ) {
      useFloorplanStore.getState().setSaveStatus('offline');
      // Firestore offline persistence will queue the write automatically
    } else {
      useFloorplanStore.getState().setSaveStatus('error');
    }
  } finally {
    isSaving = false;

    // If another save was requested while we were saving, process it now
    if (saveQueue) {
      saveQueue = false;
      scheduleSave();
    }
  }
}
