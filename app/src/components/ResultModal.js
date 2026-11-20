import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, View } from 'react-native';
import { Avatar, Button, Icon, Text, haptic } from '../ui';
import { radius, space, useTheme } from '../theme';
import { photoUrl } from '../api';

const TONES = {
  success: { icon: 'checkmark', fg: 'success', bg: 'successSoft' },
  info: { icon: 'information', fg: 'info', bg: 'infoSoft' },
  error: { icon: 'close', fg: 'danger', bg: 'dangerSoft' },
};

/**
 * Modal pequeña con el resultado del reconocimiento:
 *   success -> "Asistencia tomada correctamente" (se cierra sola; la barra muestra cuánto falta)
 *   info    -> el estudiante ya estaba registrado
 *   error   -> no se reconoció: NO se cierra sola; ofrece reintentar o marcar a mano
 * `inline`: se dibuja como capa dentro de la pantalla que lo contiene, no como otro Modal. Úselo cuando ya está
 * dentro de un Modal: en iOS, cerrar un Modal con otro encima deja la pantalla de abajo pegada (en negro).
 */
export function ResultModal({ result, onClose, onRetry, onManual, inline = false }) {
  const { colors } = useTheme();
  const scale = useRef(new Animated.Value(0.7)).current;
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!result) return undefined;
    scale.setValue(0.7);
    Animated.spring(scale, { toValue: 1, friction: 6, useNativeDriver: true }).start();
    if (result.kind === 'success') haptic.success();
    if (result.kind === 'error') haptic.error();
    if (!result.autoCloseMs) return undefined;
    progress.setValue(0);
    Animated.timing(progress, { toValue: 1, duration: result.autoCloseMs, easing: Easing.linear, useNativeDriver: false }).start();
    const timer = setTimeout(onClose, result.autoCloseMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  if (!result) return null;
  const tone = TONES[result.kind] ?? TONES.info;
  const wantsRetry = result.actions?.includes('retry');
  const wantsManual = result.actions?.includes('manual');

  const content = (
      <View style={[inline ? StyleSheet.absoluteFill : { flex: 1 }, { backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: space.xl }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Cerrar" />
        <Animated.View
          accessibilityLiveRegion="assertive"
          accessibilityRole="alert"
          style={{
            width: '100%', maxWidth: 380, backgroundColor: colors.surface, borderRadius: radius.xl, overflow: 'hidden',
            alignItems: 'center', paddingTop: space.xl, transform: [{ scale }],
          }}
        >
          <View style={{ width: 84, height: 84, borderRadius: 42, backgroundColor: colors[tone.bg], alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={tone.icon} size={46} color={tone.fg} />
          </View>

          <View style={{ padding: space.xl, paddingBottom: space.lg, alignItems: 'center', gap: space.md, width: '100%' }}>
            <Text variant="heading" style={{ textAlign: 'center' }}>{result.title}</Text>

            {result.student ? (
              <View style={{ alignItems: 'center', gap: space.sm }}>
                <Avatar name={result.student.full_name} url={photoUrl(result.student)} size={72} />
                <Text weight="600" style={{ textAlign: 'center' }}>{result.student.full_name}</Text>
                <Text variant="small" color="textMuted">{result.student.document}</Text>
              </View>
            ) : (
              <Text color="textMuted" style={{ textAlign: 'center' }}>{result.message}</Text>
            )}

            {result.kind === 'error' ? (
              <View style={{ width: '100%', gap: space.sm, marginTop: space.sm }}>
                {wantsRetry ? <Button label="Intentar de nuevo" icon="refresh" onPress={onRetry ?? onClose} /> : null}
                {wantsManual ? <Button label="Marcar manualmente" icon="create" variant="secondary" onPress={onManual} /> : null}
                <Button label="Cerrar" variant="ghost" onPress={onClose} />
              </View>
            ) : null}
          </View>

          {result.autoCloseMs ? (
            <View style={{ height: 5, width: '100%', backgroundColor: colors[tone.bg] }}>
              <Animated.View style={{
                height: 5, backgroundColor: colors[tone.fg],
                width: progress.interpolate({ inputRange: [0, 1], outputRange: ['100%', '0%'] }),
              }}
              />
            </View>
          ) : null}
        </Animated.View>
      </View>
  );
  if (inline) return content;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      {content}
    </Modal>
  );
}
