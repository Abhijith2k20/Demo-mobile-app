import * as Haptics from 'expo-haptics';
import { enqueue } from '@/lib/outbox';
import type { Checkin, CheckinAnswer } from '@/types/models';

/** Answers a bot check-in through the send queue. The answer carries the check-in id, so repeating it is harmless. */
export function answerCheckin(checkin: Checkin, answer: CheckinAnswer): void {
  if (answer.kind === 'done') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  else void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  enqueue({ kind: 'checkin', checkinId: checkin.id, taskId: checkin.taskId, taskName: checkin.taskName, answer });
}
