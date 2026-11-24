import { ChevronLeft, ChevronRight, Clock3 } from 'lucide-react';
import { durationLabel } from '@/components/CallReview';
import type { CallDashboard, CallRecord } from '@/types/queue';

function pageNumbers(page: number, total: number) {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const start = Math.max(2, Math.min(page - 1, total - 3));
  const end = start + 2;
  return [1, ...(start > 2 ? ['start-gap'] : []), start, start + 1, end, ...(end < total - 1 ? ['end-gap'] : []), total];
}

type Props = {
  history: CallDashboard | null;
  error: string;
  onDetail: (call: CallRecord) => void;
  onPage: (page: number) => void;
};

export default function RecentCalls({ history, error, onDetail, onPage }: Props) {
  const total = history?.recentTotal ?? 0;
  const page = history?.recentPage ?? 1;
  const pages = history ? Math.ceil(total / history.recentPageSize) : 0;

  return <section aria-labelledby="recent-calls-title">
    <div className="portal-panel-title recent-calls-title">
      <h2 id="recent-calls-title">Recent Calls</h2>
      {history && <span className="recent-calls-count">{total} panggilan</span>}
    </div>
    {error && <p role="alert" className="queue-message">{error}</p>}
    {history?.recent.length ? <div className="queue-list">
      {history.recent.map(call => <button type="button" className="queue-item" key={call.callId} onClick={() => onDetail(call)}>
        <span><strong>{call.passengerName}</strong><b>{durationLabel(call.durationSeconds)}</b></span>
        <span>{call.serviceCategory} · {call.endedAt ? new Date(call.endedAt).toLocaleString('id-ID') : '—'}</span>
        <small>{call.referenceCode} · Selesai · Catatan tersimpan{call.callNotes ? ` · ${call.callNotes.slice(0, 100)}` : ''}</small>
      </button>)}
    </div> : <div className="portal-empty"><Clock3 aria-hidden="true" /><p>Belum ada riwayat panggilan tersimpan.</p></div>}
    {pages > 1 && <nav className="recent-pagination" aria-label="Halaman Recent Calls">
      <button type="button" aria-label="Halaman sebelumnya" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft aria-hidden="true" /></button>
      {pageNumbers(page, pages).map(number => typeof number === 'number'
        ? <button key={number} type="button" aria-label={`Halaman ${number}`} aria-current={page === number ? 'page' : undefined} onClick={() => onPage(number)}>{number}</button>
        : <span key={number} aria-hidden="true">…</span>)}
      <button type="button" aria-label="Halaman berikutnya" disabled={page >= pages} onClick={() => onPage(page + 1)}><ChevronRight aria-hidden="true" /></button>
    </nav>}
    {history?.recentHasUpdates && <p className="recent-calls-update" role="status">
      Riwayat baru tersedia. <button type="button" onClick={() => onPage(1)}>Lihat halaman pertama</button>
    </p>}
  </section>;
}
