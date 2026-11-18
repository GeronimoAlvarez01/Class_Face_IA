import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { api } from '../api';
import { useApp } from '../context';
import {
  Button, Card, Chip, EmptyState, ErrorState, IconButton, ScreenHeader, Select, SkeletonList, Text, useAsync, useFeedback,
} from '../ui';
import { DateField } from '../components/DateField';
import { radius, space, useTheme } from '../theme';
import { addDays, buildSchedule, longLabel, weekdayLong } from '../lib/dates';

const QUICK_WEEKS = [14, 16, 18];

/** Admin 2: define el día y las fechas de clase del grupo. Una clase por semana, el mismo día. */
export default function ScheduleScreen() {
  const { colors } = useTheme();
  const { toast } = useFeedback();
  const { health, groups, groupId, setGroupId, reloadGroups, goTo } = useApp();
  const today = health?.today;

  const sched = useAsync(() => (groupId ? api.schedule.get(groupId) : Promise.resolve(null)), [groupId]);
  const [start, setStart] = useState(null);
  const [weeks, setWeeks] = useState(16);
  const [ex, setEx] = useState({}); // semana -> { week, cancelled?, date? }
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!sched.data) return;
    const p = sched.data.params;
    setStart(p?.start_date ?? today ?? null);
    setWeeks(p?.weeks ?? 16);
    setEx(Object.fromEntries((p?.exceptions ?? []).map((e) => [e.week, e])));
  }, [sched.data, today]);

  const rows = useMemo(() => {
    if (!start) return [];
    return buildSchedule({ start_date: start, weeks, exceptions: Object.values(ex).filter((e) => e.week <= weeks) });
  }, [start, weeks, ex]);

  // Dos clases activas el mismo día serían un error (el servidor también lo rechaza)
  const clashes = useMemo(() => {
    const seen = new Map();
    const bad = new Set();
    rows.filter((r) => !r.cancelled).forEach((r) => {
      if (seen.has(r.session_date)) { bad.add(r.week_number); bad.add(seen.get(r.session_date)); }
      seen.set(r.session_date, r.week_number);
    });
    return bad;
  }, [rows]);

  const setException = (week, patch) => setEx((prev) => {
    const merged = { ...(prev[week] ?? { week }), ...patch };
    const next = { ...prev };
    if (!merged.cancelled && !merged.date) delete next[week];
    else next[week] = merged;
    return next;
  });

  const moveWeek = (week, date) => {
    const original = addDays(start, 7 * (week - 1));
    setException(week, { date: date === original ? undefined : date });
  };

  const save = async () => {
    setSaving(true);
    try {
      const exceptions = Object.values(ex).filter((e) => e.week <= weeks).map((e) => ({
        week: e.week, ...(e.cancelled ? { cancelled: true } : {}), ...(e.date ? { date: e.date } : {}),
      }));
      await api.schedule.save(groupId, { start_date: start, weeks, exceptions });
      toast('Calendario guardado', 'success');
      reloadGroups();
      sched.reload();
    } catch (e) {
      const detail = e.details?.weeks ? ` Semanas con asistencia: ${e.details.weeks.join(', ')}.` : '';
      toast(`${e.message}${detail}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const dayName = start ? weekdayLong(start) : '';
  const dayPlural = dayName.endsWith('s') ? dayName : `${dayName}s`;
  const summary = (r) => {
    if (r.cancelled) return { label: 'Cancelada', tone: 'danger' };
    if (today && r.session_date === today) return { label: 'Hoy', tone: 'primary' };
    if (today && r.session_date < today) return { label: 'Ya dictada', tone: 'neutral' };
    return { label: 'Programada', tone: 'info' };
  };

  return (
    <ScrollView contentContainerStyle={{ padding: space.xl, paddingBottom: 140, gap: space.lg }}>
      <ScreenHeader title="Calendario de clases" subtitle="Elija el grupo, la fecha de la primera clase y cuántas semanas dura. Las demás fechas se calculan solas." />

      <Select
        label="Grupo"
        value={groupId}
        onChange={setGroupId}
        placeholder="Elija un grupo"
        options={(groups ?? []).map((g) => ({ value: g.id, label: g.label }))}
      />

      {!groups || groups.length === 0 ? (
        <EmptyState icon="people" title="Primero cree un grupo" action={<Button label="Ir a grupos" onPress={() => goTo('groups')} />} />
      ) : sched.error ? <ErrorState error={sched.error} onRetry={sched.reload} /> : !start ? <SkeletonList rows={3} /> : (
        <>
          <Card style={{ gap: space.lg }}>
            <View style={{ flexDirection: 'row', gap: space.lg, flexWrap: 'wrap' }}>
              <View style={{ flex: 1, minWidth: 260 }}>
                <DateField label="Fecha de la primera clase" value={start} today={today} onChange={(d) => { setStart(d); setEx({}); }} hint="Las clases se repiten cada semana ese mismo día." />
              </View>
              <View style={{ gap: 6 }}>
                <Text variant="label">Número de semanas</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                  <IconButton icon="remove" label="Menos semanas" filled onPress={() => setWeeks((w) => Math.max(1, w - 1))} />
                  <Text variant="title" style={{ minWidth: 40, textAlign: 'center' }} accessibilityLiveRegion="polite">{weeks}</Text>
                  <IconButton icon="add" label="Más semanas" filled onPress={() => setWeeks((w) => Math.min(52, w + 1))} />
                </View>
                <View style={{ flexDirection: 'row', gap: space.sm }}>
                  {QUICK_WEEKS.map((n) => <Chip key={n} label={`${n}`} tone={weeks === n ? 'primary' : 'neutral'} onPress={() => setWeeks(n)} />)}
                </View>
              </View>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: colors.primarySoft, borderRadius: radius.md, padding: space.md }}>
              <Chip tone="primary" icon="repeat" label={`Todos los ${dayPlural}`} />
              <Text variant="small" color="primary" style={{ flex: 1 }}>{weeks} clases: del {rows.length ? longLabel(rows[0].session_date) : ''} al {rows.length ? longLabel(rows[rows.length - 1].session_date) : ''}.</Text>
            </View>
          </Card>

          <View style={{ gap: space.sm }}>
            <Text variant="heading">Fechas de clase</Text>
            <Text variant="small" color="textMuted">Toque una fecha para moverla (reposición) o cancele la clase de un festivo. La numeración de semanas se conserva.</Text>
            {rows.map((r) => {
              const tag = summary(r);
              const clash = clashes.has(r.week_number);
              return (
                <Card key={r.week_number} style={{ padding: space.md, gap: space.sm, borderColor: clash ? colors.danger : colors.border, opacity: r.cancelled ? 0.75 : 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap' }}>
                    <View style={{ width: 52, height: 52, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
                      <Text variant="caption" color="textMuted">Sem.</Text>
                      <Text variant="heading">{r.week_number}</Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 240 }}>
                      <DateField compact value={r.session_date} today={today} onChange={(d) => moveWeek(r.week_number, d)} />
                    </View>
                    <Chip label={tag.label} tone={tag.tone} />
                    {r.moved ? <Chip label="Movida" tone="warning" icon="swap-horizontal" /> : null}
                    <Button
                      label={r.cancelled ? 'Restablecer' : 'Cancelar clase'}
                      variant={r.cancelled ? 'soft' : 'dangerSoft'}
                      onPress={() => setException(r.week_number, { cancelled: r.cancelled ? undefined : true })}
                    />
                  </View>
                  {clash ? <Text variant="small" color="danger">Esta fecha coincide con otra clase. Cambie una de las dos.</Text> : null}
                </Card>
              );
            })}
          </View>
        </>
      )}

      {start ? (
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: space.md }}>
          <Button label="Guardar calendario" icon="save" size="lg" loading={saving} disabled={clashes.size > 0} onPress={save} />
        </View>
      ) : null}
    </ScrollView>
  );
}
