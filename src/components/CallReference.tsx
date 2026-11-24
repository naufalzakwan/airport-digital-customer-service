import { useState } from 'react';
import { Copy } from 'lucide-react';

export default function CallReference({ code }: { code?: string | null }) {
  const [feedback, setFeedback] = useState('');

  const copy = async () => {
    if (!code) return;
    setFeedback('');
    try {
      await navigator.clipboard.writeText(code);
      setFeedback('ID berhasil disalin');
    } catch {
      setFeedback('ID tidak dapat disalin otomatis. Salin nomor secara manual.');
    }
  };

  return <div className="call-reference">
    <div className="call-reference-row">
      <strong className="call-reference-code" dir="ltr">{code || '—'}</strong>
      <button type="button" className="call-reference-copy" disabled={!code} onClick={() => void copy()}>
        <Copy aria-hidden="true" /> Copy ID
      </button>
    </div>
    {feedback && <p className="call-reference-feedback" role="status">{feedback}</p>}
  </div>;
}
