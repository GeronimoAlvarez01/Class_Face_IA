import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import {
  ActivityIndicator, Animated, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView,
  StyleSheet, Text as RNText, TextInput, useWindowDimensions, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { radius, space, type, useTheme } from './theme';
import { authHeaders } from './api';

// ---------- háptica (no hace nada en web) ----------
const safe = (fn) => { try { Promise.resolve(fn()).catch(() => {}); } catch { /* sin háptica */ } };
export const haptic = {
  tap: () => safe(() => Haptics.selectionAsync()),
  success: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  error: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};

// ---------- tipografía ----------
export function Text({ variant = 'body', color, weight, style, ...props }) {
  const { colors } = useTheme();
  const t = type[variant];
  return (
    <RNText
      {...props}
      style={[{ color: colors[color] ?? color ?? colors.text, fontSize: t.size, lineHeight: t.line, fontWeight: weight ?? t.weight }, style]}
    />
  );
}

export const Icon = ({ name, size = 22, color = 'text', style }) => {
  const { colors } = useTheme();
  return <Ionicons name={name} size={size} color={colors[color] ?? color} style={style} />;
};

// ---------- botones ----------
export function Button({
  label, onPress, variant = 'primary', size = 'md', icon, loading, disabled, style, accessibilityLabel,
}) {
  const { colors } = useTheme();
  const scheme = {
    primary: { bg: colors.primary, fg: colors.primaryText, border: 'transparent' },
    secondary: { bg: colors.surface, fg: colors.text, border: colors.border },
    soft: { bg: colors.primarySoft, fg: colors.primary, border: 'transparent' },
    ghost: { bg: 'transparent', fg: colors.primary, border: 'transparent' },
    danger: { bg: colors.danger, fg: '#FFFFFF', border: 'transparent' },
    dangerSoft: { bg: colors.dangerSoft, fg: colors.danger, border: 'transparent' },
  }[variant];
  const off = disabled || loading;
  return (
    <Pressable
      onPress={off ? undefined : () => { haptic.tap(); onPress?.(); }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      style={({ pressed }) => [{
        minHeight: size === 'lg' ? 56 : 48, paddingHorizontal: size === 'lg' ? 28 : 20, borderRadius: radius.md,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm,
        backgroundColor: scheme.bg, borderWidth: 1, borderColor: scheme.border,
        opacity: off ? 0.5 : pressed ? 0.85 : 1,
      }, style]}
    >
      {loading ? <ActivityIndicator color={scheme.fg} /> : icon ? <Icon name={icon} size={20} color={scheme.fg} /> : null}
      {label ? <Text variant="label" color={scheme.fg} style={size === 'lg' ? { fontSize: 16 } : null}>{label}</Text> : null}
    </Pressable>
  );
}

export function IconButton({ icon, onPress, label, tone = 'text', filled, style }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={() => { haptic.tap(); onPress?.(); }}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => [{
        width: 48, height: 48, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center',
        backgroundColor: filled ? colors.surfaceAlt : 'transparent', opacity: pressed ? 0.7 : 1,
      }, style]}
    >
      <Icon name={icon} size={24} color={tone} />
    </Pressable>
  );
}

// ---------- contenedores ----------
export function Card({ children, style, onPress, accessibilityLabel }) {
  const { colors } = useTheme();
  const base = {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: space.lg,
  };
  if (!onPress) return <View style={[base, style]}>{children}</View>;
  return (
    <Pressable
      onPress={() => { haptic.tap(); onPress(); }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [base, { opacity: pressed ? 0.88 : 1 }, style]}
    >
      {children}
    </Pressable>
  );
}

export function Chip({ label, icon, tone = 'neutral', onPress, style }) {
  const { colors } = useTheme();
  const t = {
    neutral: [colors.surfaceAlt, colors.text], primary: [colors.primarySoft, colors.primary],
    success: [colors.successSoft, colors.success], danger: [colors.dangerSoft, colors.danger],
    warning: [colors.warningSoft, colors.warning], info: [colors.infoSoft, colors.info],
  }[tone];
  const content = (
    <>
      {icon ? <Icon name={icon} size={14} color={t[1]} /> : null}
      <Text variant="caption" color={t[1]} weight="600">{label}</Text>
    </>
  );
  const box = { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: t[0], borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5, alignSelf: 'flex-start' };
  return onPress ? (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={8} style={[box, style]}>{content}</Pressable>
  ) : (
    <View style={[box, style]}>{content}</View>
  );
}

