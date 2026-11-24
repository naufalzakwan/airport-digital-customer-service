import { useId, useState } from 'react';
import { Settings } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

type Props = {
  name: string;
  onLogout: () => Promise<void>;
  blockedReason?: string;
};

export default function OfficerSettings({ name, onLogout, blockedReason }: Props) {
  const headingId = useId();
  const reasonId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const logout = async () => {
    setBusy(true);
    setError('');
    try { await onLogout(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Logout gagal. Coba lagi.'); }
    finally { setBusy(false); }
  };

  return <Popover onOpenChange={open => { if (open) setError(''); }}>
    <PopoverTrigger asChild>
      <button type="button" className="officer-settings-trigger" aria-label="Pengaturan Akun" title="Pengaturan Akun">
        <Settings aria-hidden="true" />
      </button>
    </PopoverTrigger>
    <PopoverContent className="officer-settings-menu" align="end" sideOffset={8} collisionPadding={12} aria-labelledby={headingId}>
      <h2 id={headingId}>Pengaturan Akun</h2>
      <p className="officer-settings-name" dir="auto">{name}</p>
      <p className="officer-settings-detail">Petugas aktif</p>
      <button type="button" className="officer-logout" disabled={busy || !!blockedReason} aria-describedby={blockedReason ? reasonId : undefined} onClick={() => void logout()}>
        {busy ? 'Memproses logout…' : 'Logout / Ganti Petugas'}
      </button>
      {blockedReason && <p id={reasonId} role="status" className="officer-settings-message">{blockedReason}</p>}
      {error && <p role="alert" className="officer-settings-message">{error}</p>}
    </PopoverContent>
  </Popover>;
}
