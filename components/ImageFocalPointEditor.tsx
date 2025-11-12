// components/ImageFocalPointEditor.tsx
// Allows user to pan/zoom an image and select the focal point area to crop

import React, { useCallback, useState, useEffect } from 'react';
import { View, StyleSheet, Modal, TouchableOpacity, Text, Dimensions } from 'react-native';
import { Image } from 'expo-image';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, clamp, runOnJS } from 'react-native-reanimated';
import * as ImageManipulator from 'expo-image-manipulator';
import { COLORS, RADIUS, SPACING } from '../lib/theme';
import { tap, success } from '../lib/haptics';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const EDITOR_WIDTH = SCREEN_WIDTH - 32;
const EDITOR_HEIGHT = SCREEN_HEIGHT * 0.7;
const MIN_SCALE = 1.0;
const MAX_SCALE = 3.0;

type Props = {
  visible: boolean;
  imageUri: string;
  onCancel: () => void;
  onConfirm: (croppedUri: string) => void;
};

export default function ImageFocalPointEditor({ visible, imageUri, onCancel, onConfirm }: Props) {
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const scale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedScale = useSharedValue(1);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  // Reset gesture values when modal opens
  useEffect(() => {
    if (visible) {
      scale.value = 1;
      translateX.value = 0;
      translateY.value = 0;
      savedScale.value = 1;
      savedTranslateX.value = 0;
      savedTranslateY.value = 0;
    }
  }, [visible]);

  // Load image dimensions
  useEffect(() => {
    if (visible && imageUri) {
      // Use ImageManipulator to get dimensions (same approach as capture.tsx)
      ImageManipulator.manipulateAsync(imageUri, [], { compress: 0, format: ImageManipulator.SaveFormat.JPEG })
        .then((result) => {
          const width = result.width ?? 0;
          const height = result.height ?? 0;
          
          if (width === 0 || height === 0) {
            setImageSize({ width: EDITOR_WIDTH, height: EDITOR_HEIGHT });
            return;
          }
          
          // Calculate size to fit in editor while maintaining aspect ratio
          const aspectRatio = width / height;
          let displayWidth = EDITOR_WIDTH;
          let displayHeight = EDITOR_WIDTH / aspectRatio;
          
          if (displayHeight > EDITOR_HEIGHT) {
            displayHeight = EDITOR_HEIGHT;
            displayWidth = EDITOR_HEIGHT * aspectRatio;
          }
          
          setImageSize({ width: displayWidth, height: displayHeight });
          // Reset transforms when image changes
          scale.value = 1;
          translateX.value = 0;
          translateY.value = 0;
          savedScale.value = 1;
          savedTranslateX.value = 0;
          savedTranslateY.value = 0;
        })
        .catch(() => {
          // Fallback to default size if we can't get dimensions
          setImageSize({ width: EDITOR_WIDTH, height: EDITOR_HEIGHT });
        });
    }
  }, [visible, imageUri]);

  // Constrain translation to keep image within bounds
  const constrainTranslation = useCallback(() => {
    if (imageSize.width === 0 || imageSize.height === 0) return;
    
    const currentScale = scale.value;
    const scaledWidth = imageSize.width * currentScale;
    const scaledHeight = imageSize.height * currentScale;
    
    const maxX = Math.max(0, (scaledWidth - EDITOR_WIDTH) / 2);
    const maxY = Math.max(0, (scaledHeight - EDITOR_HEIGHT) / 2);
    
    translateX.value = clamp(translateX.value, -maxX, maxX);
    translateY.value = clamp(translateY.value, -maxY, maxY);
    savedTranslateX.value = translateX.value;
    savedTranslateY.value = translateY.value;
  }, [imageSize]);

  // Combined gesture that handles both pinch and pan
  // Use Simultaneous so both can work together
  const pinchGesture = Gesture.Pinch()
    .onStart(() => {
      'worklet';
      // Save current scale when pinch starts
      savedScale.value = scale.value;
    })
    .onUpdate((e) => {
      'worklet';
      const newScale = savedScale.value * e.scale;
      scale.value = clamp(newScale, MIN_SCALE, MAX_SCALE);
    })
    .onEnd(() => {
      'worklet';
      savedScale.value = scale.value;
      runOnJS(constrainTranslation)();
    });

  const panGesture = Gesture.Pan()
    .minPointers(1)
    .maxPointers(1)
    .onStart(() => {
      'worklet';
      // Save current values when pan starts
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    })
    .onUpdate((e) => {
      'worklet';
      translateX.value = savedTranslateX.value + e.translationX;
      translateY.value = savedTranslateY.value + e.translationY;
    })
    .onEnd(() => {
      'worklet';
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
      runOnJS(constrainTranslation)();
    });

  // Use Simultaneous so both gestures can work together
  const composedGesture = Gesture.Simultaneous(pinchGesture, panGesture);

  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [
        { translateX: translateX.value },
        { translateY: translateY.value },
        { scale: scale.value },
      ],
    };
  });

  const handleConfirm = useCallback(async () => {
    if (!imageUri || imageSize.width === 0) return;
    
    await success();
    
    try {
      // Get current transform values
      const currentScale = scale.value;
      const currentTranslateX = translateX.value;
      const currentTranslateY = translateY.value;
      
      // Get original image dimensions
      const originalDims = await ImageManipulator.manipulateAsync(imageUri, [], { compress: 0, format: ImageManipulator.SaveFormat.JPEG })
        .then((result) => ({ width: result.width ?? 0, height: result.height ?? 0 }))
        .catch(() => ({ width: 0, height: 0 }));
      
      if (originalDims.width === 0 || originalDims.height === 0) {
        onConfirm(imageUri);
        return;
      }
      
      // The Animated.View is centered in the container
      // Transform order: translateX, translateY, then scale (around center)
      // When scale=1 and translate=0, image is centered
      
      // Calculate scaled dimensions
      const scaledWidth = imageSize.width * currentScale;
      const scaledHeight = imageSize.height * currentScale;
      
      // The image starts centered, so its center is at (EDITOR_WIDTH/2, EDITOR_HEIGHT/2)
      // After translation, the center moves to:
      const imageCenterX = EDITOR_WIDTH / 2 + currentTranslateX;
      const imageCenterY = EDITOR_HEIGHT / 2 + currentTranslateY;
      
      // The image bounds in container coordinates:
      const imageLeft = imageCenterX - scaledWidth / 2;
      const imageTop = imageCenterY - scaledHeight / 2;
      const imageRight = imageCenterX + scaledWidth / 2;
      const imageBottom = imageCenterY + scaledHeight / 2;
      
      // Calculate the intersection of the image with the editor viewport (0,0 to EDITOR_WIDTH, EDITOR_HEIGHT)
      const visibleLeft = Math.max(0, imageLeft);
      const visibleTop = Math.max(0, imageTop);
      const visibleRight = Math.min(EDITOR_WIDTH, imageRight);
      const visibleBottom = Math.min(EDITOR_HEIGHT, imageBottom);
      
      // Convert these container coordinates to coordinates within the scaled image
      const visibleLeftInScaledImage = visibleLeft - imageLeft;
      const visibleTopInScaledImage = visibleTop - imageTop;
      const visibleRightInScaledImage = visibleRight - imageLeft;
      const visibleBottomInScaledImage = visibleBottom - imageTop;
      
      // Convert from scaled image coordinates to original image coordinates
      const scaleFactor = originalDims.width / imageSize.width;
      const cropX = (visibleLeftInScaledImage * scaleFactor) / currentScale;
      const cropY = (visibleTopInScaledImage * scaleFactor) / currentScale;
      const cropWidth = ((visibleRightInScaledImage - visibleLeftInScaledImage) * scaleFactor) / currentScale;
      const cropHeight = ((visibleBottomInScaledImage - visibleTopInScaledImage) * scaleFactor) / currentScale;
      
      // Clamp crop coordinates to image bounds
      const finalCropX = Math.max(0, Math.min(originalDims.width - 1, Math.round(cropX)));
      const finalCropY = Math.max(0, Math.min(originalDims.height - 1, Math.round(cropY)));
      const finalCropWidth = Math.max(1, Math.min(originalDims.width - finalCropX, Math.round(cropWidth)));
      const finalCropHeight = Math.max(1, Math.min(originalDims.height - finalCropY, Math.round(cropHeight)));
      
      // Ensure we have valid crop dimensions
      if (finalCropWidth <= 0 || finalCropHeight <= 0 || finalCropX < 0 || finalCropY < 0) {
        console.warn('Invalid crop dimensions:', { finalCropX, finalCropY, finalCropWidth, finalCropHeight, originalDims });
        onConfirm(imageUri);
        return;
      }
      
      // Crop the image
      const result = await ImageManipulator.manipulateAsync(
        imageUri,
        [
          {
            crop: {
              originX: finalCropX,
              originY: finalCropY,
              width: finalCropWidth,
              height: finalCropHeight,
            },
          },
        ],
        { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG }
      );
      
      onConfirm(result.uri);
    } catch (error) {
      console.error('Error cropping image:', error);
      // If cropping fails, just use the original
      onConfirm(imageUri);
    }
  }, [imageUri, imageSize, scale, translateX, translateY, onConfirm]);

  const handleCancel = useCallback(async () => {
    await tap();
    onCancel();
  }, [onCancel]);

  if (!visible || !imageUri) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleCancel}>
      <GestureHandlerRootView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Adjust Image</Text>
          <Text style={styles.subtitle}>Pinch to zoom, drag to move</Text>
        </View>
        
        <View style={styles.editorContainer}>
          {/* Image layer - behind everything, no touch handling */}
          {imageSize.width > 0 && imageUri ? (
            <Animated.View 
              style={[StyleSheet.absoluteFill, { zIndex: 1, justifyContent: 'center', alignItems: 'center' }]}
              pointerEvents="none"
              collapsable={false}
            >
              <Animated.View 
                style={[styles.imageContainer, animatedStyle]}
                collapsable={false}
              >
                <Image
                  source={{ uri: imageUri }}
                  style={{ width: imageSize.width, height: imageSize.height }}
                  contentFit="contain"
                  pointerEvents="none"
                />
              </Animated.View>
            </Animated.View>
          ) : null}
          
          {/* Overlay frame to show crop area - behind gestures but visible */}
          <View style={[styles.overlay, { zIndex: 2 }]} pointerEvents="none">
            <View style={styles.cropFrame} />
          </View>
          
          {/* GestureDetector MUST be on top to receive all touches */}
          <GestureDetector gesture={composedGesture}>
            <Animated.View 
              style={[StyleSheet.absoluteFill, { zIndex: 10, backgroundColor: 'transparent' }]}
              collapsable={false}
            />
          </GestureDetector>
        </View>
        
        <View style={styles.footer}>
          <TouchableOpacity onPress={handleCancel} style={[styles.button, styles.cancelButton]}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleConfirm} style={[styles.button, styles.confirmButton]}>
            <Text style={styles.confirmButtonText}>Use This</Text>
          </TouchableOpacity>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  header: {
    marginBottom: SPACING.md,
    alignItems: 'center',
  },
  title: {
    color: COLORS.text,
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 4,
  },
  subtitle: {
    color: COLORS.subtext,
    fontSize: 14,
  },
  editorContainer: {
    width: EDITOR_WIDTH,
    height: EDITOR_HEIGHT,
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.md,
    position: 'relative',
  },
  imageContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cropFrame: {
    width: EDITOR_WIDTH - 4,
    height: EDITOR_HEIGHT - 4,
    borderWidth: 2,
    borderColor: COLORS.accent,
    borderRadius: RADIUS.md,
  },
  footer: {
    flexDirection: 'row',
    gap: SPACING.md,
    width: '100%',
    maxWidth: EDITOR_WIDTH,
  },
  button: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: RADIUS.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButton: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cancelButtonText: {
    color: COLORS.text,
    fontWeight: '800',
  },
  confirmButton: {
    backgroundColor: COLORS.accent,
  },
  confirmButtonText: {
    color: COLORS.onAccent,
    fontWeight: '800',
  },
});

