import { useEffect, useMemo, useState } from 'react';
import { Image as ImageIcon, Menu, Upload, Users, Settings, UserRound, ShieldCheck, X } from 'lucide-react';
import { useAuth0 } from '@auth0/auth0-react';
import { makeSupabase } from './lib/supabase';

type ChatMeta={id:string;name:string;code:string;last:number;unread:number};
const KEY='encrypted-chat:chat-ui:v1';
const load=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'{}') as any}catch{return {}}};
const save=(v:any)=>localStorage.setItem(KEY,JSON.stringify(v));

export default function Enhancements(){
 const {isAuthenticated,getIdTokenClaims}=useAuth0();
 const [preview,setPreview]=useState<File[]|null>(null);
 const [menuOpen,setMenuOpen]=useState(false);
 const [profileOpen,setProfileOpen]=useState(false);
 const [theme,setTheme]=useState(()=>localStorage.getItem('encrypted-chat:theme')||'dark');
 const supabase=useMemo(()=>isAuthenticated?makeSupabase(async()=>(await getIdTokenClaims())?.__raw):null,[getIdTokenClaims,isAuthenticated]);
 useEffect(()=>{document.documentElement.dataset.theme=theme;localStorage.setItem('encrypted-chat:theme',theme)},[theme]);
 useEffect(()=>{if(!isAuthenticated)return;let disposed=false;let timer:number|undefined;let channel:any;const sync=async()=>{if(!supabase||disposed)return;const claims=await getIdTokenClaims();const ownSub=claims?.sub;if(!ownSub)return;const {data}=await supabase.from('chat_members').select('chat_id,hidden,chats(id,name,chat_members(auth0_sub,display_name,user_code))').eq('auth0_sub',ownSub).is('removed_at',null);if(!data)return;const meta=(data as any[]).map(row=>{const members=row.chats?.chat_members||[];const other=members.find((m:any)=>m.auth0_sub!==ownSub);return {id:row.chat_id,name:row.chats?.name||other?.display_name||'Chat',code:other?.user_code||'',last:0,unread:0} as ChatMeta});const {data:rows}=await supabase.from('messages').select('chat_id,created_at,sender_id').order('created_at',{ascending:false}).limit(1000);const state=load();for(const m of meta){const latest=(rows||[]).find((r:any)=>r.chat_id===m.id);m.last=latest?Date.parse(latest.created_at):0;const read=Number(state.read?.[m.id]||0);m.unread=(rows||[]).filter((r:any)=>r.chat_id===m.id&&r.sender_id!==ownSub&&Date.parse(r.created_at)>read).length}const apply=()=>{const list=document.querySelector('.chat-list');if(!list)return;const buttons=[...list.querySelectorAll<HTMLElement>('.chat-row')];if(!buttons.length)return;const byText=(el:HTMLElement)=>{const text=(el.textContent||'').trim();return meta.find(m=>text.includes(m.name)||(m.code&&text.includes(m.code)))};buttons.forEach(el=>{const m=byText(el);if(!m)return;el.dataset.enhancedChatId=m.id;el.style.position='relative';let tools=el.querySelector<HTMLElement>('.chat-ui-tools');if(!tools){tools=document.createElement('span');tools.className='chat-ui-tools';tools.onclick=e=>e.stopPropagation();el.appendChild(tools)}const pinned=Boolean(state.pinned?.[m.id]),muted=Boolean(state.muted?.[m.id]);tools.innerHTML='';const p=document.createElement('button');p.title=pinned?'Unpin':'Pin';p.textContent=pinned?'Unpin':'Pin';p.onclick=e=>{e.stopPropagation();const s=load();s.pinned??={};s.pinned[m.id]=!pinned;save(s);apply()};const u=document.createElement('button');u.title=muted?'Unmute':'Mute';u.textContent=muted?'Unmute':'Mute';u.onclick=e=>{e.stopPropagation();const s=load();s.muted??={};s.muted[m.id]=!muted;save(s);apply()};tools.append(p,u);el.querySelector('.chat-unread')?.remove();if(m.unread&&!muted){const badge=document.createElement('b');badge.className='chat-unread';badge.textContent=String(m.unread);el.appendChild(badge)}if(pinned)el.classList.add('ui-pinned');else el.classList.remove('ui-pinned')});const ordered=[...buttons].sort((a,b)=>Number(b.classList.contains('ui-pinned'))-Number(a.classList.contains('ui-pinned')));ordered.forEach(x=>list.appendChild(x))};apply();timer=window.setInterval(apply,1200);channel=supabase.channel('ui-message-activity').on('postgres_changes',{event:'INSERT',schema:'public',table:'messages'},()=>void sync()).subscribe()};void sync();return()=>{disposed=true;if(timer)clearInterval(timer);if(channel)void supabase?.removeChannel(channel)}},[isAuthenticated,supabase,getIdTokenClaims]);
 useEffect(()=>{const onClick=(e:MouseEvent)=>{const row=(e.target as HTMLElement).closest<HTMLElement>('.chat-row');if(!row)return;const id=row.dataset.enhancedChatId;if(!id)return;const s=load();s.read??={};s.read[id]=Date.now();save(s);row.querySelector('.chat-unread')?.remove()};document.addEventListener('click',onClick);return()=>document.removeEventListener('click',onClick)},[]);
 useEffect(()=>{const onOver=(e:DragEvent)=>{if(e.dataTransfer?.types.includes('Files')&&document.querySelector('.composer')){e.preventDefault();document.body.classList.add('file-dragging')}};const onLeave=()=>document.body.classList.remove('file-dragging');const onDrop=(e:DragEvent)=>{document.body.classList.remove('file-dragging');if(!e.dataTransfer?.files.length||!document.querySelector('.composer'))return;e.preventDefault();setPreview([...e.dataTransfer.files])};window.addEventListener('dragover',onOver);window.addEventListener('dragleave',onLeave);window.addEventListener('drop',onDrop);return()=>{window.removeEventListener('dragover',onOver);window.removeEventListener('dragleave',onLeave);window.removeEventListener('drop',onDrop)}},[]);
 const choose=()=>{if(!preview)return;const input=document.querySelector<HTMLInputElement>('.composer input[type="file"]');if(!input)return;const dt=new DataTransfer();preview.forEach(f=>dt.items.add(f));input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));setPreview(null)};
 const clickByText=(terms:string[])=>{const els=[...document.querySelectorAll<HTMLElement>('button,[role="button"]')];const el=els.find(x=>terms.some(t=>(x.textContent||'').trim().toLowerCase().includes(t))||terms.some(t=>(x.getAttribute('title')||'').toLowerCase().includes(t)));if(el){el.click();setMenuOpen(false)}};
 const openGroups=()=>{window.dispatchEvent(new KeyboardEvent('keydown',{key:'g',ctrlKey:true,shiftKey:true,bubbles:true}));setMenuOpen(false)};
 const openChatSettings=()=>clickByText(['chat settings','chat setting']);
 const openProfile=()=>{setMenuOpen(false);setProfileOpen(true)};
 const openSecurity=()=>{window.dispatchEvent(new Event('encrypted-chat:open-security-center'));setMenuOpen(false)};
 if(!isAuthenticated)return null;
 return <>
  <div className="side-menu-hotspot" onMouseEnter={()=>setMenuOpen(true)} />
  <aside className={`side-menu ${menuOpen?'open':''}`} onMouseEnter={()=>setMenuOpen(true)} onMouseLeave={()=>setMenuOpen(false)}>
   <div className="side-menu-handle"><Menu size={17}/></div>
   <div className="side-menu-content">
    <button onClick={()=>clickByText(['new chat','add person'])}><span className="side-message-icon">+</span><span>New chat</span></button>
    <button onClick={()=>clickByText(['new group','create group'])}><Users size={17}/><span>New group</span></button>
    <button onClick={openGroups}><Users size={17}/><span>Groups</span></button>
    <button onClick={openChatSettings}><Settings size={17}/><span>Chat settings</span></button>
    <button onClick={openSecurity}><ShieldCheck size={17}/><span>Security Center</span></button>
    <button onClick={openProfile}><UserRound size={17}/><span>Profile settings</span></button>
   </div>
  </aside>
  {profileOpen&&<div className="profile-settings-backdrop" onClick={()=>setProfileOpen(false)}><section className="profile-settings-panel" onClick={e=>e.stopPropagation()}><header><div><strong>Profile settings</strong><span>Account and app preferences</span></div><button onClick={()=>setProfileOpen(false)}><X size={17}/></button></header><div className="profile-settings-section"><h3>Theme</h3><p>Choose how Encrypted Chat looks on this device.</p><div className="theme-options"><button className={theme==='dark'?'active':''} onClick={()=>setTheme('dark')}>Dark</button><button className={theme==='light'?'active':''} onClick={()=>setTheme('light')}>Light</button><button className={theme==='system'?'active':''} onClick={()=>setTheme('system')}>System</button></div></div></section></div>}
  {preview&&<div className="file-drop-backdrop"><div className="file-drop-modal"><button className="file-drop-close" onClick={()=>setPreview(null)}><X/></button><Upload size={28}/><h3>Send files</h3><p>{preview.length} file{preview.length===1?'':'s'} ready to send.</p><div className="file-preview-list">{preview.map((f,i)=><div className="file-preview-item" key={i}>{f.type.startsWith('image/')?<img src={URL.createObjectURL(f)} alt=""/>:<ImageIcon size={16}/>}<span>{f.name}</span><small>{Math.max(1,Math.round(f.size/1024))} KB</small></div>)}</div><div className="file-drop-actions"><button onClick={()=>setPreview(null)}>Cancel</button><button className="primary" onClick={choose}>Send</button></div></div></div>}
 </>;
}
