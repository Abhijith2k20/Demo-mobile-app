// Pick a person to start (or continue) a direct message with.
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Avatar, Row } from '@/components/basics';
import { Sheet, SheetInput } from '@/components/Sheet';
import { space } from '@/theme/spacing';
import { isBotUser, useMe, useUsers } from '../../shared';

export function NewMessageSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const me = useMe();
  const users = useUsers();
  const [query, setQuery] = useState('');
  const people = users.list.filter(
    (u) => u.id !== me.id && u.isActive && !isBotUser(u) && u.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <Sheet visible={visible} onClose={onClose} title={t('home.newMessage', 'New message')} full>
      <SheetInput value={query} onChangeText={setQuery} placeholder={t('home.searchPeople', 'Search people')} />
      <View style={{ marginHorizontal: -space.lg, marginTop: space.sm }}>
        {people.map((u) => (
          <Row
            key={u.id}
            left={<Avatar id={u.id} name={u.name} size={32} />}
            title={u.name}
            height={52}
            onPress={() => {
              onClose();
              router.push(`/dm/${u.id}`);
            }}
          />
        ))}
      </View>
    </Sheet>
  );
}
