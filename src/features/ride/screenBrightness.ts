export const RIDE_SCREEN_DIM_BRIGHTNESS = 0.08;

const USER_BRIGHTNESS_CHANGE_TOLERANCE = 0.005;

type BrightnessChangeEvent = {
  brightness: number;
};

type BrightnessSubscription = {
  remove: () => void;
};

export type RideScreenBrightnessModule = {
  getBrightnessAsync: () => Promise<number>;
  setBrightnessAsync: (brightness: number) => Promise<void>;
  restoreSystemBrightnessAsync?: () => Promise<void>;
  addBrightnessListener?: (
    listener: (event: BrightnessChangeEvent) => void,
  ) => BrightnessSubscription;
};

type RideScreenBrightnessControllerOptions = {
  brightness: RideScreenBrightnessModule;
  isAutoDimEnabled: () => boolean;
  onDimmedChange: (isDimmed: boolean) => void;
  platformOS: string;
};

export class RideScreenBrightnessController {
  private readonly brightness: RideScreenBrightnessModule;
  private readonly isAutoDimEnabled: () => boolean;
  private readonly onDimmedChange: (isDimmed: boolean) => void;
  private readonly platformOS: string;
  private brightnessToRestore: number | null = null;
  private brightnessSubscription: BrightnessSubscription | null = null;
  private isDimmed = false;
  private isDimming = false;

  constructor(options: RideScreenBrightnessControllerOptions) {
    this.brightness = options.brightness;
    this.isAutoDimEnabled = options.isAutoDimEnabled;
    this.onDimmedChange = options.onDimmedChange;
    this.platformOS = options.platformOS;
  }

  async dim() {
    if (!this.isAutoDimEnabled() || this.isDimmed || this.isDimming) {
      return;
    }

    this.isDimming = true;
    const brightnessBeforeDim = await this.brightness.getBrightnessAsync();

    if (!this.isAutoDimEnabled()) {
      this.isDimming = false;
      return;
    }

    this.brightnessToRestore = brightnessBeforeDim;
    await this.brightness.setBrightnessAsync(RIDE_SCREEN_DIM_BRIGHTNESS);

    if (!this.isAutoDimEnabled()) {
      await this.restore();
      return;
    }

    this.isDimming = false;
    this.setDimmed(true);
    this.watchUserBrightnessChanges();
  }

  async restore() {
    const shouldRestore = this.isDimmed || this.isDimming;
    const brightnessToRestore = this.brightnessToRestore;

    if (!shouldRestore) {
      return;
    }

    if (
      this.platformOS === 'android' &&
      this.brightness.restoreSystemBrightnessAsync
    ) {
      await this.brightness.restoreSystemBrightnessAsync();
    } else if (brightnessToRestore != null) {
      await this.brightness.setBrightnessAsync(brightnessToRestore);
    }

    this.isDimming = false;
    this.brightnessToRestore = null;
    this.stopWatchingUserBrightnessChanges();
    this.setDimmed(false);
  }

  async dispose() {
    await this.restore();
  }

  private watchUserBrightnessChanges() {
    if (
      this.platformOS !== 'ios' ||
      !this.brightness.addBrightnessListener ||
      this.brightnessSubscription
    ) {
      return;
    }

    this.brightnessSubscription = this.brightness.addBrightnessListener(
      ({ brightness }) => {
        if (!this.isDimmed) {
          return;
        }

        if (
          Math.abs(brightness - RIDE_SCREEN_DIM_BRIGHTNESS) <=
          USER_BRIGHTNESS_CHANGE_TOLERANCE
        ) {
          return;
        }

        this.brightnessToRestore = brightness;
      },
    );
  }

  private stopWatchingUserBrightnessChanges() {
    this.brightnessSubscription?.remove();
    this.brightnessSubscription = null;
  }

  private setDimmed(isDimmed: boolean) {
    if (this.isDimmed === isDimmed) {
      return;
    }

    this.isDimmed = isDimmed;
    this.onDimmedChange(isDimmed);
  }
}
