import { Link } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  type ThemeColors,
  useThemeColors,
} from '../src/features/settings/settings';

const menuItems = [
  {
    href: '/settings',
    title: 'Settings',
    eyebrow: 'Ride setup',
    description: 'Units, recording behavior, profile, splits, and map display.',
  },
  {
    href: '/permissions',
    title: 'Permissions',
    eyebrow: 'Access',
    description: 'Location and Bluetooth permissions for reliable recording.',
  },
  {
    href: '/history',
    title: 'History',
    eyebrow: 'Archive',
    description: 'Saved rides, route previews, summaries, and splits.',
  },
] as const;

export default function MenuScreen() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const styles = createStyles(colors, insets.top);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.menuLabel}>Menu</Text>
        <Link dismissTo href="/" asChild>
          <Pressable
            style={({ pressed }) => [
              styles.closeLink,
              pressed && styles.closeLinkPressed,
            ]}
          >
            <Text style={styles.closeLinkText}>Close</Text>
          </Pressable>
        </Link>
      </View>

      <View style={styles.menuList}>
        {menuItems.map((item) => (
          <Link key={item.href} href={item.href} asChild>
            <Pressable
              style={({ pressed }) => [
                styles.menuItem,
                pressed ? styles.menuItemPressed : null,
              ]}
            >
              <View style={styles.menuCopy}>
                <Text style={styles.menuEyebrow}>{item.eyebrow}</Text>
                <Text style={styles.menuTitle}>{item.title}</Text>
                <Text style={styles.menuDescription}>{item.description}</Text>
              </View>
            </Pressable>
          </Link>
        ))}
      </View>
    </ScrollView>
  );
}

function createStyles(colors: ThemeColors, topInset: number) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      gap: 20,
      paddingHorizontal: 20,
      paddingTop: Math.max(topInset + 28, 52),
      paddingBottom: 32,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 12,
    },
    menuLabel: {
      flex: 1,
      color: colors.primaryText,
      fontSize: 18,
      fontWeight: '900',
      letterSpacing: -0.2,
    },
    closeLink: {
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    closeLinkPressed: {
      backgroundColor: colors.accentSoft,
      opacity: 0.82,
      transform: [{ scale: 0.96 }],
    },
    closeLinkText: {
      color: colors.accent,
      fontSize: 16,
      fontWeight: '800',
    },
    menuList: {
      gap: 12,
    },
    menuItem: {
      borderWidth: 2,
      borderColor: colors.border,
      borderRadius: 24,
      backgroundColor: colors.card,
      padding: 18,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.08,
      shadowRadius: 18,
    },
    menuItemPressed: {
      opacity: 0.72,
      transform: [{ scale: 0.99 }],
    },
    menuCopy: {
      justifyContent: 'center',
    },
    menuEyebrow: {
      color: colors.success,
      fontSize: 11,
      fontWeight: '900',
      letterSpacing: 1.1,
      textTransform: 'uppercase',
    },
    menuTitle: {
      color: colors.primaryText,
      fontSize: 20,
      fontWeight: '900',
      letterSpacing: -0.2,
      lineHeight: 24,
    },
    menuDescription: {
      marginTop: 5,
      color: colors.mutedText,
      fontSize: 14,
      lineHeight: 19,
    },
  });
}
