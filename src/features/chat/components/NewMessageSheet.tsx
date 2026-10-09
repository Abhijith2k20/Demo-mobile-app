// Pick a person to start (or continue) a direct message with.
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Avatar, Row } from '@/components/basics';
import { Sheet, SheetInput } from '@/components/Sheet';
import { T } from '@/components/T';
import { space } from '@/theme/spacing';
import { useDirectory } from '../../home/hooks';
import { useMe, useUsers } from '../../shared';
import { openDm } from '../api';

export function NewMessageSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const me = useMe();
  const local = useUsers();
  const directory = useDirectory();
  const [query, setQuery] = useState('');
  // Show what we have on the phone first; the directory fills in when the server answers.
  const people = (directory.data ?? local.list).filter(
    (u) => u.id !== me.id && u.phone !== '0000000000' && u.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <Sheet visible={visible} onClose={onClose} title={t('home.newMessage', 'New message')} full>
      <SheetInput value={query} onChangeText={setQuery} placeholder={t('home.searchPeople', 'Search people')} />
      {directory.isError ? (
        <T variant="meta" color="warning" style={{ marginTop: space.sm }}>
          {t('common.couldntRefresh', "Couldn't refresh")}
        </T>
      ) : null}
      <View style={{ marginHorizontal: -space.lg, marginTop: space.sm }}>
        {people.map((u) => (
          <Row
            key={u.id}
            left={<Avatar id={u.id} name={u.name} size={32} />}
            title={u.name}
            height={52}
            onPress={() => {
              onClose();
              openDm(u.id);
              router.push(`/dm/${u.id}`);
            }}
          />
        ))}
      </View>
    </Sheet>
  );
}
