import { useEffect, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import {
  BleManager,
  ScanMode,
  State,
  type CharacteristicSubscriptionType,
  type Device,
  type Subscription,
} from 'react-native-ble-plx';

import type { HeartRateDevice } from '../ride/types';
import type {
  BluetoothAccessState,
  HeartRateMonitorState,
  ScannedHeartRateDevice,
} from './heartRateMonitor';

const HEART_RATE_SERVICE_UUID = '0000180d-0000-1000-8000-00805f9b34fb';
const HEART_RATE_MEASUREMENT_UUID = '00002a37-0000-1000-8000-00805f9b34fb';
const HEART_RATE_SERVICE_SHORT_UUID = '180d';
const HEART_RATE_MEASUREMENT_SHORT_UUID = '2a37';
const SCAN_TIMEOUT_MS = 10000;
const HEART_RATE_MONITOR_TRANSACTION_ID = 'pelot-heart-rate-monitor';

let manager: BleManager | null = null;

function getManager() {
  manager ??= new BleManager();

  return manager;
}

async function requestBluetoothPermissions() {
  if (Platform.OS !== 'android') {
    return true;
  }

  if (Platform.Version >= 31) {
    const result = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    ]);

    return Object.values(result).every(
      (value) => value === PermissionsAndroid.RESULTS.GRANTED,
    );
  }

  const result = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
  );

  return result === PermissionsAndroid.RESULTS.GRANTED;
}

export async function requestHeartRateBluetoothAccess(): Promise<BluetoothAccessState> {
  const hasPermission = await requestBluetoothPermissions();

  if (!hasPermission) {
    return 'denied';
  }

  const bleManager = getManager();
  const state = await bleManager.state();

  if (state === State.PoweredOn) {
    return 'granted';
  }

  if (state === State.PoweredOff && Platform.OS === 'android') {
    try {
      await bleManager.enable();
      return 'granted';
    } catch {
      return 'powered-off';
    }
  }

  if (state === State.PoweredOff) {
    return 'powered-off';
  }

  return 'unavailable';
}

function decodeBase64(value: string) {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;

  for (const character of value) {
    const index = alphabet.indexOf(character);

    if (index < 0 || index === 64) {
      continue;
    }

    buffer = (buffer << 6) | index;
    bits += 6;

    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }

  return bytes;
}

function parseHeartRateMeasurement(value: string | null) {
  if (!value) {
    return null;
  }

  const bytes = decodeBase64(value);
  const flags = bytes[0] ?? 0;
  const isUInt16 = (flags & 0x01) === 0x01;

  if (isUInt16) {
    return bytes.length >= 3 ? bytes[1] + (bytes[2] << 8) : null;
  }

  return bytes[1] ?? null;
}

function uuidMatches(uuid: string, fullUuid: string, shortUuid: string) {
  const normalized = uuid.toLowerCase();

  return normalized === fullUuid || normalized === shortUuid;
}

function getDeviceName(device: Device) {
  return device.name ?? device.localName ?? null;
}

function isLikelyHeartRateDevice(device: Device) {
  const serviceUUIDs = device.serviceUUIDs ?? [];
  const hasHeartRateService = serviceUUIDs.some((uuid) =>
    uuidMatches(uuid, HEART_RATE_SERVICE_UUID, HEART_RATE_SERVICE_SHORT_UUID),
  );

  if (hasHeartRateService) {
    return true;
  }

  const name = getDeviceName(device)?.toLowerCase() ?? '';

  return /garmin|heart|\bhr\b|forerunner|fenix|epix|venu|vivoactive|instinct/.test(
    name,
  );
}

function toHeartRateDevice(device: Device): ScannedHeartRateDevice {
  return {
    id: device.id,
    name: getDeviceName(device) ?? 'Heart rate device',
  };
}

export async function scanHeartRateDevices(): Promise<
  ScannedHeartRateDevice[]
> {
  const accessState = await requestHeartRateBluetoothAccess();

  if (accessState === 'denied') {
    throw new Error(
      'Bluetooth permission is required to scan for heart rate devices.',
    );
  }

  if (accessState === 'powered-off') {
    throw new Error('Turn on Bluetooth to scan for heart rate devices.');
  }

  if (accessState !== 'granted') {
    throw new Error('Bluetooth is not available right now.');
  }

  const bleManager = getManager();
  const devices = new Map<string, ScannedHeartRateDevice>();
  bleManager.stopDeviceScan();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      bleManager.stopDeviceScan();
      resolve([...devices.values()]);
    }, SCAN_TIMEOUT_MS);

    bleManager
      .startDeviceScan(
        null,
        { scanMode: ScanMode.LowLatency, legacyScan: false },
        (error, device) => {
          if (error) {
            clearTimeout(timeout);
            bleManager.stopDeviceScan();
            reject(error);
            return;
          }

          if (device && isLikelyHeartRateDevice(device)) {
            devices.set(device.id, toHeartRateDevice(device));
          }
        },
      )
      .catch((error: unknown) => {
        clearTimeout(timeout);
        bleManager.stopDeviceScan();
        reject(error);
      });
  });
}

