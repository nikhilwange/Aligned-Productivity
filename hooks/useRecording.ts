import { useSyncExternalStore } from 'react';
import { recordingController, type RecorderSnapshot } from '../services/recordingController';

/** Live view of the app-level recording controller. Safe to use in any screen. */
export function useRecording(): RecorderSnapshot {
  return useSyncExternalStore(recordingController.subscribe, recordingController.getSnapshot);
}
