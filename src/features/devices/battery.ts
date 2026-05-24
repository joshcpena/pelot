import { useEffect, useState } from 'react';
import * as Battery from 'expo-battery';

function normalizeBatteryLevel(level: number) {
  return level >= 0 ? level : null;
}

export function useDeviceBatteryLevel(enabled = true) {
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let isMounted = true;

    Battery.getBatteryLevelAsync()
      .then((level) => {
        if (isMounted) {
          setBatteryLevel(normalizeBatteryLevel(level));
        }
      })
      .catch(() => {
        if (isMounted) {
          setBatteryLevel(null);
        }
      });

    const subscription = Battery.addBatteryLevelListener(({ batteryLevel }) => {
      setBatteryLevel(normalizeBatteryLevel(batteryLevel));
    });

    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, [enabled]);

  return enabled ? batteryLevel : null;
}
