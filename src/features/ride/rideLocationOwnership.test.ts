import { describe, expect, it } from 'vitest';

import { shouldPersistBackgroundRidePoint } from './rideLocationOwnership';

describe('shouldPersistBackgroundRidePoint', () => {
  it('ignores background task points while the app is active', () => {
    expect(shouldPersistBackgroundRidePoint('active')).toBe(false);
  });

  it('persists background task points once the app is no longer active', () => {
    expect(shouldPersistBackgroundRidePoint('background')).toBe(true);
    expect(shouldPersistBackgroundRidePoint('inactive')).toBe(true);
  });

  it('fails open when app state is unavailable', () => {
    expect(shouldPersistBackgroundRidePoint(null)).toBe(true);
    expect(shouldPersistBackgroundRidePoint(undefined)).toBe(true);
  });
});
