import { useCallback, useState } from 'react';
import {
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { useTheme } from '@/src/hooks/useTheme';

export type SliderProps = {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  style?: StyleProp<ViewStyle>;
  height?: number;
  thumbSize?: number;
};

function clamp(value: number, min: number, max: number): number {
  'worklet';
  return Math.max(min, Math.min(max, value));
}

function quantize(value: number, step: number, min: number): number {
  'worklet';
  if (step <= 0) return value;
  return min + Math.round((value - min) / step) * step;
}

export function Slider({
  value,
  min,
  max,
  step = 0.01,
  onChange,
  style,
  height = 4,
  thumbSize = 24
}: SliderProps) {
  const { colors, radius } = useTheme();
  const [trackWidth, setTrackWidth] = useState(0);
  const usableWidth = Math.max(0, trackWidth - thumbSize);
  const range = Math.max(0.0001, max - min);
  const ratio = clamp((value - min) / range, 0, 1);

  const dragStartRatio = useSharedValue(ratio);
  const dragRatio = useSharedValue(ratio);
  const dragging = useSharedValue(false);

  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    setTrackWidth(e.nativeEvent.layout.width);
  }, []);

  const emit = useCallback(
    (nextRatio: number) => {
      const raw = min + nextRatio * range;
      const stepped = step > 0 ? quantize(raw, step, min) : raw;
      const clamped = clamp(stepped, min, max);
      if (clamped !== value) onChange(clamped);
    },
    [min, max, step, range, value, onChange]
  );

  const pan = Gesture.Pan()
    .minDistance(0)
    .onBegin(() => {
      dragging.value = true;
      dragStartRatio.value = ratio;
      dragRatio.value = ratio;
    })
    .onUpdate(event => {
      if (usableWidth <= 0) return;
      const next = clamp(dragStartRatio.value + event.translationX / usableWidth, 0, 1);
      dragRatio.value = next;
      runOnJS(emit)(next);
    })
    .onEnd(() => {
      dragging.value = false;
    });

  const fillStyle = useAnimatedStyle(() => {
    const r = dragging.value ? dragRatio.value : ratio;
    return { width: `${r * 100}%` };
  });

  const thumbStyle = useAnimatedStyle(() => {
    const r = dragging.value ? dragRatio.value : ratio;
    return { left: r * usableWidth };
  });

  return (
    <GestureDetector gesture={pan}>
      <View
        onLayout={handleLayout}
        style={[styles.container, { height: thumbSize }, style]}
        hitSlop={12}
      >
        <View
          style={[
            styles.track,
            {
              height,
              backgroundColor: colors.border,
              borderRadius: radius.full
            }
          ]}
        >
          <Animated.View
            style={[
              styles.fill,
              { backgroundColor: colors.accent, borderRadius: radius.full },
              fillStyle
            ]}
          />
        </View>
        <Animated.View
          style={[
            styles.thumb,
            {
              width: thumbSize,
              height: thumbSize,
              borderRadius: thumbSize / 2,
              backgroundColor: colors.bg,
              borderColor: colors.accent
            },
            thumbStyle
          ]}
        />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: { justifyContent: 'center' },
  track: { width: '100%', overflow: 'hidden' },
  fill: { height: '100%' },
  thumb: {
    position: 'absolute',
    borderWidth: 2,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2
  }
});
