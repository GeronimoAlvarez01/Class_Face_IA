import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';

// Paleta con contraste AA para texto sobre cada superficie, en claro y oscuro.
// El color nunca es el único portador de significado: siempre va acompañado de icono o texto.
export const light = {
  bg: '#F4F6FA', surface: '#FFFFFF', surfaceAlt: '#EEF2F8', border: '#DDE3EC',
  text: '#0F172A', textMuted: '#5B6678',
  primary: '#2456E5', primaryText: '#FFFFFF', primarySoft: '#E3EBFF',
  success: '#12803C', successSoft: '#DDF5E6', successStrong: '#16A34A',
  danger: '#C62828', dangerSoft: '#FDE7E7',
  warning: '#B45309', warningSoft: '#FEF1D6',
  info: '#0369A1', infoSoft: '#DDF1FB',
  overlay: 'rgba(15, 23, 42, 0.55)', disabled: '#EAEEF4', shadow: '#0F172A',
};

export const dark = {
  bg: '#0B1220', surface: '#131C2E', surfaceAlt: '#1A2540', border: '#26324A',
  text: '#EEF2FA', textMuted: '#9AA7BE',
  primary: '#6B93FF', primaryText: '#0B1220', primarySoft: '#1E2D57',
  success: '#4ADE80', successSoft: '#12301F', successStrong: '#22C55E',
  danger: '#FF8A8A', dangerSoft: '#3A1818',
  warning: '#FBBF24', warningSoft: '#3A2C0E',
  info: '#7DD3FC', infoSoft: '#102B3B',
  overlay: 'rgba(0, 0, 0, 0.65)', disabled: '#1A2336', shadow: '#000000',
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 };

// Escala tipográfica (tamaño / interlineado). El cuerpo nunca baja de 14 para que se lea desde un atril.
export const type = {
  display: { size: 30, line: 38, weight: '700' },
  title: { size: 22, line: 30, weight: '700' },
  heading: { size: 18, line: 26, weight: '600' },
  body: { size: 16, line: 24, weight: '400' },
  label: { size: 14, line: 20, weight: '600' },
  small: { size: 14, line: 20, weight: '400' },
  caption: { size: 12, line: 16, weight: '500' },
};

const ThemeContext = createContext({ colors: light, dark: false });

export function ThemeProvider({ children }) {
  const scheme = useColorScheme();
  const value = useMemo(() => ({ colors: scheme === 'dark' ? dark : light, dark: scheme === 'dark' }), [scheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
