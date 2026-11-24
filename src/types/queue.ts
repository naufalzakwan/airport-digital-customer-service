export type QueueStatus = 'waiting' | 'accepted' | 'rejected' | 'cancelled' | 'expired' | 'completed' | 'failed';
export interface QueueRequest {
  requestId: string;
  passengerId: string;
  passengerName: string;
  language: string;
  serviceCategory: string;
  waitingSince: number;
  status: QueueStatus;
  passengerOnline: boolean;
  officerId: string | null;
  officerName: string | null;
  officerOnline: boolean;
  callId: string | null;
  referenceCode: string | null;
  callGeneration: number;
  callStartedAt: number | null;
  callEndedAt: number | null;
  callEndReason: string | null;
  callFailureCode: string | null;
  callFailedRole: 'petugas' | 'penumpang' | null;
  passengerSignalId?: string;
  officerSignalId?: string;
}

export interface CallRecord {
  callId: string; referenceCode: string; requestId: string; passengerName: string; officerName: string;
  language: string; serviceCategory: string; connectedAt: number | null; endedAt: number | null;
  durationSeconds: number | null; callNotes: string; notesStatus: 'draft' | 'saved'; rating: number | null;
  callStatus: string; createdAt: number; updatedAt: number;
}
export interface CallDashboard {
  recent: CallRecord[]; pending: CallRecord[];
  recentTotal: number;
  recentPage: number;
  recentPageSize: number;
  recentSnapshot: number;
  recentHasUpdates: boolean;
  stats: { callToday: number; averageDurationSeconds: number; totalSecondsToday: number; averageRating: number | null; ratingCount: number };
}
