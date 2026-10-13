import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView, Modal, Platform, Pressable, StyleProp, StyleSheet, Text, TextInput,
  TextInputProps, View, ViewStyle,
} from 'react-native';
import { colors, radius, space } from './theme';

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

type BtnKind = 'primary' | 'secondary' | 'danger' | 'ghost';
export function Button({ title, onPress, kind = 'primary', disabled, style, small }: {
  title: string; onPress: () => void; kind?: BtnKind; disabled?: boolean; style?: StyleProp<ViewStyle>; small?: boolean;
}) {
  const bg = { primary: colors.accent, secondary: colors.cardAlt, danger: colors.danger, ghost: 'transparent' }[kind];
  const fg = kind === 'primary' ? '#04110F' : kind === 'danger' ? '#fff' : colors.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn, small && styles.btnSmall, { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.75 : 1 },
        kind === 'secondary' && { borderWidth: 1, borderColor: colors.border }, style,
      ]}
    >
      <Text style={[styles.btnText, small && { fontSize: 14 }, { color: fg }]}>{title}</Text>
    </Pressable>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, selected && styles.chipOn]}>
      <Text style={[styles.chipText, selected && { color: colors.text }]}>{label}</Text>
    </Pressable>
  );
}

export function Segmented<T extends string | number>({ options, value, onChange }: {
  options: Array<{ label: string; value: T }>; value: T; onChange: (v: T) => void;
}) {
  return (
    <View style={styles.seg}>
      {options.map((o) => (
        <Pressable key={String(o.value)} onPress={() => onChange(o.value)} style={[styles.segItem, o.value === value && styles.segOn]}>
          <Text style={[styles.segText, o.value === value && { color: colors.text, fontWeight: '700' }]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export const Field = React.forwardRef<TextInput, TextInputProps>((props, ref) => (
  <TextInput ref={ref} placeholderTextColor={colors.muted} {...props} style={[styles.field, props.style]} />
));
Field.displayName = 'Field';

export function Label({ children }: { children: React.ReactNode }) {
  return <Text style={styles.label}>{children}</Text>;
}

export function Muted({ children, style }: { children: React.ReactNode; style?: any }) {
  return <Text style={[{ color: colors.muted, fontSize: 14 }, style]}>{children}</Text>;
}

/** Number with − / + buttons. */
export function Stepper({ value, onChange, min = 0, max = 999, step = 1, suffix }: {
  value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number; suffix?: string;
}) {
  return (
    <View style={styles.stepper}>
      <Pressable style={styles.stepBtn} onPress={() => onChange(Math.max(min, value - step))}><Text style={styles.stepTxt}>−</Text></Pressable>
      <Text style={styles.stepVal}>{value}{suffix ? ` ${suffix}` : ''}</Text>
      <Pressable style={styles.stepBtn} onPress={() => onChange(Math.min(max, value + step))}><Text style={styles.stepTxt}>+</Text></Pressable>
    </View>
  );
}

/** Android has no Alert.prompt, so this is a small text-entry dialog. */
export function PromptModal({ visible, title, initial = '', confirmLabel = 'Save', onCancel, onSubmit, extra }: {
  visible: boolean; title: string; initial?: string; confirmLabel?: string;
  onCancel: () => void; onSubmit: (text: string) => void; extra?: React.ReactNode;
}) {
  const [text, setText] = useState(initial);
  useEffect(() => { if (visible) setText(initial); }, [visible, initial]);
  return (
    <Sheet visible={visible} onClose={onCancel}>
      <Text style={styles.sheetTitle}>{title}</Text>
      <Field value={text} onChangeText={setText} autoFocus onSubmitEditing={() => text.trim() && onSubmit(text)} returnKeyType="done" />
      {extra}
      <View style={{ flexDirection: 'row', gap: space(2), marginTop: space(4) }}>
        <Button title="Cancel" kind="secondary" onPress={onCancel} style={{ flex: 1 }} />
        <Button title={confirmLabel} onPress={() => text.trim() && onSubmit(text)} disabled={!text.trim()} style={{ flex: 1 }} />
      </View>
    </Sheet>
  );
}

/** Bottom sheet style modal. */
export function Sheet({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: React.ReactNode }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.sheet}>{children}</View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius, borderWidth: 1, borderColor: colors.border, padding: space(4) },
  btn: { paddingVertical: space(3.5), paddingHorizontal: space(4), borderRadius: radius, alignItems: 'center', justifyContent: 'center' },
  btnSmall: { paddingVertical: space(2), paddingHorizontal: space(3) },
  btnText: { fontSize: 16, fontWeight: '700' },
  chip: { paddingVertical: space(2), paddingHorizontal: space(3.5), borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  chipOn: { borderColor: colors.accent, backgroundColor: colors.accentDim },
  chipText: { color: colors.muted, fontSize: 14, fontWeight: '600' },
  seg: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: radius, borderWidth: 1, borderColor: colors.border, padding: 3 },
  segItem: { flex: 1, paddingVertical: space(2.5), alignItems: 'center', borderRadius: radius - 3 },
  segOn: { backgroundColor: colors.accentDim, borderWidth: 1, borderColor: colors.accent },
  segText: { color: colors.muted, fontSize: 14 },
  field: { backgroundColor: colors.cardAlt, color: colors.text, borderRadius: radius, borderWidth: 1, borderColor: colors.border, paddingHorizontal: space(3.5), paddingVertical: space(3), fontSize: 16 },
  label: { color: colors.text, fontSize: 14, fontWeight: '700', marginBottom: space(2), marginTop: space(4) },
  stepper: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.cardAlt, borderRadius: radius, borderWidth: 1, borderColor: colors.border },
  stepBtn: { paddingHorizontal: space(4), paddingVertical: space(2.5) },
  stepTxt: { color: colors.accent, fontSize: 22, fontWeight: '700' },
  stepVal: { color: colors.text, fontSize: 16, fontWeight: '700', minWidth: 64, textAlign: 'center' },
  backdrop: { flex: 1, backgroundColor: '#000a' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: space(5), paddingBottom: space(8), borderWidth: 1, borderColor: colors.border },
  sheetTitle: { color: colors.text, fontSize: 20, fontWeight: '800', marginBottom: space(4) },
});
