import { useQuery } from "@tanstack/react-query";
import { Disc3 } from "lucide-react";
import { voxariaApi, type ApiAuditTrack } from "@/lib/voxaria-api";

const toRelativeTime = (value?: string) => {
  if (!value) return "just now";
  const parsed = new Date(value).getTime();
  if (Number.isNaN(parsed)) return "just now";

  const diffMs = Math.max(0, Date.now() - parsed);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) return "just now";
  if (diffMs < hour) return `${Math.floor(diffMs / minute)} mins ago`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)} hrs ago`;
  return `${Math.floor(diffMs / day)} days ago`;
};

const getTrackTimestamp = (track: ApiAuditTrack) => track.requestedAt ?? track.createdAt ?? track.timestamp;

export function AuditLogViewer() {
  const auditLog = useQuery({
    queryKey: ["audit-log"],
    queryFn: async () => {
      try {
        return await voxariaApi.getAuditLog();
      } catch (error) {
        console.log("Audit log fetch failed:", error instanceof Error ? error.message : error);
        throw error;
      }
    },
    refetchInterval: 15000,
  });

  return (
    <article className="rounded-md border border-primary/35 bg-panel-soft/70 p-4 shadow-soft neon-edge">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-primary">Audit Log</h3>
      </div>

      <div className="space-y-2 overflow-y-auto" style={{ maxHeight: 210 }}>
        {auditLog.isError ? (
          <p className="rounded-md border border-border/70 bg-panel/70 px-3 py-2 text-xs text-muted-foreground">Service Unavailable</p>
        ) : (
          (auditLog.data ?? []).map((track) => (
            <div key={track.id} className="flex items-center gap-2 rounded-md border border-border/70 bg-panel/80 p-2">
              {track.requesterAvatar ? (
                <img src={track.requesterAvatar} alt="Requester avatar" loading="lazy" className="w-8 h-8 rounded-full object-cover border border-border/70" />
              ) : (
                <div className="flex h-8 w-8 items-center justify-center rounded-full border border-border/70 bg-panel">
                  <Disc3 className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
              )}

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-xs font-semibold text-foreground">{track.title}</p>
                  <span className="shrink-0 text-[10px] text-muted-foreground">{toRelativeTime(getTrackTimestamp(track))}</span>
                </div>
              </div>
            </div>
          ))
        )}

        {!auditLog.isError && !(auditLog.data ?? []).length && (
          <p className="rounded-md border border-border/70 bg-panel/70 px-3 py-2 text-xs text-muted-foreground">No audit entries yet.</p>
        )}
      </div>
    </article>
  );
}