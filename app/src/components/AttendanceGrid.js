import React, { useEffect, useRef } from 'react';
import { Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { Avatar, Chip, Icon, Text, haptic } from '../ui';
import { radius, space, useTheme } from '../theme';
import { isPresent, stats } from '../lib/grid';
import { photoUrl } from '../api';

const COL_W = 76;
const ROW_H = 76;
const ROW_H_COMPACT = 124; // teléfono: foto y porcentaje arriba, nombre y documento debajo
const HEAD_H = 92;
const FOOT_H = 48;

/**
 * Cuadrícula "Control de asistencia": estudiantes en filas, semanas en columnas.
 * ✓ = asistió. La columna de nombres queda fija mientras las 16 semanas se desplazan.
 * Semanas futuras o canceladas salen deshabilitadas, como en la pantalla original.
 */
export function AttendanceGrid({ grid, pending, onToggle, onPhoto }) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const nameW = width >= 900 ? 360 : width >= 600 ? 280 : 200;
  const compact = width < 600;
  const rowH = compact ? ROW_H_COMPACT : ROW_H;
  const hScroll = useRef(null);
  const { sessions, students, today } = grid;

  // Al abrir, desplaza las semanas para que la clase de hoy (o la última dictada) quede a la vista
  useEffect(() => {
    let target = sessions.findIndex((s) => s.date === today);
    if (target < 0) target = sessions.filter((s) => s.editable).length - 1;
    const id = setTimeout(() => hScroll.current?.scrollTo({ x: Math.max(0, (target - 2) * COL_W), animated: false }), 60);
    return () => clearTimeout(id);
  }, [grid.group.id, sessions.length, today]);

  const pctTone = (pct) => (pct === null ? 'neutral' : pct >= 80 ? 'success' : pct >= 60 ? 'warning' : 'danger');

  const headerCell = (s) => {
    const isToday = s.date === today;
    const off = !s.editable;
    return (
      <View
        key={s.id}
        accessible
        accessibilityLabel={`Semana ${s.week_number}, ${s.weekday} ${s.label}${s.cancelled ? ', cancelada' : ''}${isToday ? ', hoy' : ''}`}
        style={{
          width: COL_W, height: HEAD_H, alignItems: 'center', justifyContent: 'center', gap: 2,
          backgroundColor: isToday ? colors.primary : colors.surfaceAlt,
          borderLeftWidth: 1, borderColor: colors.border,
        }}
      >
        <Text variant="caption" color={isToday ? 'primaryText' : 'textMuted'}>Semana {s.week_number}</Text>
        <Text weight="700" color={isToday ? 'primaryText' : off ? 'textMuted' : 'text'}>{s.weekday}</Text>
        <Text variant="small" color={isToday ? 'primaryText' : off ? 'textMuted' : 'text'} style={s.cancelled ? { textDecorationLine: 'line-through' } : null}>{s.label}</Text>
        {s.cancelled ? <Text variant="caption" color="danger">Cancelada</Text> : isToday ? <Text variant="caption" color="primaryText">Hoy</Text> : null}
      </View>
    );
  };

  const cell = (student, s) => {
    const key = `${student.id}:${s.id}`;
    const present = isPresent(student, s.id, pending);
    const changed = key in pending;
    const auto = student.cells?.[s.id]?.source === 'auto' && present && !changed;
    return (
      <View key={s.id} style={{ width: COL_W, height: rowH, alignItems: 'center', justifyContent: 'center', borderLeftWidth: 1, borderColor: colors.border }}>
        <Pressable
          disabled={!s.editable}
          onPress={() => { haptic.tap(); onToggle(student, s); }}
          hitSlop={4}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: present, disabled: !s.editable }}
          accessibilityLabel={`${student.full_name}, semana ${s.week_number}: ${present ? 'asistió' : s.editable ? 'sin asistencia' : 'clase no disponible'}`}
          style={({ pressed }) => ({
            width: 44, height: 44, borderRadius: radius.sm + 2, alignItems: 'center', justifyContent: 'center',
            backgroundColor: !s.editable ? colors.disabled : present ? colors.successStrong : colors.surface,
            borderWidth: changed ? 3 : 2,
            borderColor: changed ? colors.warning : !s.editable ? colors.disabled : present ? colors.successStrong : colors.border,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          {present ? <Icon name="checkmark" size={26} color="#FFFFFF" /> : null}
          {!s.editable && s.cancelled ? <Icon name="remove" size={20} color="textMuted" /> : null}
        </Pressable>
        {/* Puntito: este ✓ lo puso el reconocimiento facial, no una persona */}
        {auto ? <View style={{ position: 'absolute', right: 12, top: 10, width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary, borderWidth: 2, borderColor: colors.surface }} /> : null}
      </View>
    );
  };

  return (
    <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
      <ScrollView nestedScrollEnabled>
        <View style={{ flexDirection: 'row' }}>
          {/* Columna fija: estudiantes */}
          <View style={{ width: nameW, borderRightWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, zIndex: 1 }}>
            <View style={{ height: HEAD_H, justifyContent: 'center', paddingHorizontal: space.lg, backgroundColor: colors.surfaceAlt }}>
              <Text variant="label">Estudiante</Text>
              <Text variant="caption" color="textMuted">{students.length} en el grupo</Text>
            </View>
            {students.map((st) => {
              const sum = stats(st, sessions, pending);
              const photo = (
                <Pressable onPress={() => onPhoto(st)} accessibilityRole="button" accessibilityLabel={`Ver foto de ${st.full_name}`}>
                  <Avatar name={st.full_name} url={photoUrl(st)} size={40} />
                </Pressable>
              );
              const pct = <Chip label={sum.pct === null ? '—' : `${sum.pct}%`} tone={pctTone(sum.pct)} />;
              if (compact) {
                return (
                  <View key={st.id} style={{ height: rowH, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.sm, borderTopWidth: 1, borderColor: colors.border }}>
                    <Text variant="caption" color="textMuted" style={{ width: 16, textAlign: 'center' }}>{st.index}</Text>
                    <View style={{ flex: 1, gap: 6 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>{photo}{pct}</View>
                      <Text variant="small" weight="600" numberOfLines={2}>{st.full_name}</Text>
                      <Text variant="caption" color="textMuted" numberOfLines={1}>{st.document}</Text>
                    </View>
                  </View>
                );
              }
              return (
                <View key={st.id} style={{ height: ROW_H, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, borderTopWidth: 1, borderColor: colors.border }}>
                  <Text variant="caption" color="textMuted" style={{ width: 20, textAlign: 'center' }}>{st.index}</Text>
                  {photo}
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text variant="small" weight="600" numberOfLines={2}>{st.full_name}</Text>
                    <Text variant="caption" color="textMuted">{st.document}</Text>
                  </View>
                  {pct}
                </View>
              );
            })}
            <View style={{ height: FOOT_H, justifyContent: 'center', paddingHorizontal: space.lg, borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt }}>
              <Text variant="label">Presentes por clase</Text>
            </View>
          </View>

          {/* Semanas: se desplazan horizontalmente */}
          <ScrollView horizontal ref={hScroll} showsHorizontalScrollIndicator nestedScrollEnabled>
            <View>
              <View style={{ flexDirection: 'row' }}>{sessions.map(headerCell)}</View>
              {students.map((st) => (
                <View key={st.id} style={{ flexDirection: 'row', borderTopWidth: 1, borderColor: colors.border }}>
                  {sessions.map((s) => cell(st, s))}
                </View>
              ))}
              <View style={{ flexDirection: 'row', height: FOOT_H, borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt }}>
                {sessions.map((s) => {
                  const n = students.filter((st) => isPresent(st, s.id, pending)).length;
                  return (
                    <View key={s.id} style={{ width: COL_W, alignItems: 'center', justifyContent: 'center', borderLeftWidth: 1, borderColor: colors.border }}>
                      <Text variant="small" weight="600" color={s.editable ? 'text' : 'textMuted'}>{s.editable ? `${n}/${students.length}` : '—'}</Text>
                    </View>
                  );
                })}
              </View>
            </View>
          </ScrollView>
        </View>
      </ScrollView>
    </View>
  );
}
