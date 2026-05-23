import type { HeartRateDevice } from '../ride/types';

export type ScannedHeartRateDevice = HeartRateDevice;

export type HeartRateMonitorState = {
  heartRateBpm: number | null;
  status: 'idle' | 'connecting' | 'connected' | 'unavailable' | 'error';
  error: string | null;
};

export type BluetoothAccessState =
  | 'granted'
  | 'denied'
  | 'powered-off'
  | 'unavailable';

export async function requestHeartRateBluetoothAccess(): Promise<BluetoothAccessState> {
  return 'unavailable';
}

export async function scanHeartRateDevices(): Promise<
  ScannedHeartRateDevice[]
> {
  return [];
}

export function useHeartRateMonitor(
  _device: HeartRateDevice | null,
  enabled: boolean,
): HeartRateMonitorState {
  return {
    heartRateBpm: null,
    status: enabled ? 'unavailable' : 'idle',
    error: enabled
      ? 'Bluetooth heart rate is available only in native builds.'
      : null,
  };
}
