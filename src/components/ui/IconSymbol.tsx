import Ionicons from '@expo/vector-icons/Ionicons';
import { SymbolView, type SymbolViewProps, type SymbolWeight } from 'expo-symbols';
import type { ComponentProps } from 'react';
import {
  Platform,
  type ColorValue,
  type StyleProp,
  type TextStyle,
  type ViewStyle
} from 'react-native';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

export const ICON_NAMES = [
  'plus',
  'play.fill',
  'pause.fill',
  'gobackward.15',
  'goforward.15',
  'chevron.right',
  'chevron.left',
  'xmark',
  'checkmark',
  'book',
  'gear',
  'arrow.up.doc',
  'link',
  'speaker.wave.2.fill',
  'text.alignleft',
  'key.fill',
  'tray',
  'doc.text',
  'moon.zzz',
  'list.bullet',
  'forward.fill',
  'arrow.down.circle',
  'square.and.arrow.up',
  'square.and.arrow.down',
  'trash'
] as const;

export type IconName = (typeof ICON_NAMES)[number];

// SF Symbol names match IconName 1:1 for this set.
// `SymbolView`'s `name` prop is typed as a branded `SFSymbol` string from
// `sf-symbols-typescript`; we don't depend on that package, so we cast through.
const IONICONS_MAP: Record<IconName, IoniconName> = {
  plus: 'add',
  'play.fill': 'play',
  'pause.fill': 'pause',
  'gobackward.15': 'play-back',
  'goforward.15': 'play-forward',
  'chevron.right': 'chevron-forward',
  'chevron.left': 'chevron-back',
  xmark: 'close',
  checkmark: 'checkmark',
  book: 'book',
  gear: 'settings',
  'arrow.up.doc': 'cloud-upload',
  link: 'link',
  'speaker.wave.2.fill': 'volume-high',
  'text.alignleft': 'reorder-four',
  'key.fill': 'key',
  tray: 'file-tray',
  'doc.text': 'document-text',
  'moon.zzz': 'moon',
  'list.bullet': 'list',
  'forward.fill': 'play-skip-forward',
  'arrow.down.circle': 'arrow-down-circle',
  'square.and.arrow.up': 'share-outline',
  'square.and.arrow.down': 'download-outline',
  trash: 'trash'
};

export type IconSymbolProps = {
  name: IconName;
  size?: number;
  color?: ColorValue;
  weight?: SymbolWeight;
  style?: StyleProp<ViewStyle>;
};

export function IconSymbol({
  name,
  size = 22,
  color = '#000',
  weight = 'regular',
  style
}: IconSymbolProps) {
  if (Platform.OS === 'ios') {
    return (
      <SymbolView
        name={name as SymbolViewProps['name']}
        size={size}
        tintColor={color}
        weight={weight}
        style={[{ width: size, height: size }, style]}
      />
    );
  }
  return (
    <Ionicons
      name={IONICONS_MAP[name]}
      size={size}
      color={color}
      style={style as StyleProp<TextStyle>}
    />
  );
}
