import { useEffect, useState } from "react";
import {
  Trophy,
  Medal,
  Crown,
  RotateCcw,
  SkipForward,
  Sparkles,
  Flame,
  User,
  X,
  Target,
  Award,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  karaokeApi,
  type KaraokeRecord,
  type ServerRecordsResponse,
} from "@/lib/api/karaoke";

export interface ServerBattleModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  guildId: string;
  trackId: string;
  trackTitle?: string;
  user: {
    id: string;
    username: string;
    avatar?: string;
  };
  score: number;
  accuracy: number;
  maxCombo: number;
  grade: "S+" | "S" | "A" | "B" | "C";
  onSingAgain: () => void;
  onNextTrack: () => void;
}

export function ServerBattleModal({
  open,
  onOpenChange,
  guildId,
  trackId,
  trackTitle,
  user,
  score,
  accuracy,
  maxCombo,
  grade,
  onSingAgain,
  onNextTrack,
}: ServerBattleModalProps) {
  const [loading, setLoading] = useState(false);
  const [recordsData, setRecordsData] = useState<ServerRecordsResponse | null>(null);

  useEffect(() => {
    if (!open) return;

    let isMounted = true;
    setLoading(true);

    const syncRecords = async () => {
      try {
        // 1. Submit user's record
        const updated = await karaokeApi.submitRecord(guildId, trackId, {
          guildId,
          trackId,
          trackTitle,
          userId: user.id,
          username: user.username,
          avatar: user.avatar,
          score,
          accuracy,
          maxCombo,
          grade,
        });

        if (isMounted) {
          setRecordsData(updated);
        }
      } catch (err) {
        console.error("Failed to sync records with server:", err);
        // Fallback to fetch records if submission failed
        try {
          const fetched = await karaokeApi.getRecords(guildId, trackId);
          if (isMounted) setRecordsData(fetched);
        } catch {
          // Keep null or defaults
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    void syncRecords();

    return () => {
      isMounted = false;
    };
  }, [open, guildId, trackId, trackTitle, user.id, user.username, user.avatar, score, accuracy, maxCombo, grade]);

  const champion = recordsData?.champion ?? null;
  const isChampion = champion?.userId === user.id || (champion && score >= champion.score);
  const isNewRecord = recordsData?.isNewRecord || (champion && score > champion.score);
  const userWon = Boolean(isChampion || isNewRecord);
  const pointsDeficit = champion && champion.score > score ? champion.score - score : 0;

  const topRecords = recordsData?.topRecords ?? [];

  const getGradeBadge = (g: string) => {
    switch (g) {
      case "S+":
        return "bg-gradient-to-r from-amber-400 to-fuchsia-500 text-slate-950 font-black shadow-[0_0_16px_rgba(234,179,8,0.7)] border-amber-300";
      case "S":
        return "bg-amber-400 text-slate-950 font-extrabold shadow-[0_0_12px_rgba(245,158,11,0.6)] border-amber-300";
      case "A":
        return "bg-emerald-500 text-white font-bold shadow-[0_0_10px_rgba(16,185,129,0.5)] border-emerald-400";
      case "B":
        return "bg-sky-500 text-white font-bold shadow-[0_0_10px_rgba(56,189,248,0.5)] border-sky-400";
      default:
        return "bg-slate-600 text-white font-semibold";
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl border-primary/40 bg-slate-950/95 text-foreground backdrop-blur-2xl p-6 shadow-[0_0_50px_rgba(0,0,0,0.9)] max-h-[92vh] overflow-y-auto">
        <DialogHeader className="space-y-1 text-center sm:text-left">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-primary font-bold tracking-wide uppercase text-sm">
              <Trophy className="h-5 w-5 text-amber-400" />
              <span>Server Record Battle</span>
            </div>
            {trackTitle && (
              <Badge variant="outline" className="border-primary/40 text-xs text-primary max-w-[240px] truncate">
                {trackTitle}
              </Badge>
            )}
          </div>
          <DialogTitle className="text-2xl font-black tracking-tight text-white flex items-center gap-2">
            End of Song Duel
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-xs">
            Direct face-off against the server's record holder for this track.
          </DialogDescription>
        </DialogHeader>

        {/* Victory / Challenger Banner */}
        <div className="my-2">
          {userWon ? (
            <div className="relative overflow-hidden rounded-xl border border-amber-400/60 bg-gradient-to-r from-amber-500/20 via-yellow-400/30 to-amber-500/20 p-4 text-center shadow-[0_0_30px_rgba(245,158,11,0.35)] animate-in fade-in zoom-in-95 duration-500">
              <div className="flex items-center justify-center gap-2 text-amber-300 font-black text-xl tracking-wider">
                <Crown className="h-7 w-7 text-amber-400 animate-bounce" />
                🏆 NEW SERVER RECORD! 🏆
                <Sparkles className="h-6 w-6 text-yellow-300 animate-pulse" />
              </div>
              <p className="mt-1 text-xs font-medium text-amber-200/90">
                You've conquered the guild leaderboard and claimed the crown!
              </p>
            </div>
          ) : (
            <div className="relative overflow-hidden rounded-xl border border-slate-700/80 bg-gradient-to-r from-slate-900/80 via-slate-800/80 to-slate-900/80 p-4 text-center shadow-md">
              <div className="flex items-center justify-center gap-2 text-slate-200 font-bold text-lg">
                <Medal className="h-6 w-6 text-slate-400" />
                🥈 SERVER CHALLENGER
              </div>
              <p className="mt-1 text-xs font-semibold text-rose-400/90">
                {pointsDeficit > 0
                  ? `Deficit: ${pointsDeficit.toLocaleString()} pts behind Server Champion`
                  : "Great effort! Step up and claim the throne!"}
              </p>
            </div>
          )}
        </div>

        {/* Duel Face-off Cards (User vs Champion) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 my-2">
          {/* Left: Current User Card */}
          <div
            className={`relative rounded-xl border p-4 backdrop-blur-md flex flex-col justify-between transition-all ${
              userWon
                ? "border-amber-400/60 bg-amber-950/20 shadow-[0_0_20px_rgba(245,158,11,0.2)]"
                : "border-sky-500/40 bg-slate-900/60"
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <Avatar className="h-14 w-14 border-2 border-primary/60 shadow-[0_0_12px_hsl(var(--primary)/0.4)]">
                  <AvatarImage src={user.avatar} alt={user.username} />
                  <AvatarFallback className="bg-primary/20 text-primary font-bold">
                    {user.username.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">You</span>
                    {userWon && <Crown className="h-3.5 w-3.5 text-amber-400" />}
                  </div>
                  <h4 className="font-bold text-base text-white truncate max-w-[130px]">{user.username}</h4>
                  <Badge className={`mt-1 text-[11px] px-2 py-0 border ${getGradeBadge(grade)}`}>
                    Grade {grade}
                  </Badge>
                </div>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-border/60">
              <div className="flex items-baseline justify-between mb-2">
                <span className="text-xs text-muted-foreground">Score</span>
                <span className="font-mono text-2xl font-black text-primary drop-shadow-[0_0_10px_hsl(var(--primary)/0.6)]">
                  {score.toLocaleString()}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-md bg-slate-950/60 p-2 border border-border/50">
                  <span className="text-muted-foreground block text-[10px] uppercase">Accuracy</span>
                  <span className="font-semibold text-emerald-400 text-sm">{accuracy}%</span>
                </div>
                <div className="rounded-md bg-slate-950/60 p-2 border border-border/50">
                  <span className="text-muted-foreground block text-[10px] uppercase">Max Streak</span>
                  <span className="font-semibold text-amber-400 text-sm">x{maxCombo}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Server Champion Card */}
          <div
            className={`relative rounded-xl border p-4 backdrop-blur-md flex flex-col justify-between transition-all ${
              !userWon
                ? "border-amber-500/60 bg-amber-950/20 shadow-[0_0_20px_rgba(245,158,11,0.2)]"
                : "border-border/70 bg-slate-900/60"
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <Avatar className="h-14 w-14 border-2 border-amber-400/60 shadow-[0_0_14px_rgba(245,158,11,0.35)]">
                  <AvatarImage src={champion?.avatar} alt={champion?.username ?? "Champion"} />
                  <AvatarFallback className="bg-amber-500/20 text-amber-300 font-bold">
                    {(champion?.username ?? "Champ").slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <div className="flex items-center gap-1.5">
                    <Crown className="h-3.5 w-3.5 text-amber-400" />
                    <span className="text-xs text-amber-300 font-bold uppercase tracking-wider">Server Champion</span>
                  </div>
                  <h4 className="font-bold text-base text-white truncate max-w-[130px]">
                    {champion?.username ?? "No Champion Yet"}
                  </h4>
                  <span className="text-[11px] text-muted-foreground block mt-0.5">
                    {champion?.dateSet ? `Set on ${champion.dateSet}` : "Be the first!"}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-border/60">
              <div className="flex items-baseline justify-between mb-2">
                <span className="text-xs text-muted-foreground">High Score</span>
                <span className="font-mono text-2xl font-black text-amber-400 drop-shadow-[0_0_10px_rgba(245,158,11,0.5)]">
                  {(champion?.score ?? 0).toLocaleString()}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-md bg-slate-950/60 p-2 border border-border/50">
                  <span className="text-muted-foreground block text-[10px] uppercase">Accuracy</span>
                  <span className="font-semibold text-emerald-400 text-sm">
                    {champion?.accuracy ? `${champion.accuracy}%` : "--"}
                  </span>
                </div>
                <div className="rounded-md bg-slate-950/60 p-2 border border-border/50">
                  <span className="text-muted-foreground block text-[10px] uppercase">Max Streak</span>
                  <span className="font-semibold text-amber-400 text-sm">
                    {champion?.maxCombo ? `x${champion.maxCombo}` : "--"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Server Hall of Fame Table */}
        <div className="my-2 rounded-xl border border-border/70 bg-slate-900/70 p-3">
          <div className="flex items-center justify-between mb-2 px-1">
            <h4 className="text-xs font-bold text-primary uppercase tracking-wider flex items-center gap-1.5">
              <Award className="h-4 w-4 text-amber-400" />
              Guild Hall of Fame (Top 3 Records)
            </h4>
            <span className="text-[10px] text-muted-foreground">Guild: {guildId}</span>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border/50 hover:bg-transparent">
                  <TableHead className="w-12 text-[11px] font-bold text-muted-foreground">Rank</TableHead>
                  <TableHead className="text-[11px] font-bold text-muted-foreground">Vocalist</TableHead>
                  <TableHead className="text-right text-[11px] font-bold text-muted-foreground">Score</TableHead>
                  <TableHead className="text-center text-[11px] font-bold text-muted-foreground">Acc</TableHead>
                  <TableHead className="text-center text-[11px] font-bold text-muted-foreground">Combo</TableHead>
                  <TableHead className="text-right text-[11px] font-bold text-muted-foreground">Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topRecords.length > 0 ? (
                  topRecords.map((rec, index) => {
                    const isSelf = rec.userId === user.id;
                    const rankIcons = ["🥇", "🥈", "🥉"];
                    return (
                      <TableRow
                        key={`${rec.userId}-${rec.score}-${index}`}
                        className={`border-border/40 transition-colors ${
                          isSelf
                            ? "bg-primary/10 font-medium border-l-2 border-l-primary"
                            : "hover:bg-slate-800/40"
                        }`}
                      >
                        <TableCell className="font-mono text-sm font-bold text-center">
                          {rankIcons[index] ?? `#${index + 1}`}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Avatar className="h-6 w-6">
                              <AvatarImage src={rec.avatar} alt={rec.username} />
                              <AvatarFallback className="text-[10px] bg-slate-800">
                                {rec.username.slice(0, 2).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <span className="truncate max-w-[110px] text-xs font-semibold text-white">
                              {rec.username}
                              {isSelf && " (You)"}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono font-bold text-xs text-primary">
                          {rec.score.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-center text-xs text-emerald-400">
                          {rec.accuracy}%
                        </TableCell>
                        <TableCell className="text-center text-xs text-amber-400">
                          x{rec.maxCombo}
                        </TableCell>
                        <TableCell className="text-right text-[11px] text-muted-foreground whitespace-nowrap">
                          {rec.dateSet}
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-xs text-muted-foreground py-4">
                      No records logged yet. Be the first to set a score!
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="mt-4 flex flex-col sm:flex-row items-center justify-end gap-3 pt-2 border-t border-border/60">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="w-full sm:w-auto text-xs border-border/80 hover:bg-slate-800"
          >
            Close
          </Button>
          <Button
            variant="secondary"
            onClick={onNextTrack}
            className="w-full sm:w-auto text-xs border border-sky-500/40 hover:bg-sky-500/20 text-sky-300 font-semibold flex items-center gap-1.5"
          >
            <SkipForward className="h-4 w-4" /> Next Track
          </Button>
          <Button
            onClick={onSingAgain}
            className="w-full sm:w-auto text-xs bg-primary hover:bg-primary/90 text-primary-foreground font-bold shadow-[0_0_20px_hsl(var(--primary)/0.4)] flex items-center gap-1.5 neon-glow"
          >
            <RotateCcw className="h-4 w-4" /> Sing Again / Beat Record
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