export function useHeartRateMonitor(
  device: HeartRateDevice | null,
  enabled: boolean,
): HeartRateMonitorState {
  const [state, setState] = useState<HeartRateMonitorState>({
    heartRateBpm: null,
    status: 'idle',
    error: null,
  });

  useEffect(() => {
    let isMounted = true;
    let monitorSubscription: Subscription | null = null;
    let disconnectDevice: Device | null = null;

    async function connect() {
      if (!enabled || !device) {
        setState({ heartRateBpm: null, status: 'idle', error: null });
        return;
      }

      const accessState = await requestHeartRateBluetoothAccess();

      if (accessState !== 'granted') {
        setState({
          heartRateBpm: null,
          status: 'error',
          error:
            accessState === 'powered-off'
              ? 'Turn on Bluetooth for heart rate.'
              : 'Bluetooth permission is required for heart rate.',
        });
        return;
      }

      try {
        setState({ heartRateBpm: null, status: 'connecting', error: null });

        const bleManager = getManager();
        bleManager.stopDeviceScan();
        const deviceId = device.id;
        const isAlreadyConnected = await bleManager.isDeviceConnected(deviceId);
        const connectedDevice = isAlreadyConnected
          ? await bleManager.devices([deviceId]).then((devices) => devices[0])
          : await bleManager.connectToDevice(deviceId, { autoConnect: false });

        if (!connectedDevice) {
          throw new Error('Heart rate device is not available.');
        }

        disconnectDevice = connectedDevice;
        const discoveredDevice =
          await connectedDevice.discoverAllServicesAndCharacteristics();
        const services = await discoveredDevice.services();
        const heartRateService = services.find((service) =>
          uuidMatches(
            service.uuid,
            HEART_RATE_SERVICE_UUID,
            HEART_RATE_SERVICE_SHORT_UUID,
          ),
        );

        if (!heartRateService) {
          throw new Error('No heart rate service. Enable broadcast HR.');
        }

        const characteristics =
          await discoveredDevice.characteristicsForService(
            heartRateService.uuid,
          );
        const measurementCharacteristic = characteristics.find(
          (characteristic) =>
            uuidMatches(
              characteristic.uuid,
              HEART_RATE_MEASUREMENT_UUID,
              HEART_RATE_MEASUREMENT_SHORT_UUID,
            ),
        );

        if (!measurementCharacteristic) {
          throw new Error('No heart rate measurement characteristic.');
        }

        if (
          !measurementCharacteristic.isNotifiable &&
          !measurementCharacteristic.isIndicatable
        ) {
          throw new Error('Heart rate measurement is not notifiable.');
        }

        const subscriptionType: CharacteristicSubscriptionType =
          measurementCharacteristic.isNotifiable ? 'notification' : 'indication';

        if (!isMounted) {
          return;
        }

        setState({ heartRateBpm: null, status: 'connected', error: null });
        monitorSubscription = bleManager.monitorCharacteristicForDevice(
          discoveredDevice.id,
          heartRateService.uuid,
          measurementCharacteristic.uuid,
          (error, characteristic) => {
            if (!isMounted) {
              return;
            }

            if (error) {
              setState({
                heartRateBpm: null,
                status: 'error',
                error: error.message,
              });
              return;
            }

            const heartRateBpm = parseHeartRateMeasurement(
              characteristic?.value ?? null,
            );

            setState({ heartRateBpm, status: 'connected', error: null });
          },
          HEART_RATE_MONITOR_TRANSACTION_ID,
          subscriptionType,
        );
      } catch (error) {
        if (isMounted) {
          setState({
            heartRateBpm: null,
            status: 'error',
            error:
              error instanceof Error
                ? error.message
                : 'Could not connect heart rate device.',
          });
        }
      }
    }

    connect();

    return () => {
      isMounted = false;
      getManager().cancelTransaction(HEART_RATE_MONITOR_TRANSACTION_ID);
      monitorSubscription?.remove();
      disconnectDevice?.cancelConnection().catch(() => {});
    };
  }, [device, enabled]);

  return state;
}
