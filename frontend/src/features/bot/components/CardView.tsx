// A card from the PM app, drawn from its content (docs/CARDS_API.md). Design rules (see DECISIONS.md):
//  - one question open at a time; the rest stay as one-line rows
//  - the scale answers in a single tap; buttons are quiet secondary actions
//  - neutral surfaces: colour is used only for small state marks, never for whole buttons
//  - every state shares the same frame and the same left edge, so cards line up
import { Feather } from '@expo/vector-icons';
import { format, parseISO } from 'date-fns';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { Button, type IconName } from '@/components/basics';
import { T } from '@/components/T';
import { radius, space, touch } from '@/theme/spacing';
import { useLargeText, useTheme } from '@/theme/useTheme';
import type { CardAnswer, CardButton, CardContent, ID, Message, Tone } from '@/types/models';
import { pickPhotos } from '../../shared';
import { answerCard, markSeen } from '../api';
import { asks, useCard } from '../hooks';
import { useCardQueue } from '../queue';
import { NoteField, VoiceChip, type NoteValue } from './NoteField';

/** Two buttons per row. */
const pairs = <X,>(list: X[]): X[][] => list.reduce<X[][]>((rows, x, i) => (i % 2 ? rows[rows.length - 1].push(x) : rows.push([x]), rows), []);

function useTone(): (tone: Tone | undefined) => string {
  const { c } = useTheme();
  return (tone) => ({ info: c.info, success: c.success, warning: c.warning, danger: c.danger })[tone ?? 'info'];
}

/** What the person answered, in the card's own words. */
export function answerLabel(content: CardContent, a: CardAnswer): string {
  if (a.scale) return content.scale?.find((s) => s.id === a.scale)?.label ?? a.scale;
  const b = content.buttons?.find((x) => x.id === a.button);
  const choice = b?.choices?.find((x) => x.id === a.choice);
  return [b?.label ?? a.button, choice?.label].filter(Boolean).join(' · ');
}

/** A neutral, outlined secondary action. */
function Quiet({ icon, label, onPress, active }: { icon?: IconName; label: string; onPress: () => void; active?: boolean }) {
  const { c } = useTheme();
  const large = useLargeText();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!active }}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: large ? undefined : 1,
        minHeight: touch.min,
        borderRadius: radius.input,
        borderWidth: 1,
        borderColor: active ? c.textMuted : c.border,
        backgroundColor: pressed || active ? c.surfaceAlt : c.surface,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingHorizontal: space.sm,
      })}>
      {icon ? <Feather name={icon} size={14} color={c.textMuted} /> : null}
      <T variant="metaStrong" numberOfLines={2} style={{ flexShrink: 1, textAlign: 'center' }}>
        {label}
      </T>
    </Pressable>
  );
}

/** One-tap scale. Stops up to `reached` are shaded and underlined. */
function Scale({ stops, reached, onPick }: { stops: NonNullable<CardContent['scale']>; reached?: string; onPick: (id: string) => void }) {
  const { c } = useTheme();
  const upTo = reached ? stops.findIndex((s) => s.id === reached) : -1;
  return (
    <View style={{ flexDirection: 'row', minHeight: 46, borderRadius: radius.input, borderWidth: 1, borderColor: c.border, overflow: 'hidden' }}>
      {stops.map((s, i) => {
        const done = i <= upTo;
        return (
          <Pressable
            key={s.id}
            accessibilityRole="button"
            accessibilityLabel={s.label}
            onPress={() => onPick(s.id)}
            style={({ pressed }) => ({
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 2,
              borderLeftWidth: i ? 1 : 0,
              borderLeftColor: c.border,
              backgroundColor: pressed ? c.border : done ? c.surfaceAlt : c.surface,
            })}>
            <T variant="metaStrong" color={done ? 'textMuted' : 'text'} numberOfLines={1} maxFontSizeMultiplier={1.6}>
              {s.label}
            </T>
            {done ? <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, backgroundColor: c.accent }} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** Frame shared by every state of the card. */
function Shell({ children, open, onPress }: { children: ReactNode; open?: boolean; onPress?: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => ({
        backgroundColor: pressed ? c.surfaceAlt : c.surface,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: open ? c.textFaint : c.border,
        padding: space.md,
      })}>
      {children}
    </Pressable>
  );
}

/** Small coloured dot + words: the only place state colour appears. */
function State({ color, text }: { color: string; text: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color }} />
      <T variant="metaStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
        {text}
      </T>
    </View>
  );
}

function Fields({ fields }: { fields: NonNullable<CardContent['fields']> }) {
  const { c } = useTheme();
  return (
    <View style={{ marginTop: space.sm }}>
      {fields.map((f, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: space.md, minHeight: 36, alignItems: 'center', borderTopWidth: 1, borderTopColor: c.border }}>
          <T variant="meta" style={{ flex: 1, fontSize: 14, color: c.text }} numberOfLines={2}>
            {f.label}
          </T>
          <T variant="metaStrong" color="textMuted">
            {f.value}
          </T>
        </View>
      ))}
    </View>
  );
}

