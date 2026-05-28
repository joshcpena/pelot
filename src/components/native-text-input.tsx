import {
  Host,
  TextInput as ExpoTextInput,
  useNativeState,
  type TextInputProps as ExpoTextInputProps,
  type TextInputRef,
} from '@expo/ui';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import {
  StyleSheet,
  type ColorSchemeName,
  type StyleProp,
  type TextStyle,
  type ViewProps,
  type ViewStyle,
} from 'react-native';

type ExpoTextStyle = NonNullable<ExpoTextInputProps['textStyle']>;
type ExpoInputStyle = NonNullable<ExpoTextInputProps['style']>;
type NativeTextInputStyle = TextStyle & ViewStyle;

type NativeTextInputProps = Omit<
  ExpoTextInputProps,
  | 'onBlur'
  | 'onFocus'
  | 'onSubmitEditing'
  | 'ref'
  | 'style'
  | 'textStyle'
  | 'value'
> & {
  accessibilityHint?: ViewProps['accessibilityHint'];
  accessibilityLabel?: ViewProps['accessibilityLabel'];
  colorScheme?: ColorSchemeName;
  hostStyle?: StyleProp<ViewStyle>;
  matchContents?: boolean | { vertical?: boolean; horizontal?: boolean };
  onBlur?: () => void;
  onEndEditingText?: (text: string) => void;
  onFocus?: () => void;
  onSubmitEditing?: (text: string) => void;
  style?: StyleProp<NativeTextInputStyle>;
  textStyle?: ExpoTextStyle;
  value?: string;
};

function compactStyle<T extends object>(style: T): Partial<T> {
  const result: Partial<T> = {};

  for (const key of Object.keys(style) as (keyof T)[]) {
    if (style[key] !== undefined) {
      result[key] = style[key];
    }
  }

  return result;
}

function splitStyle(style: StyleProp<NativeTextInputStyle>) {
  const flattened = StyleSheet.flatten(style);

  if (!flattened) {
    return {};
  }

  const {
    backgroundColor,
    borderBottomColor,
    borderBottomWidth,
    borderColor,
    borderRadius,
    borderWidth,
    color,
    fontFamily,
    fontSize,
    fontWeight,
    height,
    letterSpacing,
    lineHeight,
    opacity,
    padding,
    paddingBottom,
    paddingHorizontal,
    paddingLeft,
    paddingRight,
    paddingTop,
    paddingVertical,
    textAlign,
    width,
  } = flattened;

  return {
    hostStyle: compactStyle<ViewStyle>({
      borderBottomColor: borderBottomColor ?? borderColor,
      borderBottomWidth,
    }),
    inputStyle: compactStyle<ExpoInputStyle>({
      backgroundColor,
      borderColor,
      borderRadius,
      borderWidth,
      height,
      opacity,
      padding,
      paddingBottom,
      paddingHorizontal,
      paddingLeft,
      paddingRight,
      paddingTop,
      paddingVertical,
      width,
    }),
    textAlign,
    textStyle: compactStyle<ExpoTextStyle>({
      color: typeof color === 'string' ? color : undefined,
      fontFamily,
      fontSize,
      fontWeight: fontWeight?.toString() as ExpoTextStyle['fontWeight'],
      letterSpacing,
      lineHeight,
      textAlign:
        textAlign === 'left' || textAlign === 'right' || textAlign === 'center'
          ? textAlign
          : undefined,
    }),
  };
}

export const NativeTextInput = forwardRef<TextInputRef, NativeTextInputProps>(
  function NativeTextInput(
    {
      accessibilityHint,
      accessibilityLabel,
      colorScheme,
      defaultValue,
      hostStyle,
      matchContents,
      onBlur,
      onChangeText,
      onEndEditingText,
      onFocus,
      onSubmitEditing,
      style,
      textAlign,
      textStyle,
      value,
      ...props
    },
    ref,
  ) {
    const nativeValue = useNativeState(value ?? defaultValue ?? '');
    const inputRef = useRef<TextInputRef>(null);
    const latestTextRef = useRef(value ?? defaultValue ?? '');
    const [changeVersion, setChangeVersion] = useState(0);
    const split = splitStyle(style);
    const resolvedTextAlign = textAlign ?? split.textAlign;

    useEffect(() => {
      if (value === undefined) {
        return;
      }

      if (latestTextRef.current !== value) {
        latestTextRef.current = value;
        nativeValue.value = value;
      }
    }, [changeVersion, nativeValue, value]);

    useImperativeHandle(
      ref,
      () => ({
        blur: () => {
          inputRef.current?.blur();
        },
        clear: () => {
          latestTextRef.current = '';
          nativeValue.value = '';
          inputRef.current?.clear();
        },
        focus: () => {
          inputRef.current?.focus();
        },
        isFocused: () => inputRef.current?.isFocused() ?? false,
        setSelection: (start, end) =>
          inputRef.current?.setSelection(start, end) ?? Promise.resolve(),
      }),
      [nativeValue],
    );

    return (
      <Host
        accessibilityHint={accessibilityHint}
        accessibilityLabel={accessibilityLabel}
        colorScheme={colorScheme}
        matchContents={matchContents}
        style={[split.hostStyle, hostStyle]}
      >
        <ExpoTextInput
          {...props}
          ref={inputRef}
          defaultValue={defaultValue}
          style={split.inputStyle}
          textAlign={resolvedTextAlign}
          textStyle={{ ...split.textStyle, ...textStyle }}
          value={nativeValue}
          onBlur={() => {
            onBlur?.();
            onEndEditingText?.(latestTextRef.current);
          }}
          onChangeText={(nextValue) => {
            latestTextRef.current = nextValue;
            onChangeText?.(nextValue);

            if (value !== undefined) {
              setChangeVersion((current) => current + 1);
            }
          }}
          onFocus={onFocus}
          onSubmitEditing={onSubmitEditing}
        />
      </Host>
    );
  },
);

export type { NativeTextInputProps, TextInputRef as NativeTextInputRef };
