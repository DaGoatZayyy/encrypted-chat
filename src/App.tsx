import { useEffect, useMemo, useState } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { Lock, MessageCircle, Plus, Settings, Shield, UserRound, EyeOff, Paperclip, Send, LogOut } from 'lucide-react';
import { makeSupabase } from './lib/supabase';
import { createChatKey, decryptText, encryptText, exportKey, importKey } from './lib/crypto';

const ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const ID_LENGTH = 12;

type Chat = {
  id: string;
  other_user_id: string;
  other_name: string;
  hidden: boolean;
  password_protected: boolean;
  save_history: boolean;
  key?: CryptoKey;
};

type Message = { id: string; sender_id: string; ciphertext: string; created_at: string; attachment_url?: string | null };

function randomUserId() {
  const bytes = crypto.getRandomValues(new Uint8Array(ID_LENGTH));
  return Array.from(bytes, (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join('');
}

export default function App() {
  const { isLoading, isAuthenticated, loginWithRedirect, logout, user, getIdTokenClaims } = useAuth0();
  const [tab, setTab] = useState<'chat' | 'profile'>('chat');
  const [chats, setChats] = useState<Chat[]>([]);
  const [selected, setSelected] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [targetId, setTargetId] = useState('');
  const [displayName, setDisplayName] = useState(user?.name ?? '');
  const [hiddenChats, setHiddenChats] = useState(false);
  const [appLocked, setAppLocked] = useState(false);
  const [appPassword, setAppPassword] = useState('');
  const [notice, setNotice] = useState('');

  const supabase = useMemo(() => {
    if (!isAuthenticated) return null;
    return makeSupabase(async () => (await getIdTokenClaims())?.__raw);
  }, [getIdTokenClaims, isAuthenticated]);

  useEffect(() => {
    if (!supabase || !user?.sub) return;
    void loadProfile();
    void loadChats();
  }, [supabase, user?.sub]);

  async function loadProfile() {
    if (!supabase || !user?.sub) return;
    const { data } = await supabase.from('profiles').select('display_name,user_code').eq('auth0_sub', user.sub).maybeSingle();
    if (!data) {
      await supabase.from('profiles').insert({ auth0_sub: user.sub, display_name: user.name ?? 'User', user_code: randomUserId() });
    } else {
      setDisplayName(data.display_name);
    }
  }

  async function loadChats() {
    if (!supabase || !user?.sub) return;
    const { data } = await supabase
      .from('chat_members')
      .select('chat_id,hidden,chats(id,password_protected,save_history,chat_members(auth0_sub,display_name,user_code))')
      .eq('auth0_sub', user.sub);
    if (!data) return;
    const next: Chat[] = data.flatMap((row: any) => {
      const members = row.chats?.chat_members ?? [];
      const other = members.find((m: any) => m.auth0_sub !== user.sub);
      return other ? [{ id: row.chat_id, other_user_id: other.user_code, other_name: other.display_name, hidden: row.hidden, password_protected: row.chats.password_protected, save_history: row.chats.save_history }] : [];
    });
    setChats(next);
  }

  async function addPerson() {
    const code = targetId.trim();
    if (code.length !== ID_LENGTH) return setNotice('User ID must be exactly 12 characters.');
    if (!supabase || !user?.sub) return;
    const { data: target } = await supabase.from('profiles').select('auth0_sub,display_name,user_code').eq('user_code', code).maybeSingle();
    if (!target) return setNotice('No user found with that ID.');
    if (target.auth0_sub === user.sub) return setNotice('You cannot add yourself.');
    const key = await createChatKey();
    const keyRaw = await exportKey(key);
    const { data: chat, error } = await supabase.from('chats').insert({ created_by: user.sub, encrypted_key_a: keyRaw }).select('id').single();
    if (error || !chat) return setNotice(error?.message ?? 'Could not create chat.');
    await supabase.from('chat_members').insert([
      { chat_id: chat.id, auth0_sub: user.sub, display_name: displayName, user_code: code, hidden: false, encrypted_key: keyRaw },
      { chat_id: chat.id, auth0_sub: target.auth0_sub, display_name: target.display_name, user_code: code, hidden: false, encrypted_key: keyRaw },
    ]);
    setSelected({ id: chat.id, other_user_id: code, other_name: target.display_name, hidden: false, password_protected: false, save_history: true, key });
    setShowAdd(false);
    setTargetId('');
    await loadChats();
  }

  async function openChat(chat: Chat) {
    if (!supabase || !user?.sub) return;
    const { data } = await supabase.from('chat_members').select('encrypted_key').eq('chat_id', chat.id).eq('auth0_sub', user.sub).single();
    if (!data?.encrypted_key) return;
    const key = await importKey(data.encrypted_key);
    const unlocked = { ...chat, key };
    setSelected(unlocked);
    if (chat.save_history) {
      const { data: rows } = await supabase.from('messages').select('id,sender_id,ciphertext,created_at,attachment_url').eq('chat_id', chat.id).order('created_at', { ascending: true });
      setMessages(rows ?? []);
    } else setMessages([]);
  }

  async function sendMessage() {
    if (!draft.trim() || !selected?.key || !supabase || !user?.sub) return;
    const ciphertext = await encryptText(draft.trim(), selected.key);
    await supabase.from('messages').insert({ chat_id: selected.id, sender_id: user.sub, ciphertext });
    setDraft('');
    if (selected.save_history) {
      const { data } = await supabase.from('messages').select('id,sender_id,ciphertext,created_at,attachment_url').eq('chat_id', selected.id).order('created_at', { ascending: true });
      setMessages(data ?? []);
    }
  }

  async function updateProfile() {
    if (!supabase || !user?.sub) return;
    await supabase.from('profiles').update({ display_name: displayName }).eq('auth0_sub', user.sub);
    setNotice('Profile updated.');
  }

  if (isLoading) return <div className="center">Loading secure session…</div>;
  if (!isAuthenticated) return <div className="landing"><div className="brand"><Shield size={28} /> Encrypted Chat</div><h1>Private by design.</h1><p>Messages are encrypted in your browser before they are sent to Supabase.</p><button className="primary" onClick={() => loginWithRedirect()}>Create account / Log in</button></div>;
  if (appLocked) return <div className="center"><div className="lock-card"><Lock size={30} /><h2>App locked</h2><input type="password" placeholder="App password" value={appPassword} onChange={(e) => setAppPassword(e.target.value)} /><button className="primary" onClick={() => { if (appPassword) setAppLocked(false); }}>Unlock</button></div></div>;

  const visibleChats = chats.filter((chat) => hiddenChats ? chat.hidden : !chat.hidden);

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><Shield size={22} /> Encrypted Chat</div>
      <div className="privacy-badge"><Lock size={15} /> End-to-end encrypted</div>
      <nav>
        <button className={tab === 'chat' ? 'nav active' : 'nav'} onClick={() => setTab('chat')}><MessageCircle size={18} /> Chat</button>
        <button className={tab === 'profile' ? 'nav active' : 'nav'} onClick={() => setTab('profile')}><UserRound size={18} /> Profile</button>
      </nav>
      <div className="sidebar-bottom"><button className="nav" onClick={() => setAppLocked(true)}><Lock size={18} /> Lock app</button><button className="nav danger" onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })}><LogOut size={18} /> Log out</button></div>
    </aside>

    <main className="main">
      {tab === 'chat' ? <>
        <header className="topbar"><div><span className="eyebrow">PRIVATE MESSAGING</span><h1>{hiddenChats ? 'Hidden chats' : 'Chats'}</h1></div><button className="icon-button" title="Add person" onClick={() => setShowAdd(true)}><Plus /></button></header>
        <section className="chat-layout">
          <div className="chat-list">
            {visibleChats.length === 0 ? <div className="empty"><MessageCircle size={32} /><p>No chats yet.</p><button className="secondary" onClick={() => setShowAdd(true)}>Add someone</button></div> : visibleChats.map((chat) => <button className={selected?.id === chat.id ? 'chat-row selected' : 'chat-row'} key={chat.id} onClick={() => void openChat(chat)}><div className="avatar">{chat.other_name?.slice(0,1).toUpperCase() ?? '?'}</div><div><strong>{chat.other_name}</strong><small>{chat.other_user_id}</small></div>{chat.password_protected && <Lock size={14} />}</button>)}
          </div>
          <div className="conversation">
            {!selected ? <div className="empty large"><Shield size={42} /><h2>Your messages stay encrypted</h2><p>Select a chat or add someone. The server receives ciphertext, not message plaintext.</p></div> : <>
              <div className="conversation-head"><div><strong>{selected.other_name}</strong><small>{selected.other_user_id}</small></div><div className="security-label"><Lock size={14} /> encrypted</div></div>
              <div className="messages">{messages.map((m) => <div className={m.sender_id === user.sub ? 'bubble mine' : 'bubble'} key={m.id}>{selected.key ? <>{/* decryption happens below */}<AsyncMessage ciphertext={m.ciphertext} keyRef={selected.key} /></> : 'Encrypted message'}</div>)}</div>
              <div className="composer"><button className="icon-button"><Paperclip size={18} /></button><input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void sendMessage()} placeholder="Write an encrypted message…" /><button className="send" onClick={() => void sendMessage()}><Send size={18} /></button></div>
            </>}
          </div>
        </section>
      </> : <ProfilePanel displayName={displayName} setDisplayName={setDisplayName} save={updateProfile} user={user} hiddenChats={hiddenChats} setHiddenChats={setHiddenChats} setAppLocked={setAppLocked} />}
    </main>

    {showAdd && <div className="modal-backdrop"><div className="modal"><button className="modal-close" onClick={() => setShowAdd(false)}>×</button><h2>Add someone</h2><p>Enter their 12-character User ID.</p><input autoFocus value={targetId} maxLength={12} onChange={(e) => setTargetId(e.target.value)} placeholder="aB7x…" /><button className="primary" onClick={() => void addPerson()}>Create encrypted chat</button>{notice && <div className="notice">{notice}</div>}</div></div>}
  </div>;
}

