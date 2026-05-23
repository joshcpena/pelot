import type { RideSettings } from './types';

export async function startBackgroundRideRecording(_settings: RideSettings) {
  return false;
}

export async function stopBackgroundRideRecording() {}

export async function isBackgroundRideRecordingAvailable() {
  return false;
}
