require('dotenv/config');

module.exports = {
  expo: {
    name: 'Pelot',
    slug: 'pelot',
    version: '0.0.2',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'automatic',
    scheme: 'pelot',
    ios: {
      bundleIdentifier: 'com.sevro.pelot',
      supportsTablet: true,
      infoPlist: {
        NSLocationWhenInUseUsageDescription:
          'Pelot uses your location to record bike rides, calculate speed and distance, and draw your route.',
        NSLocationAlwaysAndWhenInUseUsageDescription:
          'Pelot can use background location to keep recording your ride when the app is not open.',
        NSMotionUsageDescription:
          'Pelot may use device motion and pressure sensors to improve ride metrics such as ascent when available.',
        NSBluetoothAlwaysUsageDescription:
          'Pelot uses Bluetooth to connect to heart rate devices such as Garmin watches broadcasting heart rate.',
        UIBackgroundModes: ['location'],
      },
    },
    android: {
      package: 'com.sevro.pelot',
      versionCode: 2,
      icon: './assets/icon.png',
      permissions: [
        'ACCESS_COARSE_LOCATION',
        'ACCESS_FINE_LOCATION',
        'ACCESS_BACKGROUND_LOCATION',
        'FOREGROUND_SERVICE',
        'FOREGROUND_SERVICE_LOCATION',
        'BLUETOOTH',
        'BLUETOOTH_ADMIN',
        'BLUETOOTH_SCAN',
        'BLUETOOTH_CONNECT',
        'RECEIVE_BOOT_COMPLETED',
      ],
      adaptiveIcon: {
        backgroundColor: '#ffffff',
        foregroundImage: './assets/icon.png',
      },
      predictiveBackGestureEnabled: false,
    },
    web: {
      favicon: './assets/icon.png',
    },
    extra: {
      eas: {
        projectId: '10e04dbe-8722-4761-9f1d-fd590abf7b5a',
      },
    },
    plugins: [
      'expo-router',
      'expo-sqlite',
      [
        'expo-splash-screen',
        {
          backgroundColor: '#ffffff',
          image: './assets/icon.png',
          imageWidth: 200,
        },
      ],
      '@maplibre/maplibre-react-native',
      [
        'expo-location',
        {
          locationAlwaysAndWhenInUsePermission:
            'Pelot uses background location to keep recording bike rides when the app is not open.',
          locationWhenInUsePermission:
            'Pelot uses your location to record bike rides, calculate speed and distance, and draw your route.',
          isIosBackgroundLocationEnabled: true,
          isAndroidBackgroundLocationEnabled: true,
        },
      ],
    ],
  },
};
