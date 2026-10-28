import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { T } from '@/components/T';
import { stageColors } from '@/theme/colors';
import { space } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';
import type { ProjectView } from '@/types/models';
import { useStages } from '../../shared';

export function useDelayText(): (project: ProjectView) => { text: string; tone: 'danger' | 'success' | 'textMuted' } {
  const { t } = useTranslation();
  return (project) => {
    const d = project.delayDays; // worked out by the server
    if (!project.baselineLocked) return { text: t('project.noBaseline', 'No baseline yet'), tone: 'textMuted' };
    if (d > 0) return { text: d === 1 ? t('project.behindOne', '1 day behind baseline') : t('project.behind', '{{count}} days behind baseline', { count: d }), tone: 'danger' };
    if (d < 0) return { text: d === -1 ? t('project.aheadOne', '1 day ahead of baseline') : t('project.ahead', '{{count}} days ahead of baseline', { count: -d }), tone: 'success' };
    return { text: t('project.onTrack', 'On track'), tone: 'success' };
  };
}

/** Thin bar at the top of every project channel: one segment per stage, current one filled. */
export function StageBanner({ project }: { project: ProjectView }) {
  const { c } = useTheme();
  const stages = useStages();
  const stageLabel = stages.label;
  const delay = useDelayText()(project);
  const current = stages.index(project.stage);
  const tone = stageColors(c, current);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${stageLabel(project.stage)}. ${delay.text}`}
      onPress={() => router.push(`/project/${project.id}`)}
      style={{ backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.border, paddingHorizontal: space.lg, paddingVertical: space.sm, gap: 6 }}>
      <View style={{ flexDirection: 'row', gap: 3 }}>
        {stages.list.map((s, i) => (
          <View key={s.key} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i < current ? c.textFaint : i === current ? tone.fg : c.surfaceAlt }} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <T variant="metaStrong" style={{ color: tone.fg }}>
          {stageLabel(project.stage)}
        </T>
        <T variant="meta" color={delay.tone}>
          · {delay.text}
        </T>
      </View>
    </Pressable>
  );
}
