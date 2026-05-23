import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  type ThemeColors,
  useThemeColors,
} from '../src/features/settings/settings';

const menuItems = [
  {
    href: '/settings',
    title: 'Settings',
    description: 'Units, auto-pause, keep-awake, splits, and map display.',
  },
  {
    href: '/permissions',
    title: 'Permissions',
    description: 'Location access for foreground and background recording.',
  },
  {
    href: '/history',
    title: 'History',
    description: 'Saved rides, summaries, and splits.',
  },
] as const;

export default function MenuScreen() {
  const colors = useThemeColors();
  const styles = createStyles(colors);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.kicker}>Pelot</Text>
          <Text style={styles.title}>Menu</Text>
        </View>
        <Link href="/" style={styles.closeLink}>
          Close
        </Link>
      </View>

      <View style={styles.menuList}>
        {menuItems.map((item) => (
          <Link key={item.href} href={item.href} asChild>
            <Pressable style={styles.menuItem}>
              <View style={styles.menuCopy}>
                <Text style={styles.menuTitle}>{item.title}</Text>
                <Text style={styles.menuDescription}>{item.description}</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          </Link>
        ))}
      </View>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      gap: 24,
      backgroundColor: colors.background,
      padding: 24,
      paddingTop: 72,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 16,
    },
    kicker: {
      color: colors.success,
      fontSize: 14,
      fontWeight: '800',
      letterSpacing: 1.2,
      textTransform: 'uppercase',
    },
    title: {
      color: colors.primaryText,
      fontSize: 34,
      fontWeight: '900',
    },
    closeLink: {
      color: colors.accent,
      fontSize: 17,
      fontWeight: '800',
    },
    menuList: {
      gap: 12,
    },
    menuItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 16,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 22,
      backgroundColor: colors.card,
      padding: 18,
    },
    menuCopy: {
      flex: 1,
    },
    menuTitle: {
      color: colors.primaryText,
      fontSize: 21,
      fontWeight: '900',
    },
    menuDescription: {
      marginTop: 5,
      color: colors.mutedText,
      fontSize: 15,
      lineHeight: 21,
    },
    chevron: {
      color: colors.accent,
      fontSize: 36,
      fontWeight: '300',
    },
  });
}
