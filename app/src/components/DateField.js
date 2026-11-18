import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Icon, IconButton, Sheet, Text } from '../ui';
import { radius, space, useTheme } from '../theme';
import { longLabel, monthCells, monthTitle, parseISO } from '../lib/dates';

const WEEK_HEADER = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'];

/** Campo de fecha con calendario propio (funciona igual en Android y en el navegador, sin librerías nativas). */
export function DateField({ label, value, onChange, today, error, compact, hint }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const initial = parseISO(value ?? today ?? '2026-01-01');
  const [view, setView] = useState({ y: initial.getUTCFullYear(), m: initial.getUTCMonth() });
  const cells = useMemo(() => monthCells(view.y, view.m), [view]);

  const openPicker = () => {
    const d = parseISO(value ?? today ?? '2026-01-01');
    setView({ y: d.getUTCFullYear(), m: d.getUTCMonth() });
    setOpen(true);
  };
  const shift = (delta) => {
    const total = view.y * 12 + view.m + delta;
    setView({ y: Math.floor(total / 12), m: total % 12 });
  };

  return (
    <View style={{ gap: 6 }}>
      {label ? <Text variant="label">{label}</Text> : null}
      <Pressable
        onPress={openPicker}
        accessibilityRole="button"
        accessibilityLabel={`${label ?? 'Fecha'}: ${value ? longLabel(value) : 'sin fecha'}`}
        style={{
          minHeight: compact ? 40 : 48, borderRadius: radius.md, paddingHorizontal: space.lg, flexDirection: 'row', alignItems: 'center', gap: space.md,
          backgroundColor: colors.surface, borderWidth: 1, borderColor: error ? colors.danger : colors.border,
        }}
      >
        <Icon name="calendar" size={20} color="primary" />
        <Text style={{ flex: 1 }} numberOfLines={1}>{value ? longLabel(value) : 'Elegir fecha'}</Text>
      </Pressable>
      {error ? <Text variant="small" color="danger">{error}</Text> : null}

      <Sheet visible={open} onClose={() => setOpen(false)} title={label ?? 'Elegir fecha'}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <IconButton icon="chevron-back" label="Mes anterior" onPress={() => shift(-1)} filled />
          <Text variant="heading" style={{ textTransform: 'capitalize' }}>{monthTitle(view.y, view.m)}</Text>
          <IconButton icon="chevron-forward" label="Mes siguiente" onPress={() => shift(1)} filled />
        </View>
        <View style={{ flexDirection: 'row' }}>
          {WEEK_HEADER.map((d) => (
            <View key={d} style={{ flex: 1, alignItems: 'center' }}><Text variant="caption" color="textMuted">{d}</Text></View>
          ))}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {cells.map((iso, i) => {
            const selected = iso === value;
            const isToday = iso && iso === today;
            return (
              <View key={iso ?? `gap-${i}`} style={{ width: `${100 / 7}%`, aspectRatio: 1, padding: 2 }}>
                {iso ? (
                  <Pressable
                    onPress={() => { onChange(iso); setOpen(false); }}
                    accessibilityRole="button"
                    accessibilityLabel={longLabel(iso)}
                    accessibilityState={{ selected }}
                    style={{
                      flex: 1, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
                      backgroundColor: selected ? colors.primary : 'transparent',
                      borderWidth: isToday && !selected ? 2 : 0, borderColor: colors.primary,
                    }}
                  >
                    <Text weight={selected ? '700' : '500'} color={selected ? 'primaryText' : 'text'}>{Number(iso.slice(8))}</Text>
                  </Pressable>
                ) : null}
              </View>
            );
          })}
        </View>
        {hint ? <Text variant="small" color="textMuted">{hint}</Text> : null}
      </Sheet>
    </View>
  );
}
