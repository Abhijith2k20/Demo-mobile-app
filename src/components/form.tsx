// Form pieces: Field (label + error), Input, DateField (calendar sheet), Stepper.
import { Feather } from '@expo/vector-icons';
import { addDays, addMonths, eachDayOfInterval, format, isSameMonth, parseISO, startOfMonth, startOfWeek } from 'date-fns';
import { useState, type ReactNode } from 'react';
import { Pressable, TextInput, View, type TextInputProps } from 'react-native';
import { radius, space, touch } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';
import { Chip, IconButton } from './basics';
import { Sheet } from './Sheet';
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

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const toIso = (d: Date) => format(d, 'yyyy-MM-dd');

/**
 * Date picker without native modules. The field shows the date; tapping it opens a month
 * calendar in a sheet, with shortcuts for the dates people pick most.
 */
export function DateField({ value, onChange, min, title = 'Pick a date' }: { value: string; onChange: (iso: string) => void; min?: string; title?: string }) {
  const { c } = useTheme();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => startOfMonth(parseISO(value)));
  const today = toIso(new Date());
  // Always six full weeks, so the sheet never changes height between months.
  const first = startOfWeek(month, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: first, end: addDays(first, 41) });
  const pick = (iso: string) => {
    onChange(iso);
    setOpen(false);
  };
  const shortcuts = [
    { label: 'Today', iso: today },
    { label: 'Tomorrow', iso: toIso(addDays(new Date(), 1)) },
    { label: 'In a week', iso: toIso(addDays(new Date(), 7)) },
  ].filter((x) => !min || x.iso >= min);
  const canGoBack = !min || toIso(month) > min;

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={format(parseISO(value), 'EEEE d MMMM yyyy')}
        onPress={() => {
          setMonth(startOfMonth(parseISO(value)));
          setOpen(true);
        }}
        style={({ pressed }) => ({
          minHeight: 46,
          borderRadius: radius.input,
          backgroundColor: c.surfaceAlt,
          paddingHorizontal: space.md,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
          opacity: pressed ? 0.7 : 1,
        })}>
        <Feather name="calendar" size={16} color={c.textMuted} />
        <T variant="body" style={{ flex: 1 }} numberOfLines={1}>
          {format(parseISO(value), 'EEE, d MMM yyyy')}
        </T>
      </Pressable>

      <Sheet visible={open} onClose={() => setOpen(false)} title={title} subtitle={format(parseISO(value), 'EEEE, d MMMM yyyy')}>
        {shortcuts.length > 0 ? (
          <View style={{ flexDirection: 'row', gap: space.sm, marginBottom: space.lg }}>
            {shortcuts.map((x) => (
              <Chip key={x.label} label={x.label} selected={x.iso === value} onPress={() => pick(x.iso)} />
            ))}
          </View>
        ) : null}

        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: space.sm }}>
          <T variant="heading" style={{ flex: 1 }}>
            {format(month, 'MMMM yyyy')}
          </T>
          <View style={{ opacity: canGoBack ? 1 : 0.3 }}>
            <IconButton icon="chevron-left" label="Previous month" onPress={() => canGoBack && setMonth((m) => addMonths(m, -1))} bg={c.surfaceAlt} />
          </View>
          <View style={{ width: space.sm }} />
          <IconButton icon="chevron-right" label="Next month" onPress={() => setMonth((m) => addMonths(m, 1))} bg={c.surfaceAlt} />
        </View>

        <View style={{ flexDirection: 'row', marginBottom: space.xs }}>
          {WEEK.map((d) => (
            <T key={d} variant="label" color="textFaint" style={{ flex: 1, textAlign: 'center', letterSpacing: 0.3 }} maxFontSizeMultiplier={1.1}>
              {d}
            </T>
          ))}
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {days.map((d) => {
            const iso = toIso(d);
            const selected = iso === value;
            const isToday = iso === today;
            const disabled = !!min && iso < min;
            const outside = !isSameMonth(d, month);
            return (
              <Pressable
                key={iso}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityLabel={format(d, 'EEEE d MMMM')}
                accessibilityState={{ selected, disabled }}
                onPress={() => pick(iso)}
                style={{ width: `${100 / 7}%`, height: 46, alignItems: 'center', justifyContent: 'center' }}>
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: selected ? c.accent : 'transparent',
                    borderWidth: isToday && !selected ? 1.5 : 0,
                    borderColor: c.accent,
                  }}>
                  <T
                    variant={selected || isToday ? 'bodyStrong' : 'body'}
                    style={{ color: selected ? c.onAccent : disabled ? c.border : outside ? c.textFaint : isToday ? c.accent : c.text, fontSize: 15, lineHeight: 20 }}
                    maxFontSizeMultiplier={1.1}>
                    {d.getDate()}
                  </T>
                </View>
              </Pressable>
            );
          })}
        </View>
        {min ? (
          <T variant="meta" color="textFaint" style={{ marginTop: space.sm }}>
            Earliest: {format(parseISO(min), 'd MMM yyyy')}
          </T>
        ) : null}
      </Sheet>
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
