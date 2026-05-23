require('dotenv/config');

const googleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

module.exports = {
  expo: {
    name: 'Pelot',
    slug: 'pelot',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'automatic',
    scheme: 'pelot',
    ios: {
      bundleIdentifier: 'com.josh.pelot',
      supportsTablet: true,
      config: googleMapsApiKey
        ? {
            googleMapsApiKey,
          }
        : undefined,
      infoPlist: {
        NSLocationWhenInUseUsageDescription:
          'Pelot uses your location to record bike rides, calculate speed and distance, and draw your route.',
        NSLocationAlwaysAndWhenInUseUsageDescription:
          'Pelot can use background location to keep recording your ride when the app is not open.',
        NSMotionUsageDescription:
          'Pelot may use device motion and pressure sensors to improve ride metrics such as ascent when available.',
        UIBackgroundModes: ['location'],
      },
    },
    android: {
      package: 'com.josh.pelot',
      config: googleMapsApiKey
        ? {
            googleMaps: {
              apiKey: googleMapsApiKey,
            },
          }
        : undefined,
      permissions: [
        'ACCESS_COARSE_LOCATION',
        'ACCESS_FINE_LOCATION',
        'ACCESS_BACKGROUND_LOCATION',
        'FOREGROUND_SERVICE',
        'FOREGROUND_SERVICE_LOCATION',
      ],
      adaptiveIcon: {
        backgroundColor: '#E6F4FE',
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
    },
    extra: {
      hasGoogleMapsApiKey: Boolean(googleMapsApiKey),
    },
    web: {
      favicon: './assets/favicon.png',
    },
    plugins: [
      'expo-router',
      'expo-sqlite',
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
