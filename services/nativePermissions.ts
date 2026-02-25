import { Capacitor } from '@capacitor/core';

/**
 * Request microphone permission.
 * On iOS via Capacitor, getUserMedia() triggers the native permission dialog
 * automatically because NSMicrophoneUsageDescription is set in Info.plist.
 * This helper provides a unified way to check/request permission across platforms.
 */
export async function requestMicrophonePermission(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Permission granted - stop the test stream immediately
    stream.getTracks().forEach(track => track.stop());
    return true;
  } catch (err: any) {
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      return false;
    }
    // Other errors (NotFoundError, etc.) - not a permission issue
    throw err;
  }
}

/**
 * Check if running inside a native Capacitor app (iOS/Android).
 */
export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}
