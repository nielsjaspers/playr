import type { ComponentProps, PropsWithChildren } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import {
  GlassContainer,
  GlassView,
  isGlassEffectAPIAvailable,
} from 'expo-glass-effect';
import { SymbolView } from 'expo-symbols';

type SymbolName = ComponentProps<typeof SymbolView>['name'];

export type Palette = {
  background: string;
  surface: string;
  raisedSurface: string;
  label: string;
  secondaryLabel: string;
  tertiaryLabel: string;
  separator: string;
  accent: string;
  destructive: string;
  fill: string;
};

export function createPalette(isDark: boolean): Palette {
  return isDark
    ? {
        background: '#000000',
        surface: '#1C1C1E',
        raisedSurface: '#2C2C2E',
        label: '#FFFFFF',
        secondaryLabel: '#AEAEB2',
        tertiaryLabel: '#636366',
        separator: 'rgba(84, 84, 88, 0.65)',
        accent: '#0A84FF',
        destructive: '#FF453A',
        fill: 'rgba(118, 118, 128, 0.24)',
      }
    : {
        background: '#FFFFFF',
        surface: '#FFFFFF',
        raisedSurface: '#FFFFFF',
        label: '#000000',
        secondaryLabel: '#6C6C70',
        tertiaryLabel: '#AEAEB2',
        separator: 'rgba(60, 60, 67, 0.20)',
        accent: '#007AFF',
        destructive: '#FF3B30',
        fill: 'rgba(120, 120, 128, 0.16)',
      };
}

export function Icon({
  name,
  color,
  size = 20,
  weight = 'semibold',
}: {
  name: SymbolName;
  color: string;
  size?: number;
  weight?: ComponentProps<typeof SymbolView>['weight'];
}) {
  return <SymbolView name={name} size={size} tintColor={color} weight={weight} />;
}

export function GlassGroup({
  children,
  style,
  spacing = 10,
}: PropsWithChildren<{ style?: StyleProp<ViewStyle>; spacing?: number }>) {
  if (isGlassEffectAPIAvailable()) {
    return (
      <GlassContainer spacing={spacing} style={style}>
        {children}
      </GlassContainer>
    );
  }
  return <View style={style}>{children}</View>;
}

export function GlassPanel({
  children,
  style,
  palette,
  interactive = false,
}: PropsWithChildren<{
  style?: StyleProp<ViewStyle>;
  palette: Palette;
  interactive?: boolean;
}>) {
  if (isGlassEffectAPIAvailable()) {
    return (
      <GlassView
        glassEffectStyle="regular"
        isInteractive={interactive}
        style={[styles.panel, style]}
      >
        {children}
      </GlassView>
    );
  }
  return (
    <View
      style={[
        styles.panel,
        styles.fallbackBorder,
        { backgroundColor: palette.raisedSurface, borderColor: palette.separator },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function GlassIconButton({
  name,
  label,
  onPress,
  palette,
  disabled = false,
  destructive = false,
  size = 44,
}: {
  name: SymbolName;
  label: string;
  onPress: () => void;
  palette: Palette;
  disabled?: boolean;
  destructive?: boolean;
  size?: number;
}) {
  const color = disabled
    ? palette.tertiaryLabel
    : destructive
      ? palette.destructive
      : palette.label;
  const content = (
    <View style={[styles.buttonContent, { width: size, height: size }]}>
      <Icon name={name} color={color} size={size >= 50 ? 24 : 19} />
    </View>
  );

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.65 : disabled ? 0.55 : 1 })}
    >
      {isGlassEffectAPIAvailable() ? (
        <GlassView
          glassEffectStyle="regular"
          isInteractive={!disabled}
          style={[styles.roundButton, { width: size, height: size }]}
        >
          {content}
        </GlassView>
      ) : (
        <View
          style={[
            styles.roundButton,
            styles.fallbackBorder,
            {
              width: size,
              height: size,
              backgroundColor: palette.raisedSurface,
              borderColor: palette.separator,
            },
          ]}
        >
          {content}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  panel: {
    overflow: 'hidden',
  },
  fallbackBorder: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  roundButton: {
    alignItems: 'center',
    borderRadius: 999,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  buttonContent: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
