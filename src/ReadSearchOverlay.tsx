import { useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useAuth0 } from '@auth0/auth0-react';
import { makeSupabase } from './lib/supabase';
import { decryptText, importKey } from './lib/crypto';
import { getOrCreateIdentity, unwrapChatKey } from './lib/crypto-keys';

type SearchResult = {
  messageId: string;
  chatId: string;
  chatName: string;
  senderId: string;
  createdAt: string;
  text: string;
};

type ChatMember = {
  chat_id: string;
  encrypted_key: string;
  key_sender_public: JsonWebKey;
  chats?: { id: string; name?: string | null } | { id: string; name?: string | null }[] | null;
};

type MessageRow = {
  id: string;
  sender_id: string;
  ciphertext: string | null;
  message_type: 'text' | 'file';
  created_at: string;
  deleted_at?: string | null;
};

export default function ReadSearchOverlay() {
  const { isAuthenticated, user, getIdTokenClaims } = useAuth0();
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const supabase = useMemo(
    () => isAuthenticated ? makeSupabase(async () => (await getIdTokenClaims())?.__raw) : null,
    [getIdTokenClaims, isAuthenticated],
  );

  useEffect(() => {
    if (!isAuthenticated) return;
    const timer = window.setInterval(() => setReady(Boolean(document.querySelector('.app-shell'))), 250);
    setReady(Boolean(document.querySelector('.app-shell')));
    return () => window.clearInterval(timer);
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
      }
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isAuthenticated]);

  useEffect(() => {
    if (!supabase || !user?.sub || !ready) return;
    let cancelled = false;
    const syncReadState = async () => {
      const nodes = Array.from(document.querySelectorAll<HTMLElement>('.message-wrap[id^="message-"]'));
      const ids = nodes.map((node) => node.id.slice('message-'.length)).filter(Boolean);
      const incoming = nodes.filter((node) => !node.classList.contains('mine') && !node.classList.contains('read-marked'));
      for (const id of incoming.map((node) => node.id.slice('message-'.length)).filter(Boolean)) {
        await supabase.rpc('touch_message_read_receipt', { target_message_id: id });
        document.getElementById(`message-${id}`)?.classList.add('read-marked');
      }
      if (!ids.length) return;
      const { data } = await supabase
        .from('message_receipts')
        .select('message_id,user_id')
        .in('message_id', ids);
      if (!cancelled) {
        setReadIds(new Set((data ?? []).filter((row: { message_id: string; user_id: string }) => row.user_id !== user.sub).map((row: { message_id: string }) => row.message_id)));
      }
    };
    void syncReadState();
    const timer = window.setInterval(() => void syncReadState(), 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [supabase, user?.sub, ready]);

  useEffect(() => {
    const nodes = document.querySelectorAll<HTMLElement>('.message-wrap.mine');
    nodes.forEach((node) => {
      const id = node.id.slice('message-'.length);
      node.classList.toggle('read-by-other', readIds.has(id));
    });
  }, [readIds, ready]);

  async function searchMessages() {
    const term = query.trim().toLocaleLowerCase();
    if (!term || !supabase || !user?.sub) return;
    setBusy(true);
    setNotice('');
    setResults([]);
    try {
      const { data: memberships, error } = await supabase
        .from('chat_members')
        .select('chat_id,encrypted_key,key_sender_public,chats(id,name)')
        .eq('auth0_sub', user.sub)
        .is('removed_at', null);
      if (error) throw error;
      const identity = await getOrCreateIdentity();
      const found: SearchResult[] = [];
      for (const row of (memberships ?? []) as unknown as ChatMember[]) {
        if (found.length >= 100) break;
        const chat = Array.isArray(row.chats) ? row.chats[0] : row.chats;
        if (!row.encrypted_key || !row.key_sender_public) continue;
        let key: CryptoKey;
        try {
          const raw = await unwrapChatKey(row.encrypted_key, identity.privateKey, row.key_sender_public);
          key = await importKey(raw);
        } catch {
          continue;
        }
        const { data: messages, error: messageError } = await supabase
          .from('messages')
          .select('id,sender_id,ciphertext,message_type,created_at,deleted_at')
          .eq('chat_id', row.chat_id)
          .eq('message_type', 'text')
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .range(0, 499);
        if (messageError) continue;
        for (const message of (messages ?? []) as MessageRow[]) {
          if (!message.ciphertext) continue;
          try {
            const text = await decryptText(message.ciphertext, key);
            if (text.toLocaleLowerCase().includes(term)) {
              found.push({ messageId: message.id, chatId: row.chat_id, chatName: chat?.name || 'Chat', senderId: message.sender_id, createdAt: message.created_at, text });
              if (found.length >= 100) break;
            }
          } catch {
            // Skip messages that cannot be decrypted by this device.
          }
        }
      }
      setResults(found.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      if (!found.length) setNotice('No matching encrypted messages found on this device.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Search failed.');
    } finally {
      setBusy(false);
    }
  }

  function jumpToResult(result: SearchResult) {
    setOpen(false);
    const node = document.getElementById(`message-${result.messageId}`);
    if (node) {
      node.scrollIntoView({ behavior: 'smooth', block: 'center' });
      node.classList.add('message-highlight');
      window.setTimeout(() => node.classList.remove('message-highlight'), 1200);
    } else {
      setNotice('Open the matching chat first to jump to this message.');
    }
  }

  if (!isAuthenticated || !ready) return null;
  return <>
    <button className="search-launcher" title="Search encrypted messages (Ctrl/Cmd+K)" onClick={() => { setOpen(true); setNotice(''); }}><Search size={17}/><span>Search</span><kbd>Ctrl K</kbd></button>
    {open && <div className="modal-backdrop search-backdrop"><div className="modal search-modal">
      <button className="modal-close" onClick={() => setOpen(false)}><X/></button>
      <h2>Search encrypted messages</h2>
      <p>Messages are downloaded as ciphertext and searched only after decryption in your browser.</p>
      <div className="search-row"><input autoFocus value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && void searchMessages()} placeholder="Search your messages…"/><button className="primary" disabled={busy || !query.trim()} onClick={() => void searchMessages()}>{busy ? 'Searching…' : 'Search'}</button></div>
      {notice && <div className="notice">{notice}</div>}
      <div className="search-results">{results.map(result => <button className="search-result" key={result.messageId} onClick={() => jumpToResult(result)}><strong>{result.chatName}</strong><small>{new Date(result.createdAt).toLocaleString()}</small><span>{result.text}</span></button>)}</div>
    </div></div>}
  </>;
}
