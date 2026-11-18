import React from 'react';
import { Image, Pressable, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Icon, Text, haptic } from '../ui';
import { radius, space, useTheme } from '../theme';

export const NAV_ITEMS = [
  { key: 'attendance', label: 'Asistencia', icon: 'checkbox' },
  { key: 'groups', label: 'Grupos', icon: 'people' },
  { key: 'students', label: 'Estudiantes', icon: 'person' },
  { key: 'schedule', label: 'Calendario', icon: 'calendar' },
  { key: 'settings', label: 'Ajustes', icon: 'settings' },
];
export const RAIL_WIDTH = 104;

function NavItem({ item, active, onPress, horizontal }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={() => { haptic.tap(); onPress(item.key); }}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={item.label}
      style={({ pressed }) => ({
        flex: horizontal ? 1 : undefined, minHeight: 64, alignItems: 'center', justifyContent: 'center', gap: 4,
        borderRadius: radius.lg, marginHorizontal: horizontal ? 2 : space.sm, paddingVertical: space.sm,
        backgroundColor: active ? colors.primarySoft : 'transparent', opacity: pressed ? 0.8 : 1,
      })}
    >
      <Icon name={active ? item.icon : `${item.icon}-outline`} size={26} color={active ? 'primary' : 'textMuted'} />
      <Text variant="caption" color={active ? 'primary' : 'textMuted'} weight={active ? '700' : '500'}>{item.label}</Text>
    </Pressable>
  );
}

/** Tablet (≥ 720 dp): riel de navegación a la izquierda. Teléfono: barra inferior. */
export function AppShell({ route, onNavigate, connectionError, children }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const wide = width >= 720;

  const banner = connectionError ? (
    <View accessibilityRole="alert" style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, backgroundColor: colors.dangerSoft, borderBottomWidth: 1, borderColor: colors.danger }}>
      <Icon name="cloud-offline" color="danger" />
      <Text variant="small" color="danger" style={{ flex: 1 }}>Sin conexión con el servidor. Revise la red o la dirección en Ajustes.</Text>
      {route !== 'settings' ? <Button label="Ajustes" variant="dangerSoft" onPress={() => onNavigate('settings')} /> : null}
    </View>
  ) : null;

  if (wide) {
    return (
      <View style={{ flex: 1, flexDirection: 'row', backgroundColor: colors.bg }}>
        <View style={{ width: RAIL_WIDTH, paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.lg, backgroundColor: colors.surface, borderRightWidth: 1, borderColor: colors.border, gap: space.sm }}>
          <View style={{ alignItems: 'center', marginBottom: space.lg }}>
            <Image
              source={require('../../assets/logo-class-face.png')}
              style={{ width: 48, height: 48, borderRadius: 16 }}
              resizeMode="cover"
              accessibilityLabel="Logo"
            />
          </View>
          {NAV_ITEMS.map((it) => <NavItem key={it.key} item={it} active={route === it.key} onPress={onNavigate} />)}
        </View>
        <View style={{ flex: 1, paddingTop: insets.top }}>
          {banner}
          {children}
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ flex: 1, paddingTop: insets.top }}>
        {banner}
        {children}
      </View>
      <View style={{ flexDirection: 'row', backgroundColor: colors.surface, borderTopWidth: 1, borderColor: colors.border, paddingBottom: insets.bottom, paddingTop: space.xs }}>
        {NAV_ITEMS.map((it) => <NavItem key={it.key} item={it} active={route === it.key} onPress={onNavigate} horizontal />)}
      </View>
    </View>
  );
}
