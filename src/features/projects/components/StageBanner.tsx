import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { T } from '@/components/T';
import { projectDelayDays } from '@/shared/taskRules';
import { stageColors } from '@/theme/colors';
import { space } from '@/theme/spacing';
import { useTheme } from '@/theme/useTheme';
import { STAGES, type Project } from '@/types/models';
import { useStageLabel } from '../../shared';

export function useDelayText(): (project: Project) => { text: string; tone: 'danger' | 'success' | 'textMuted' } {
  const { t } = useTranslation();
  return (project) => {
    const d = projectDelayDays(project);
    if (!project.baselineLocked) return { text: t('project.noBaseline', 'No baseline yet'), tone: 'textMuted' };
    if (d > 0) return { text: d === 1 ? t('project.behindOne', '1 day behind baseline') : t('project.behind', '{{count}} days behind baseline', { count: d }), tone: 'danger' };
    if (d < 0) return { text: d === -1 ? t('project.aheadOne', '1 day ahead of baseline') : t('project.ahead', '{{count}} days ahead of baseline', { count: -d }), tone: 'success' };
    return { text: t('project.onTrack', 'On track'), tone: 'success' };
  };
}

/** Thin bar at the top of every project channel: six stage segments, current one filled. */
export function StageBanner({ project }: { project: Project }) {
  const { c } = useTheme();
  const stageLabel = useStageLabel();
  const delay = useDelayText()(project);
  const current = STAGES.indexOf(project.stage);
  const tone = stageColors(c, project.stage);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${stageLabel(project.stage)}. ${delay.text}`}
      onPress={() => router.push(`/project/${project.id}`)}
      style={{ backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.border, paddingHorizontal: space.lg, paddingVertical: space.sm, gap: 6 }}>
      <View style={{ flexDirection: 'row', gap: 3 }}>
        {STAGES.map((s, i) => (
          <View key={s} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i < current ? c.textFaint : i === current ? tone.fg : c.surfaceAlt }} />
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
