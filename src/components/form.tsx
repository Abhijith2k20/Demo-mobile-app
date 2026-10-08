// Form pieces: Field (label + error), Input, DateField (inline calendar), Stepper.
import { Feather } from '@expo/vector-icons';
import { addMonths, eachDayOfInterval, endOfMonth, format, getDay, parseISO, startOfMonth } from 'date-fns';
import { useState, type ReactNode } from 'react';
import { Pressable, TextInput, View, type TextInputProps } from 'react-native';
import { radius, space, touch } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';
import { IconButton } from './basics';
import { T } from './T';

export function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <View style={{ gap: 6, marginBottom: space.lg }}>
      <T variant="label" color="textMuted">
        {label}
      </T>
      {children}
      {error ? (
        <T variant="meta" color="danger" accessibilityRole="alert">
          {error}
        </T>
      ) : null}
    </View>
  );
}

export function Input({ style, ...rest }: TextInputProps) {
  const { c, type } = useTheme();
  return (
    <TextInput
      placeholderTextColor={c.textFaint}
      style={[
        type.body,
        {
          color: c.text,
          backgroundColor: c.surfaceAlt,
          borderRadius: radius.input,
          paddingHorizontal: space.md,
          paddingVertical: space.md,
          minHeight: 46,
        },
        style,
      ]}
      {...rest}
    />
  );
}

const WEEK = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** Date picker without native modules: tap to open a small month calendar in place. */
export function DateField({ value, onChange, min }: { value: string; onChange: (iso: string) => void; min?: string }) {
  const { c } = useTheme();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => startOfMonth(parseISO(value)));
  const days = eachDayOfInterval({ start: month, end: endOfMonth(month) });
  const lead = (getDay(month) + 6) % 7; // Monday first
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={format(parseISO(value), 'EEEE d MMMM yyyy')}
        onPress={() => {
          setMonth(startOfMonth(parseISO(value)));
          setOpen((o) => !o);
        }}
        style={{
          minHeight: 46,
          borderRadius: radius.input,
          backgroundColor: c.surfaceAlt,
          paddingHorizontal: space.md,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
        }}>
        <Feather name="calendar" size={16} color={c.textMuted} />
        <T variant="body" style={{ flex: 1 }}>
          {format(parseISO(value), 'EEE d MMM')}
        </T>
        <Feather name={open ? 'chevron-up' : 'chevron-down'} size={16} color={c.textMuted} />
      </Pressable>
      {open ? (
        <View style={{ marginTop: space.sm, borderWidth: 1, borderColor: c.border, borderRadius: radius.card, padding: space.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <IconButton icon="chevron-left" label="Previous month" onPress={() => setMonth((m) => addMonths(m, -1))} />
            <T variant="bodyStrong" style={{ flex: 1, textAlign: 'center' }}>
              {format(month, 'MMMM yyyy')}
            </T>
            <IconButton icon="chevron-right" label="Next month" onPress={() => setMonth((m) => addMonths(m, 1))} />
          </View>
          <View style={{ flexDirection: 'row' }}>
            {WEEK.map((d, i) => (
              <T key={i} variant="label" color="textFaint" style={{ flex: 1, textAlign: 'center' }}>
                {d}
              </T>
            ))}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {Array.from({ length: lead }).map((_, i) => (
              <View key={`lead-${i}`} style={{ width: `${100 / 7}%`, height: 40 }} />
            ))}
            {days.map((d) => {
              const iso = format(d, 'yyyy-MM-dd');
              const selected = iso === value;
              const disabled = !!min && iso < min;
              return (
                <Pressable
                  key={iso}
                  disabled={disabled}
                  accessibilityLabel={format(d, 'd MMMM')}
                  onPress={() => {
                    onChange(iso);
                    setOpen(false);
                  }}
                  style={{ width: `${100 / 7}%`, height: 40, alignItems: 'center', justifyContent: 'center' }}>
                  <View
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: radius.avatar,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: selected ? c.accent : 'transparent',
                    }}>
                    <T variant="meta" style={{ color: selected ? c.onAccent : disabled ? c.textFaint : c.text }}>
                      {d.getDate()}
                    </T>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}
    </View>
  );
}

export function Stepper({ value, onChange, min = 0, max = 99 }: { value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  const { c } = useTheme();
  const btn = (icon: 'minus' | 'plus', next: number, label: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => onChange(Math.max(min, Math.min(max, next)))}
      style={{
        width: touch.worker,
        height: touch.worker,
        borderRadius: radius.input,
        backgroundColor: c.surfaceAlt,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Feather name={icon} size={20} color={c.text} />
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg }}>
      {btn('minus', value - 1, 'Fewer')}
      <T variant="title" style={{ minWidth: 36, textAlign: 'center' }}>
        {value}
      </T>
      {btn('plus', value + 1, 'More')}
    </View>
  );
}
