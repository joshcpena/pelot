import { describe, expect, it } from 'vitest';

import { areWelcomePermissionsGranted } from './welcomePermissions';

describe('areWelcomePermissionsGranted', () => {
  it('returns true when foreground location, background location, and Bluetooth are granted', () => {
    expect(
      areWelcomePermissionsGranted({
        foregroundStatus: 'granted',
        backgroundStatus: 'granted',
        bluetoothStatus: 'granted',
      }),
    ).toBe(true);
  });

  it.each([
    {
      foregroundStatus: 'denied',
      backgroundStatus: 'granted',
      bluetoothStatus: 'granted',
    },
    {
      foregroundStatus: 'granted',
      backgroundStatus: 'denied',
      bluetoothStatus: 'granted',
    },
    {
      foregroundStatus: 'granted',
      backgroundStatus: 'granted',
      bluetoothStatus: 'denied',
    },
    {
      foregroundStatus: 'granted',
      backgroundStatus: undefined,
      bluetoothStatus: 'granted',
    },
  ] as const)(
    'returns false when any required access is missing: %o',
    (permissions) => {
      expect(areWelcomePermissionsGranted(permissions)).toBe(false);
    },
  );
});
