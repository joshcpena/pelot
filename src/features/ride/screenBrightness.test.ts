import { describe, expect, it } from 'vitest';

import {
  RIDE_SCREEN_DIM_BRIGHTNESS,
  RideScreenBrightnessController,
  type RideScreenBrightnessModule,
} from './screenBrightness';

function createBrightnessModule(
  initialBrightness = 0.72,
  options: {
    onRestoreSystemBrightness?: () => Promise<void> | void;
    onSetBrightness?: (value: number) => void;
  } = {},
) {
  let currentBrightness = initialBrightness;
  const setBrightnessCalls: number[] = [];
  let restoreSystemBrightnessCalls = 0;
  let brightnessListener: ((event: { brightness: number }) => void) | null =
    null;

  const brightness: RideScreenBrightnessModule = {
    async getBrightnessAsync() {
      return currentBrightness;
    },
    async setBrightnessAsync(value) {
      currentBrightness = value;
      setBrightnessCalls.push(value);
      options.onSetBrightness?.(value);
      brightnessListener?.({ brightness: value });
    },
    async restoreSystemBrightnessAsync() {
      restoreSystemBrightnessCalls += 1;
      await options.onRestoreSystemBrightness?.();
    },
    addBrightnessListener(listener) {
      brightnessListener = listener;

      return {
        remove() {
          if (brightnessListener === listener) {
            brightnessListener = null;
          }
        },
      };
    },
  };

  return {
    brightness,
    emitBrightnessChange(value: number) {
      currentBrightness = value;
      brightnessListener?.({ brightness: value });
    },
    get setBrightnessCalls() {
      return setBrightnessCalls;
    },
    get restoreSystemBrightnessCalls() {
      return restoreSystemBrightnessCalls;
    },
  };
}

describe('RideScreenBrightnessController', () => {
  it('does not touch brightness while auto-dim is disabled', async () => {
    const module = createBrightnessModule();
    const dimmedStates: boolean[] = [];
    const controller = new RideScreenBrightnessController({
      brightness: module.brightness,
      isAutoDimEnabled: () => false,
      onDimmedChange: (isDimmed) => dimmedStates.push(isDimmed),
      platformOS: 'android',
    });

    await controller.dim();
    await controller.restore();

    expect(module.setBrightnessCalls).toEqual([]);
    expect(module.restoreSystemBrightnessCalls).toBe(0);
    expect(dimmedStates).toEqual([]);
  });

  it('releases the Android activity override instead of restoring a cached brightness', async () => {
    const module = createBrightnessModule(0.64);
    const controller = new RideScreenBrightnessController({
      brightness: module.brightness,
      isAutoDimEnabled: () => true,
      onDimmedChange: () => undefined,
      platformOS: 'android',
    });

    await controller.dim();
    await controller.restore();

    expect(module.setBrightnessCalls).toEqual([RIDE_SCREEN_DIM_BRIGHTNESS]);
    expect(module.restoreSystemBrightnessCalls).toBe(1);
  });

  it('keeps the screen dimmed until Android releases the activity override', async () => {
    let releaseOverride: () => void = () => undefined;
    const module = createBrightnessModule(0.64, {
      onRestoreSystemBrightness: () =>
        new Promise<void>((resolve) => {
          releaseOverride = resolve;
        }),
    });
    const dimmedStates: boolean[] = [];
    const controller = new RideScreenBrightnessController({
      brightness: module.brightness,
      isAutoDimEnabled: () => true,
      onDimmedChange: (isDimmed) => dimmedStates.push(isDimmed),
      platformOS: 'android',
    });

    await controller.dim();
    const restorePromise = controller.restore();
    await Promise.resolve();

    expect(module.restoreSystemBrightnessCalls).toBe(1);
    expect(dimmedStates).toEqual([true]);

    releaseOverride();
    await restorePromise;

    expect(dimmedStates).toEqual([true, false]);
  });

  it('restores when auto-dim is disabled immediately after dimming', async () => {
    let isAutoDimEnabled = true;
    const module = createBrightnessModule(0.64, {
      onSetBrightness: () => {
        isAutoDimEnabled = false;
      },
    });
    const dimmedStates: boolean[] = [];
    const controller = new RideScreenBrightnessController({
      brightness: module.brightness,
      isAutoDimEnabled: () => isAutoDimEnabled,
      onDimmedChange: (isDimmed) => dimmedStates.push(isDimmed),
      platformOS: 'android',
    });

    await controller.dim();

    expect(module.setBrightnessCalls).toEqual([RIDE_SCREEN_DIM_BRIGHTNESS]);
    expect(module.restoreSystemBrightnessCalls).toBe(1);
    expect(dimmedStates).toEqual([]);
  });

  it('restores the latest user-set iOS brightness after dimming', async () => {
    const module = createBrightnessModule(0.66);
    const controller = new RideScreenBrightnessController({
      brightness: module.brightness,
      isAutoDimEnabled: () => true,
      onDimmedChange: () => undefined,
      platformOS: 'ios',
    });

    await controller.dim();
    module.emitBrightnessChange(0.48);
    await controller.restore();

    expect(module.setBrightnessCalls).toEqual([
      RIDE_SCREEN_DIM_BRIGHTNESS,
      0.48,
    ]);
    expect(module.restoreSystemBrightnessCalls).toBe(0);
  });
});
