import type { BluetoothAccessState } from '../devices/heartRateMonitor';

type LocationPermissionStatus = string | null | undefined;

type WelcomePermissionAccess = {
  foregroundStatus: LocationPermissionStatus;
  backgroundStatus: LocationPermissionStatus;
  bluetoothStatus: BluetoothAccessState;
};

export function areWelcomePermissionsGranted(
  permissions: WelcomePermissionAccess,
) {
  return (
    permissions.foregroundStatus === 'granted' &&
    permissions.backgroundStatus === 'granted' &&
    permissions.bluetoothStatus === 'granted'
  );
}
