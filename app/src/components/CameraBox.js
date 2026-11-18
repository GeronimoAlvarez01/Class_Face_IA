import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Button, Icon, Text } from '../ui';
import { radius, space } from '../theme';
import { computeGuide, ovalSize } from '../lib/guide';

/**
 * Óvalo guía: el rostro debe quedar DENTRO. Con `solid` el trazo pasa de punteado a continuo (se usa en verde
 * cuando el rostro quedó bien encuadrado). Su tamaño sale de la misma fórmula que valida el servidor.
 */
export function FaceGuide({ color = 'rgba(255,255,255,0.85)', solid = false }) {
  const [size, setSize] = useState(null);
  const oval = size ? ovalSize(size.width, size.height) : null;
  return (
    <View
      pointerEvents="none"
      onLayout={(e) => setSize(e.nativeEvent.layout)}
      style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}
    >
      {oval ? (
        <View style={{ width: oval.w, height: oval.h, borderRadius: 999, borderWidth: solid ? 5 : 3, borderColor: color, borderStyle: solid ? 'solid' : 'dashed' }} />
      ) : null}
    </View>
  );
}

/**
 * Cámara con permiso incluido. Por ref expone:
 *   isReady()          -> la vista previa ya está lista
 *   capture(quality)   -> { uri, base64, guide }  (calidad 0.5 pesa poco y basta para detectar un rostro;
 *                         `guide` = dónde cae el óvalo dentro de la foto, para que el servidor valide el encuadre)
 * Funciona igual en la tablet (Android) y en el navegador de Mac/Windows con la cámara web.
 */
export const CameraBox = forwardRef(function CameraBox({ facing = 'back', overlay, style }, ref) {
  const [permission, requestPermission] = useCameraPermissions();
  const cam = useRef(null);
  const ready = useRef(false);
  const layout = useRef(null);

  useImperativeHandle(ref, () => ({
    isReady: () => ready.current && !!cam.current,
    capture: async (quality = 0.5) => {
      const photo = await cam.current.takePictureAsync({ quality, base64: true, shutterSound: false });
      return { uri: photo.uri, base64: photo.base64, guide: computeGuide(layout.current, photo) };
    },
  }), []);

  const box = { backgroundColor: '#000', overflow: 'hidden', borderRadius: radius.lg };

  if (!permission) {
    return <View style={[box, { alignItems: 'center', justifyContent: 'center' }, style]}><ActivityIndicator color="#fff" /></View>;
  }

  if (!permission.granted) {
    return (
      <View style={[box, { alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.md, backgroundColor: '#111827' }, style]}>
        <Icon name="camera" size={44} color="#FFFFFF" />
        <Text variant="heading" color="#FFFFFF" style={{ textAlign: 'center' }}>Necesitamos la cámara</Text>
        <Text color="#CBD5E1" style={{ textAlign: 'center', maxWidth: 380 }}>
          Se usa únicamente para reconocer a los estudiantes y tomar la asistencia. Las fotos no se guardan en la tablet.
        </Text>
        {permission.canAskAgain
          ? <Button label="Permitir cámara" icon="camera" onPress={requestPermission} />
          : <Button label="Abrir ajustes" icon="settings" onPress={() => Linking.openSettings()} />}
      </View>
    );
  }

  return (
    <View style={[box, style]} onLayout={(e) => { layout.current = e.nativeEvent.layout; }}>
      <CameraView ref={cam} style={StyleSheet.absoluteFill} facing={facing} onCameraReady={() => { ready.current = true; }} />
      {overlay}
    </View>
  );
});