export function CardView({ message }: { message: Message }) {
  const { c } = useTheme();
  const { t } = useTranslation();
  const toneColor = useTone();
  // At large text sizes: wrap instead of truncating, and stack the option buttons.
  const large = useLargeText();
  const lines = large ? 3 : 1;
  const optionRow = { flexDirection: large ? ('column' as const) : ('row' as const), gap: space.sm };
  const cardId = message.data?.cardId as ID | undefined;
  const card = useCard(cardId);
  const queue = useCardQueue();
  const [picked, setPicked] = useState<CardButton | null>(null);
  const [waiting, setWaiting] = useState<CardAnswer | null>(null); // an answer that needs a note first
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState<NoteValue>({ text: '', voice: null });
  const [photoUris, setPhotoUris] = useState<string[]>([]);

  const title = card?.content.title ?? t('card.loading', 'Loading…');
  // Seen = shown open (the active card in the queue, or any card shown outside the bot conversation).
  const shownOpen = !!card && card.state === 'open' && !message.data?.nudge && (!queue || queue.activeId === card.id);
  useEffect(() => {
    if (shownOpen && card) markSeen(card);
  }, [shownOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // A nudge repeats a question that already has its own card: keep it to one quiet line.
  if (message.data?.nudge) {
    if (!card || card.state !== 'open') return null;
    return (
      <Pressable accessibilityRole="button" onPress={() => cardId && queue?.open(cardId)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2, paddingHorizontal: space.md }}>
        <Feather name="bell" size={13} color={c.textMuted} />
        <T variant="meta" color="textMuted" numberOfLines={lines} style={{ flex: 1 }}>
          {t('card.reminderLine', 'Reminder: {{title}} still needs an answer', { title })}
        </T>
      </Pressable>
    );
  }

  if (!card) {
    return (
      <Shell>
        <T variant="meta" color="textMuted">
          {title}
        </T>
      </Shell>
    );
  }

  const content = card.content;
  const where = content.subtitle ?? '';

  /** Title, context line and badge, identical in every state so the text always starts on the same edge. */
  const heading = (strong: boolean, right?: ReactNode) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
      <View style={{ flex: 1 }}>
        <T variant={strong ? 'bodyStrong' : 'metaStrong'} numberOfLines={strong ? lines + 1 : lines} style={strong ? undefined : { fontSize: 14 }}>
          {content.title}
        </T>
        {where ? (
          <T variant="meta" color="textMuted" numberOfLines={lines}>
            {where}
          </T>
        ) : null}
      </View>
      {content.badge && card.state === 'open' ? <State color={toneColor(content.badge.tone)} text={content.badge.text} /> : null}
      {right}
    </View>
  );

  // ---- Information only (a morning summary, for example) ----
  if (!asks(card)) {
    return (
      <Shell>
        {heading(true)}
        {content.fields?.length ? <Fields fields={content.fields} /> : null}
      </Shell>
    );
  }

  // ---- Answered ----
  if (card.state === 'answered' && card.answer) {
    const a = card.answer;
    return (
      <Shell>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <T variant="meta" color="textMuted" numberOfLines={lines} style={{ flex: 1, fontSize: 14 }}>
            {content.title}
          </T>
          <State color={c.accent} text={answerLabel(content, a)} />
          {a.photoUploadIds?.length ? <Feather name="camera" size={13} color={c.textFaint} /> : null}
          {card.sending ? (
            <Feather name="clock" size={13} color={c.textFaint} accessibilityLabel={t('chat.sending', 'Sending…')} />
          ) : card.answeredAt ? (
            <T variant="meta" color="textFaint">
              {format(parseISO(card.answeredAt), 'h:mm a')}
            </T>
          ) : null}
        </View>
        {a.note ? (
          <T variant="meta" color="textMuted" style={{ marginTop: 4 }}>
            “{a.note}”
          </T>
        ) : null}
        {a.voiceSec ? (
          <View style={{ marginTop: 6 }}>
            <VoiceChip seconds={a.voiceSec} />
          </View>
        ) : null}
        {card.delivery === 'pending' && !card.sending ? (
          <T variant="meta" color="textFaint" style={{ marginTop: 4 }}>
            {t('card.delivering', 'Sending to the PM app…')}
          </T>
        ) : null}
        {card.delivery === 'refused' || card.delivery === 'failed' ? (
          <T variant="meta" color="danger" style={{ marginTop: 4 }}>
            {t('card.notSaved', 'Not saved: {{reason}}', { reason: card.deliveryError ?? '' })}
          </T>
        ) : null}
      </Shell>
    );
  }

  // ---- Closed by the PM app, or expired: nothing to answer ----
  if (card.state !== 'open') {
    const why = card.state === 'expired'
        ? t('card.expired', 'Expired')
        : (card.closedText ?? t('card.closed', 'Closed'));
    return (
      <Shell>
        {heading(
          false,
          <T variant="meta" color="textFaint">
            {why}
          </T>,
        )}
      </Shell>
    );
  }

  // ---- Waiting, but another card is open: one row, tap to open ----
  const active = !queue || queue.activeId === card.id;
  if (!active) {
    return (
      <Shell onPress={() => queue?.open(card.id)}>
        {heading(
          false,
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
            <T variant="metaStrong" color="accent">
              {t('card.update', 'Update')}
            </T>
            <Feather name="chevron-down" size={16} color={c.accent} />
          </View>,
        )}
      </Shell>
    );
  }

  // ---- The open card ----
  const rules = content.note ?? {};
  const canNote = !!(rules.text || rules.voice || rules.photo);
  const send = (answer: CardAnswer) =>
    answerCard(card, { ...answer, note: note.text.trim() || undefined }, { photoUris, voice: note.voice });
  const answerWith = (answer: CardAnswer, noteRequired?: boolean) => {
    if (noteRequired && !note.text.trim()) {
      setWaiting(answer);
      setNoteOpen(true);
      return;
    }
    send(answer);
  };
  const position = queue && queue.pending.length > 1 ? `${queue.pending.indexOf(card.id) + 1} of ${queue.pending.length}` : null;
  const showNote = noteOpen || !!waiting;

  return (
    <Shell open>
      {heading(
        true,
        position ? (
          <T variant="meta" color="textFaint" style={{ alignSelf: 'flex-start' }}>
            {position}
          </T>
        ) : undefined,
      )}
      {content.fields?.length ? <Fields fields={content.fields} /> : null}

      {!picked ? (
        <View style={{ marginTop: space.md, gap: space.sm }}>
          {content.scale?.length ? <Scale stops={content.scale} reached={content.scaleReached} onPick={(id) => answerWith({ scale: id })} /> : null}
          <View style={optionRow}>
            {(content.buttons ?? []).map((b) => (
              <Quiet key={b.id} label={b.label} onPress={() => (b.choices?.length ? setPicked(b) : answerWith({ button: b.id }, b.noteRequired))} />
            ))}
            {canNote ? <Quiet icon="edit-3" label={t('card.note', 'Note')} active={noteOpen} onPress={() => setNoteOpen((v) => !v)} /> : null}
          </View>
        </View>
      ) : (
        <View style={{ marginTop: space.md, gap: space.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
            <Pressable accessibilityRole="button" accessibilityLabel={t('common.back', 'Back')} hitSlop={10} onPress={() => (setPicked(null), setWaiting(null))} style={{ marginLeft: -5 }}>
              <Feather name="chevron-left" size={18} color={c.textMuted} />
            </Pressable>
            <T variant="meta" color="textMuted" style={{ flex: 1 }}>
              {picked.label}
            </T>
          </View>
          {pairs(picked.choices ?? []).map((pair, i) => (
            <View key={i} style={optionRow}>
              {pair.map((ch) => (
                <Quiet
                  key={ch.id}
                  label={ch.label}
                  active={waiting?.choice === ch.id}
                  onPress={() => answerWith({ button: picked.id, choice: ch.id }, ch.noteRequired || picked.noteRequired)}
                />
              ))}
            </View>
          ))}
        </View>
      )}

      {showNote ? (
        <View style={{ marginTop: space.md, gap: space.sm }}>
          <NoteField value={note} onChange={setNote} voice={!!rules.voice} />
          {rules.photo ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: photoUris.length > 0 }}
              hitSlop={6}
              onPress={async () => {
                if (photoUris.length) return setPhotoUris([]);
                setPhotoUris(await pickPhotos('camera', 1));
              }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' }}>
              <Feather name={photoUris.length ? 'check' : 'camera'} size={14} color={c.textMuted} />
              <T variant="meta" color="textMuted">
                {photoUris.length ? t('card.photoAdded', 'Photo added · tap to remove') : t('card.addPhoto', 'Add a photo')}
              </T>
            </Pressable>
          ) : null}
          {waiting ? (
            <Button small label={t('card.send', 'Send')} disabled={!note.text.trim()} onPress={() => send(waiting)} />
          ) : (
            <T variant="meta" color="textFaint">
              {t('card.noteHint', 'Your note is sent with the answer you tap above.')}
            </T>
          )}
        </View>
      ) : null}
    </Shell>
  );
}