// ---------- formularios ----------
export function Field({ label, error, helper, style, ...inputProps }) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={[{ gap: 6 }, style]}>
      {label ? <Text variant="label">{label}</Text> : null}
      <TextInput
        {...inputProps}
        accessibilityLabel={label}
        placeholderTextColor={colors.textMuted}
        onFocus={(e) => { setFocused(true); inputProps.onFocus?.(e); }}
        onBlur={(e) => { setFocused(false); inputProps.onBlur?.(e); }}
        style={{
          minHeight: 48, borderRadius: radius.md, paddingHorizontal: space.lg, fontSize: 16, color: colors.text,
          backgroundColor: colors.surface, borderWidth: focused ? 2 : 1,
          borderColor: error ? colors.danger : focused ? colors.primary : colors.border,
        }}
      />
      {error ? <Text variant="small" color="danger">{error}</Text> : helper ? <Text variant="small" color="textMuted">{helper}</Text> : null}
    </View>
  );
}

export function Select({ label, value, options, onChange, placeholder = 'Seleccione', error, style }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <View style={[{ gap: 6 }, style]}>
      {label ? <Text variant="label">{label}</Text> : null}
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${label ?? 'Seleccionar'}: ${current?.label ?? placeholder}`}
        style={{
          minHeight: 48, borderRadius: radius.md, paddingHorizontal: space.lg, flexDirection: 'row', alignItems: 'center',
          justifyContent: 'space-between', gap: space.md, backgroundColor: colors.surface, borderWidth: 1,
          borderColor: error ? colors.danger : colors.border,
        }}
      >
        <Text numberOfLines={1} style={{ flex: 1 }} color={current ? 'text' : 'textMuted'}>{current?.label ?? placeholder}</Text>
        <Icon name="chevron-down" size={18} color="textMuted" />
      </Pressable>
      {error ? <Text variant="small" color="danger">{error}</Text> : null}
      <Sheet visible={open} onClose={() => setOpen(false)} title={label ?? 'Seleccione'}>
        {options.length === 0 ? <Text color="textMuted">No hay opciones disponibles.</Text> : null}
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <Pressable
              key={String(o.value)}
              onPress={() => { onChange(o.value); setOpen(false); }}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              style={{
                minHeight: 56, paddingHorizontal: space.lg, borderRadius: radius.md, flexDirection: 'row', alignItems: 'center',
                gap: space.md, backgroundColor: selected ? colors.primarySoft : colors.surfaceAlt,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text weight="600">{o.label}</Text>
                {o.sub ? <Text variant="small" color="textMuted">{o.sub}</Text> : null}
              </View>
              {selected ? <Icon name="checkmark-circle" color="primary" /> : null}
            </Pressable>
          );
        })}
      </Sheet>
    </View>
  );
}

export function Checkbox({ checked, onChange, label, error }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={() => { haptic.tap(); onChange(!checked); }}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-start', minHeight: 48 }}
    >
      <View style={{
        width: 28, height: 28, borderRadius: 8, borderWidth: 2, marginTop: 2, alignItems: 'center', justifyContent: 'center',
        borderColor: error ? colors.danger : checked ? colors.primary : colors.border, backgroundColor: checked ? colors.primary : colors.surface,
      }}
      >
        {checked ? <Icon name="checkmark" size={18} color="primaryText" /> : null}
      </View>
      <Text style={{ flex: 1 }} variant="small">{label}</Text>
    </Pressable>
  );
}

// ---------- hojas / diálogos ----------
export function Sheet({ visible, onClose, title, children, footer, wide }) {
  const { colors } = useTheme();
  const { width, height } = useWindowDimensions();
  const centered = width >= 720; // tablet: diálogo centrado; teléfono: hoja inferior
  return (
    <Modal visible={visible} transparent animationType={centered ? 'fade' : 'slide'} onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: colors.overlay, justifyContent: centered ? 'center' : 'flex-end', alignItems: centered ? 'center' : 'stretch' }}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Cerrar" />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ width: centered ? (wide ? 760 : 560) : '100%', maxHeight: height * 0.92 }}
        >
          <View style={{
            backgroundColor: colors.surface, overflow: 'hidden', borderRadius: centered ? radius.xl : 0,
            borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
          }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: space.xl, paddingRight: space.sm, paddingTop: space.sm }}>
              <Text variant="heading" style={{ flex: 1 }} accessibilityRole="header">{title}</Text>
              <IconButton icon="close" label="Cerrar" onPress={onClose} />
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space.xl, paddingTop: space.md, gap: space.lg }}>
              {children}
            </ScrollView>
            {footer ? (
              <View style={{ padding: space.lg, borderTopWidth: 1, borderColor: colors.border, flexDirection: 'row', gap: space.md, justifyContent: 'flex-end' }}>
                {footer}
              </View>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ---------- avisos (toast) y confirmaciones ----------
const FeedbackContext = createContext(null);
export const useFeedback = () => useContext(FeedbackContext);

export function FeedbackProvider({ children }) {
  const { colors } = useTheme();
  const [toast, setToast] = useState(null);
  const [confirmState, setConfirmState] = useState(null);
  const timer = useRef(null);
  const slide = useRef(new Animated.Value(0)).current;

  // `duration` en ms; por defecto 3 s (5 s los errores). Un aviso nuevo reemplaza al anterior y reinicia el reloj.
  const show = useCallback((message, tone = 'info', { duration } = {}) => {
    clearTimeout(timer.current);
    const id = Date.now() + Math.random();
    setToast({ id, message, tone });
    slide.setValue(0);
    Animated.spring(slide, { toValue: 1, useNativeDriver: true, friction: 8 }).start();
    if (tone === 'success') haptic.success();
    if (tone === 'error') haptic.error();
    // Solo cierra SU aviso: si ya salió otro, no lo toca
    timer.current = setTimeout(() => setToast((t) => (t?.id === id ? null : t)), duration ?? (tone === 'error' ? 5000 : 3000));
  }, [slide]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const confirm = useCallback((opts) => new Promise((resolve) => setConfirmState({ ...opts, resolve })), []);
  const answer = (value) => { confirmState?.resolve(value); setConfirmState(null); };
  const value = useMemo(() => ({ toast: show, confirm }), [show, confirm]);

  const tones = {
    success: ['checkmark-circle', colors.success, colors.successSoft],
    error: ['alert-circle', colors.danger, colors.dangerSoft],
    info: ['information-circle', colors.info, colors.infoSoft],
  };
  const [icon, fg, bg] = tones[toast?.tone] ?? tones.info;

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      {toast ? (
        <Animated.View
          pointerEvents="none"
          accessibilityLiveRegion="polite"
          style={{
            position: 'absolute', bottom: 32, alignSelf: 'center', maxWidth: 560, marginHorizontal: space.lg,
            flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md,
            borderRadius: radius.lg, backgroundColor: bg, borderWidth: 1, borderColor: fg,
            opacity: slide, transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }],
          }}
        >
          <Icon name={icon} color={fg} />
          <Text style={{ flexShrink: 1 }} color={fg} weight="600">{toast.message}</Text>
        </Animated.View>
      ) : null}
      <Sheet
        visible={!!confirmState}
        onClose={() => answer(false)}
        title={confirmState?.title ?? ''}
        footer={(
          <>
            <Button label="Cancelar" variant="secondary" onPress={() => answer(false)} />
            <Button label={confirmState?.confirmLabel ?? 'Confirmar'} variant={confirmState?.danger ? 'danger' : 'primary'} onPress={() => answer(true)} />
          </>
        )}
      >
        <Text color="textMuted">{confirmState?.message}</Text>
      </Sheet>
    </FeedbackContext.Provider>
  );
}

// ---------- estados: carga, vacío, error ----------
export function Skeleton({ height = 20, width = '100%', radiusSize = 8, style }) {
  const { colors } = useTheme();
  const pulse = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0.45, duration: 700, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return <Animated.View style={[{ height, width, borderRadius: radiusSize, backgroundColor: colors.border, opacity: pulse }, style]} />;
}

export function SkeletonList({ rows = 4 }) {
  return (
    <View style={{ gap: space.md }} accessibilityLabel="Cargando">
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} height={72} radiusSize={16} />)}
    </View>
  );
}

export function EmptyState({ icon = 'folder-open', title, message, action }) {
  const { colors } = useTheme();
  return (
    <View style={{ alignItems: 'center', padding: space.xxl, gap: space.md }}>
      <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={34} color="primary" />
      </View>
      <Text variant="heading" style={{ textAlign: 'center' }}>{title}</Text>
      {message ? <Text color="textMuted" style={{ textAlign: 'center', maxWidth: 420 }}>{message}</Text> : null}
      {action}
    </View>
  );
}

export function ErrorState({ error, onRetry }) {
  const offline = error?.status === 0;
  return (
    <EmptyState
      icon={offline ? 'cloud-offline' : 'alert-circle'}
      title={offline ? 'Sin conexión con el servidor' : 'Algo salió mal'}
      message={offline ? `${error.message} Revise la dirección en Ajustes y que el servidor esté encendido.` : error?.message}
      action={onRetry ? <Button label="Reintentar" icon="refresh" onPress={onRetry} /> : null}
    />
  );
}

/** Error dentro de una ventana: un toast quedaría tapado por la propia ventana, así que va en línea. */
export function InlineError({ message }) {
  const { colors } = useTheme();
  if (!message) return null;
  return (
    <View accessibilityRole="alert" style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', padding: space.md, borderRadius: radius.md, backgroundColor: colors.dangerSoft }}>
      <Icon name="alert-circle" size={20} color="danger" />
      <Text variant="small" color="danger" style={{ flex: 1 }}>{message}</Text>
    </View>
  );
}

export function ProgressBar({ value, color = 'successStrong', height = 8 }) {
  const { colors } = useTheme();
  return (
    <View style={{ height, borderRadius: height, backgroundColor: colors.surfaceAlt, overflow: 'hidden' }}>
      <View style={{ height, width: `${Math.max(0, Math.min(1, value)) * 100}%`, backgroundColor: colors[color] ?? color, borderRadius: height }} />
    </View>
  );
}

// ---------- avatar con foto (envía la clave de la API) ----------
// Un <Image> con encabezados no siempre los respeta en la tablet y deja el círculo vacío. Por eso la foto se baja con
// fetch (que sí envía la clave) y se muestra ya descargada: en web como blob, en Android/iOS como imagen embebida.
const nativePhotoCache = new Map(); // url -> data URI (se limita para no llenar la memoria con fotos grandes)
const NATIVE_CACHE_MAX = 60;

const blobToDataUri = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onloadend = () => resolve(reader.result);
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

function useImageSource(url) {
  const [src, setSrc] = useState(() => (url && nativePhotoCache.has(url) ? { uri: nativePhotoCache.get(url) } : null));
  useEffect(() => {
    if (!url) { setSrc(null); return undefined; }
    let cancelled = false;
    let objectUrl = null;
    if (Platform.OS !== 'web' && nativePhotoCache.has(url)) { setSrc({ uri: nativePhotoCache.get(url) }); return undefined; }
    setSrc(null);
    (async () => {
      try {
        const res = await fetch(url, { headers: authHeaders() });
        if (!res.ok) throw new Error('foto');
        const blob = await res.blob();
        if (Platform.OS === 'web') {
          objectUrl = URL.createObjectURL(blob);
          if (!cancelled) setSrc({ uri: objectUrl });
        } else {
          const uri = await blobToDataUri(blob);
          if (nativePhotoCache.size >= NATIVE_CACHE_MAX) nativePhotoCache.delete(nativePhotoCache.keys().next().value);
          nativePhotoCache.set(url, uri);
          if (!cancelled) setSrc({ uri });
        }
      } catch {
        if (!cancelled) setSrc(null);
      }
    })();
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [url]);
  return src;
}

const initials = (name = '') => name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

export function Avatar({ name, url, size = 48 }) {
  const { colors } = useTheme();
  const source = useImageSource(url);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [source]);
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      {/* Las iniciales siempre quedan debajo: si la foto tarda o falla, nunca se ve un círculo vacío */}
      <Text variant="label" color="primary">{initials(name)}</Text>
      {source && !failed ? (
        <Image
          source={source}
          onError={() => setFailed(true)}
          style={{ position: 'absolute', top: 0, left: 0, width: size, height: size }}
          resizeMode="cover"
          accessibilityLabel={`Foto de ${name}`}
        />
      ) : null}
    </View>
  );
}

export function PhotoView({ url, name, size = 280 }) {
  const { colors } = useTheme();
  const source = useImageSource(url);
  return (
    <View style={{ width: size, height: size, borderRadius: radius.lg, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', alignSelf: 'center' }}>
      {source ? <Image source={source} style={{ width: size, height: size }} resizeMode="cover" accessibilityLabel={`Foto de ${name}`} /> : <ActivityIndicator />}
    </View>
  );
}

// ---------- encabezado de pantalla ----------
export function ScreenHeader({ title, subtitle, right }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap', marginBottom: space.lg }}>
      <View style={{ flex: 1, minWidth: 220 }}>
        <Text variant="display" accessibilityRole="header">{title}</Text>
        {subtitle ? <Text color="textMuted">{subtitle}</Text> : null}
      </View>
      {right ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap' }}>{right}</View> : null}
    </View>
  );
}

// ---------- datos asíncronos ----------
export function useAsync(fn, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const run = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fn();
      setState({ data, error: null, loading: false });
      return data;
    } catch (error) {
      setState((s) => ({ ...s, error, loading: false }));
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { ...state, reload: run };
}