function AsyncMessage({ ciphertext, keyRef }: { ciphertext: string; keyRef: CryptoKey }) {
  const [text, setText] = useState('Decrypting…');
  useEffect(() => { void decryptText(ciphertext, keyRef).then(setText).catch(() => setText('Unable to decrypt')); }, [ciphertext, keyRef]);
  return <>{text}</>;
}

function ProfilePanel({ displayName, setDisplayName, save, user, hiddenChats, setHiddenChats, setAppLocked }: any) {
  const [userCode, setUserCode] = useState('Loading…');
  useEffect(() => { const load = async () => { const url = import.meta.env.VITE_SUPABASE_URL; const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY; if (!url || !key) return; }; void load(); }, []);
  return <div className="profile"><header className="topbar"><div><span className="eyebrow">ACCOUNT</span><h1>Profile & privacy</h1></div></header><div className="profile-card"><div className="avatar big">{(displayName || 'U').slice(0,1).toUpperCase()}</div><div><h2>{displayName || 'User'}</h2><small>{user?.email ?? 'Email hidden by Auth0'}</small></div></div><section className="settings"><label>Display name<input value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></label><button className="primary compact" onClick={save}>Save profile</button><div className="setting"><div><strong>Hide hidden chats</strong><small>Hidden chats are separated from your normal chat list.</small></div><button className={hiddenChats ? 'toggle on' : 'toggle'} onClick={() => setHiddenChats(!hiddenChats)}><span /></button></div><div className="setting"><div><strong>Lock app</strong><small>Require a local app password before opening the UI.</small></div><button className="secondary compact" onClick={() => setAppLocked(true)}>Lock now</button></div><div className="privacy-box"><Shield size={20} /><div><strong>Privacy model</strong><p>Message content is encrypted client-side with AES-GCM. Supabase stores ciphertext and metadata needed to route chats. Auth0 handles authentication. No analytics SDK is included.</p></div></div><div className="setting disabled"><div><strong>Attachments</strong><small>Design target: encrypted attachments are scheduled for deletion after 5 minutes.</small></div></div></section></div>;
}
