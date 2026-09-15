import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { makeSupabase } from './lib/supabase';

type ChatMeta = {
  chatId: string;
  memberIds: string[];
  memberNames: Record<string, string>;
  memberCodes: Record<string, string>;
  name: string;
};

type PresenceEntry = { user_id?: string };
type PresenceState = Record<string, Set<string>>;

const USER_CODE_RE = /^[0-9A-Za-z]{12}$/;
const LAST_SEEN_INTERVAL = 30_000;
const TYPING_TIMEOUT = 1_500;

export default function RealtimeOverlay() {
  const { isAuthenticated, user, getIdTokenClaims } = useAuth0();
  const supabase = useMemo(
    () => (isAuthenticated ? makeSupabase(async () => (await getIdTokenClaims())?.__raw) : null),
    [getIdTokenClaims, isAuthenticated],
  );
  const [chats, setChats] = useState<ChatMeta[]>([]);
  const [presence, setPresence] = useState<PresenceState>({});
  const [typing, setTyping] = useState<Record<string, Set<string>>>({});
  const [lastSeen, setLastSeen] = useState<Record<string, string>>({});
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const channelsRef = useRef<Record<string, any>>({});
  const typingTimers = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!supabase || !user?.sub) return;
    let cancelled = false;

    const refreshChats = async () => {
      const { data } = await supabase
        .from('chat_members')
        .select('chat_id,auth0_sub,display_name,user_code,chats(name)')
        .eq('auth0_sub', user.sub)
        .is('removed_at', null);
      if (cancelled || !data) return;

      const grouped = new Map<string, ChatMeta>();
      for (const row of data as any[]) {
        const chat = Array.isArray(row.chats) ? row.chats[0] : row.chats;
        const current = grouped.get(row.chat_id) ?? {
          chatId: row.chat_id,
          memberIds: [],
          memberNames: {},
          memberCodes: {},
          name: chat?.name ?? '',
        };
        if (!current.memberIds.includes(row.auth0_sub)) current.memberIds.push(row.auth0_sub);
        current.memberNames[row.auth0_sub] = row.display_name;
        current.memberCodes[row.auth0_sub] = row.user_code;
        current.name = chat?.name ?? current.name;
        grouped.set(row.chat_id, current);
      }

      const rows = [...grouped.values()];
      setChats(rows);
      const ids = [...new Set(rows.flatMap((chat) => chat.memberIds).filter((id) => id !== user.sub))];
      if (ids.length) {
        const { data: profiles } = await supabase.from('profiles').select('auth0_sub,last_seen_at').in('auth0_sub', ids);
        if (!cancelled && profiles) {
          setLastSeen(Object.fromEntries(profiles.map((profile: any) => [profile.auth0_sub, profile.last_seen_at])));
        }
      }
    };

    void refreshChats();
    const timer = window.setInterval(() => void refreshChats(), 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [supabase, user?.sub]);

  useEffect(() => {
    if (!supabase || !user?.sub || chats.length === 0) return;
    const channels: Record<string, any> = {};

    for (const chat of chats) {
      const channel = supabase
        .channel(`presence-${chat.chatId}`, {
          config: { presence: { key: user.sub }, broadcast: { ack: false } },
        })
        .on('presence', { event: 'sync' }, () => {
          const rawState: unknown = channel.presenceState();
          const state = rawState as Record<string, PresenceEntry[]>;
          const ids = new Set<string>();
          for (const entries of Object.values(state)) {
            for (const entry of entries) {
              const id = String(entry?.user_id ?? '');
              if (id && id !== user.sub) ids.add(id);
            }
          }
          setPresence((current) => ({ ...current, [chat.chatId]: ids }));
        })
        .on('presence', { event: 'join' }, ({ key }: { key: string }) => {
          if (key === user.sub) return;
          setPresence((current) => {
            const ids = new Set(current[chat.chatId] ?? []);
            ids.add(key);
            return { ...current, [chat.chatId]: ids };
          });
        })
        .on('presence', { event: 'leave' }, ({ key }: { key: string }) => {
          setPresence((current) => {
            const ids = new Set(current[chat.chatId] ?? []);
            ids.delete(key);
            return { ...current, [chat.chatId]: ids };
          });
        })
        .on('broadcast', { event: 'typing' }, ({ payload }: { payload: { user_id?: string; typing?: boolean } }) => {
          const id = String(payload?.user_id ?? '');
          if (!id || id === user.sub) return;
          setTyping((current) => {
            const ids = new Set(current[chat.chatId] ?? []);
            if (payload?.typing) ids.add(id);
            else ids.delete(id);
            return { ...current, [chat.chatId]: ids };
          });
          if (payload?.typing) {
            const timerKey = `${chat.chatId}:${id}`;
            window.clearTimeout(typingTimers.current[timerKey]);
            typingTimers.current[timerKey] = window.setTimeout(() => {
              setTyping((current) => {
                const ids = new Set(current[chat.chatId] ?? []);
                ids.delete(id);
                return { ...current, [chat.chatId]: ids };
              });
            }, TYPING_TIMEOUT);
          }
        })
        .subscribe(async (status: string) => {
          if (status === 'SUBSCRIBED') {
            await channel.track({ user_id: user.sub, at: new Date().toISOString() });
          }
        });
      channels[chat.chatId] = channel;
    }
    channelsRef.current = channels;

    return () => {
      for (const channel of Object.values(channels)) void supabase.removeChannel(channel);
      channelsRef.current = {};
    };
  }, [chats, supabase, user?.sub]);

  useEffect(() => {
    if (!supabase || !user?.sub) return;
    const updateLastSeen = async () => {
      const timestamp = new Date().toISOString();
      await supabase.from('profiles').update({ last_seen_at: timestamp }).eq('auth0_sub', user.sub);
      setLastSeen((current) => ({ ...current, [user.sub!]: timestamp }));
    };
    void updateLastSeen();
    const interval = window.setInterval(() => void updateLastSeen(), LAST_SEEN_INTERVAL);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void updateLastSeen();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onVisibility);
    };
  }, [supabase, user?.sub]);

  useEffect(() => {
    if (!supabase || !user?.sub || chats.length === 0) return;
    const findSelectedChat = () => {
      const head = document.querySelector('.conversation-head');
      if (!head) return null;
      const title = head.querySelector('strong')?.textContent?.trim() ?? '';
      const subtitle = head.querySelector('small')?.textContent?.trim() ?? '';
      if (USER_CODE_RE.test(subtitle)) {
        return chats.find((chat) => chat.memberCodes && Object.values(chat.memberCodes).includes(subtitle))?.chatId ?? null;
      }
      const groupCandidates = chats.filter((chat) => chat.name === title);
      return groupCandidates[0]?.chatId ?? null;
    };
    const emitTyping = (typingNow: boolean) => {
      const chatId = findSelectedChat();
      if (!chatId) return;
      void channelsRef.current[chatId]?.send({ type: 'broadcast', event: 'typing', payload: { user_id: user.sub, typing: typingNow } });
    };
    const onInput = (event: Event) => {
      const target = event.target as HTMLInputElement | null;
      if (!target || !target.closest('.composer') || target.type === 'file') return;
      emitTyping(Boolean(target.value));
      if (target.value) {
        window.setTimeout(() => emitTyping(false), TYPING_TIMEOUT);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('.composer') && (event.key === 'Enter' || event.key === 'Escape')) emitTyping(false);
    };
    document.addEventListener('input', onInput);
    document.addEventListener('keydown', onKey);
    const observer = new MutationObserver(() => setSelectedChatId(findSelectedChat()));
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = window.setInterval(() => setSelectedChatId(findSelectedChat()), 500);
    setSelectedChatId(findSelectedChat());
    return () => {
      document.removeEventListener('input', onInput);
      document.removeEventListener('keydown', onKey);
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, [chats, supabase, user?.sub]);

  if (!isAuthenticated || !selectedChatId) return null;
  const chat = chats.find((item) => item.chatId === selectedChatId);
  if (!chat) return null;

  const onlineIds = presence[selectedChatId] ?? new Set<string>();
  const typingIds = typing[selectedChatId] ?? new Set<string>();
  const otherIds = chat.memberIds.filter((id) => id !== user?.sub);
  const onlineNames = otherIds.filter((id) => onlineIds.has(id)).map((id) => chat.memberNames[id] ?? 'Someone');
  const typingNames = otherIds.filter((id) => typingIds.has(id)).map((id) => chat.memberNames[id] ?? 'Someone');
  const singleOther = otherIds.length === 1 ? otherIds[0] : null;

  let status = '';
  if (typingNames.length) {
    status = typingNames.length === 1 ? `${typingNames[0]} is typing…` : `${typingNames.length} people are typing…`;
  } else if (onlineNames.length) {
    status = onlineNames.length === 1 ? `${onlineNames[0]} is online` : `${onlineNames.length} members online`;
  } else if (singleOther && lastSeen[singleOther]) {
    status = `Last seen ${formatLastSeen(lastSeen[singleOther])}`;
  } else if (otherIds.length > 1) {
    status = 'No other members online';
  }

  return status ? <div className="realtime-status" aria-live="polite"><span className={typingNames.length ? 'realtime-dot typing' : onlineNames.length ? 'realtime-dot online' : 'realtime-dot'} />{status}</div> : null;
}

function formatLastSeen(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'recently';
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
