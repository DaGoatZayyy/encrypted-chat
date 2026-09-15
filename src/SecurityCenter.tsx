import { useEffect, useState } from 'react';
import { CheckCircle2, Copy, Fingerprint, KeyRound, ShieldCheck, X } from 'lucide-react';
import { useAuth0 } from '@auth0/auth0-react';
import { getOrCreateIdentity } from './lib/crypto-keys';

async function fingerprintFor(jwk: JsonWebKey) {
  const material = JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('').match(/.{1,8}/g)?.join(' ') ?? '';
}

export default function SecurityCenter() {
  const { isAuthenticated } = useAuth0();
  const [open, setOpen] = useState(false);
  const [fingerprint, setFingerprint] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener('encrypted-chat:open-security-center', onOpen);
    return () => window.removeEventListener('encrypted-chat:open-security-center', onOpen);
  }, []);

  useEffect(() => {
    if (!open || !isAuthenticated) return;
    let cancelled = false;
    void getOrCreateIdentity().then(identity => fingerprintFor(identity.publicJwk)).then(value => {
      if (!cancelled) setFingerprint(value);
    }).catch(err => {
      if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load encryption status.');
    });
    return () => { cancelled = true; };
  }, [open, isAuthenticated]);

  if (!isAuthenticated || !open) return null;

  const copyFingerprint = async () => {
    if (!fingerprint) return;
    await navigator.clipboard?.writeText(fingerprint);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return <div className="security-center-backdrop" onClick={() => setOpen(false)}>
    <section className="security-center-panel" onClick={e => e.stopPropagation()}>
      <header>
        <div><strong>Security Center</strong><span>Encryption and device security</span></div>
        <button onClick={() => setOpen(false)} aria-label="Close"><X size={17}/></button>
      </header>
      <div className="security-status-grid">
        <article><div className="security-icon"><ShieldCheck size={19}/></div><div><b>Encryption</b><span>End-to-end message encryption</span><em>AES-256-GCM</em></div><CheckCircle2 className="security-ok" size={18}/></article>
        <article><div className="security-icon"><KeyRound size={19}/></div><div><b>Identity key</b><span>Private key stored in IndexedDB</span><em>Non-extractable WebCrypto key</em></div><CheckCircle2 className="security-ok" size={18}/></article>
        <article><div className="security-icon"><Fingerprint size={19}/></div><div><b>Key fingerprint</b><span>Use this to recognize this device identity</span><code>{fingerprint || 'Calculating…'}</code></div>{fingerprint&&<button className="security-copy" onClick={copyFingerprint} title="Copy fingerprint">{copied?<CheckCircle2 size={16}/>:<Copy size={16}/>}</button>}</article>
      </div>
      <div className="security-recovery"><b>Recovery</b><span>Not configured. Recovery backup and restore are planned for Update 12.</span></div>
      {error&&<p className="security-error">{error}</p>}
      <p className="security-note">Your private identity key is not stored in localStorage. Existing legacy keys are migrated into IndexedDB the next time the app opens them.</p>
    </section>
  </div>;
}
