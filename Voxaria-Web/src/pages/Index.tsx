import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Circle,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Disc3,
  Flame,
  History,
  ListMusic,
  Loader2,
  Mic,
  MicOff,
  LogOut,
  Music,
  Pause,
  Play,
  Plus,
  Search,
  Server,
  Settings2,
  SkipBack,
  SkipForward,
  Square,
  Trash2,
  Shuffle,
  Trophy,
  UserCircle2,
  Volume2,
  X,
  Youtube,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { AuditLogViewer } from "@/components/AuditLogViewer";
import {
  ApiClientError,
  BASE_URL,
  mockData,
  setApiAuthContext,
  voxariaApi,
  type ApiKaraokeResponse,
  type ApiLyrics,
  type ApiPitchMap,
  type ApiPreset,
  type ApiSearchResult,
  type ApiTrack,
} from "@/lib/voxaria-api";
import { normalizeLyricsPayload } from "@/lib/voxaria-api";

type NavItem = { label: string; icon: typeof Disc3 };
type LyricLine = { text: string; timeSeconds: number };
type SessionUser = {
  id: string;
  discordId?: string;
  sessionToken?: string;
  name: string;
  roleLevel: number;
  avatar?: string;
  permissions: {
    dj: boolean;
    staff: boolean;
  };
};

type ApiPlayer = {
  id: string | null;
  title: string | null;
  artist: string | null;
  cleanedTitle?: string | null;
  cleanedArtist?: string | null;
  url?: string | null;
  uri?: string | null;
  trackUrl?: string | null;
  durationSec: number;
  positionSec: number;
  currentPositionMs?: number;
  currentPositionSec?: number;
  serverTimestampMs?: number | null;
  startTime?: number | null;
  lastPausedAt?: number | null;
  isPaused?: boolean;
  playing: boolean;
  art?: string | null;
  thumbnail?: string | null;
  requesterName?: string | null;
  requesterAvatar?: string | null;
  volume: number;
};

type PlayerData = ApiPlayer & {
  currentPositionSec: number;
  currentPositionMs: number;
};

const LYRIC_OFFSET_DEFAULT_MS = 0;
const LYRIC_CALIBRATION_STORAGE_KEY = "voxaria.lyricCalibrationOffsetMs";
const LYRIC_HOLD_WINDOW_MS = 3000;
const KARAOKE_SCORE_TICK_MS = 120;
const OCTAVE_TOLERANCE_SEMITONES = 1;
const KARAOKE_GATE_THRESHOLD_DB = -40;
const KARAOKE_MATCH_TOLERANCE_CENTS = 45;
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const navItems: NavItem[] = [
  { label: "Visualizer", icon: Disc3 },
  { label: "Queue", icon: ListMusic },
  { label: "Sessions", icon: History },
  { label: "Settings", icon: Settings2 },
  { label: "Shard", icon: Server },
];

const formatSec = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = `${Math.floor(s % 60)}`.padStart(2, "0");
  return `${m}:${sec}`;
};

const formatMsToClock = (value: number | undefined) => {
  if (!Number.isFinite(value) || !value || value < 0) return "0:00";
  const totalSec = Math.floor(value / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = `${totalSec % 60}`.padStart(2, "0");
  return `${min}:${sec}`;
};

const resolveUiErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof ApiClientError) {
    if (error.status === 404 && /no active voice connection/i.test(error.apiMessage)) {
      return "No active voice connection. Join a voice channel first.";
    }
    if (error.status >= 500 && /lavalink/i.test(error.apiMessage)) {
      return "Audio service unavailable (Lavalink). Please retry shortly.";
    }
    return error.apiMessage || fallback;
  }

  if (error instanceof Error && error.message?.trim()) return error.message;
  return fallback;
};

const getPresetId = (preset: ApiPreset) => preset.id ?? preset.name;


const queueRow = (
  track: ApiTrack,
  index: number,
  onDelete: (index: number) => void,
  onDragStart: (index: number) => void,
  onDrop: (newIndex: number) => void,
  isDragging: boolean,
  canManageQueue: boolean,
) => (
  <article
    key={track.id}
    draggable={canManageQueue}
    onDragStart={() => canManageQueue && onDragStart(index)}
    onDragOver={(e) => e.preventDefault()}
    onDrop={() => canManageQueue && onDrop(index)}
    className={`grid items-center gap-2 rounded-md border border-border/70 bg-panel/80 p-2 transition hover:border-primary/55 hover:neon-glow ${
      canManageQueue ? "grid-cols-[20px_38px_1fr_52px_28px_28px]" : "grid-cols-[38px_1fr_52px_28px]"
    } ${
      isDragging ? "opacity-55" : ""
    }`}
  >
    {canManageQueue && (
      <button
        type="button"
        className="flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent/35 hover:text-primary"
        aria-label="Drag queue item"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
    )}

    {track.artworkUrl ? (
      <img src={track.artworkUrl} alt={`${track.title} cover`} loading="lazy" className="h-9 w-9 rounded object-cover" />
    ) : (
      <div className="flex h-9 w-9 items-center justify-center rounded border border-border bg-panel-soft">
        <Disc3 className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
    )}

    <div className="min-w-0">
      <p className="truncate text-xs font-semibold text-foreground">{track.title}</p>
      <p className="truncate text-[11px] text-muted-foreground">{track.author}</p>
    </div>

    <p className="text-[10px] text-muted-foreground">{formatMsToClock(track.length)}</p>

    {track.requesterAvatar ? (
      <img
        src={track.requesterAvatar}
        alt={`${track.requesterName ?? track.requestedBy ?? "Requester"} avatar`}
        loading="lazy"
        className="h-7 w-7 rounded-full border border-border object-cover"
      />
    ) : (
      <div className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-panel-soft">
        <UserCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
    )}

    {canManageQueue && (
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="h-7 w-7 text-muted-foreground hover:bg-accent/35 hover:text-primary"
        onClick={() => onDelete(index)}
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    )}
  </article>
);

const getLyricLineClassName = (idx: number, activeLine: number) => {
  if (idx === activeLine) {
    return "text-primary font-bold scale-[1.08] drop-shadow-[0_0_16px_hsl(var(--primary)/0.6)]";
  }

  if (idx < activeLine) {
    return "text-muted-foreground/50 font-medium scale-[0.96]";
  }

  return "text-muted-foreground/80 font-medium scale-[0.96]";
};

const midiToFrequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

const midiToNoteLabel = (midi: number) => {
  const noteIndex = ((Math.round(midi) % 12) + 12) % 12;
  const octave = Math.floor(Math.round(midi) / 12) - 1;
  return `${NOTE_NAMES[noteIndex]}${octave}`;
};

const detectPitchFromAutocorrelation = (samples: ArrayLike<number>, sampleRate: number) => {
  const size = samples.length;
  if (size < 2) return 0;

  let rms = 0;
  for (let i = 0; i < size; i += 1) rms += samples[i] * samples[i];
  rms = Math.sqrt(rms / size);
  if (rms < 0.008) return 0;

  const correlations = new Float32Array(size);
  for (let lag = 0; lag < size; lag += 1) {
    let sum = 0;
    for (let i = 0; i < size - lag; i += 1) {
      sum += samples[i] * samples[i + lag];
    }
    correlations[lag] = sum;
  }

  let bestLag = -1;
  let bestCorrelation = 0;
  for (let lag = 8; lag < size / 2; lag += 1) {
    const correlation = correlations[lag];
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestLag = lag;
    }
  }

  if (bestLag <= 0) return 0;

  const prev = correlations[Math.max(0, bestLag - 1)] ?? 0;
  const next = correlations[Math.min(correlations.length - 1, bestLag + 1)] ?? 0;
  const current = correlations[bestLag] ?? 0;
  const denom = 2 * (2 * current - prev - next);
  const shift = denom !== 0 ? (next - prev) / denom : 0;
  const refinedLag = bestLag + shift;

  if (!Number.isFinite(refinedLag) || refinedLag <= 0) return 0;
  return sampleRate / refinedLag;
};

const Index = () => {
  const queryClient = useQueryClient();
  const API_BASE_URL = BASE_URL;

  const [searchTerm, setSearchTerm] = useState("");
  const [requestTerm, setRequestTerm] = useState("");
  const [lyricsData, setLyricsData] = useState<ApiLyrics | null>(null);
  const [activeLine, setActiveLine] = useState(0);
  const [lyricsUnavailable, setLyricsUnavailable] = useState(false);
  const [uiVolume, setUiVolume] = useState(100);
  const [syncOffsetMs, setSyncOffsetMs] = useState(() => {
    if (typeof window === "undefined") return LYRIC_OFFSET_DEFAULT_MS;
    const stored = window.localStorage.getItem(LYRIC_CALIBRATION_STORAGE_KEY);
    const parsed = stored ? Number(stored) : NaN;
    return Number.isFinite(parsed) ? parsed : LYRIC_OFFSET_DEFAULT_MS;
  });
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [lyricsOpen, setLyricsOpen] = useState(true);
  const [karaokeEnabled, setKaraokeEnabled] = useState(false);
  const [karaokeScore, setKaraokeScore] = useState(0);
  const [karaokeCombo, setKaraokeCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [scoreSummaryOpen, setScoreSummaryOpen] = useState(false);
  const [detectedPitchHz, setDetectedPitchHz] = useState<number | null>(null);
  const [userPitchMidi, setUserPitchMidi] = useState<number | null>(null);
  const [micVolumePercent, setMicVolumePercent] = useState(0);
  const [isSingingActive, setIsSingingActive] = useState(false);
  const [playlistBuilderQuery, setPlaylistBuilderQuery] = useState("");
  const [debouncedPlaylistQuery, setDebouncedPlaylistQuery] = useState("");
  const [playlistImportUrl, setPlaylistImportUrl] = useState("");
  const [newPresetName, setNewPresetName] = useState("");
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [isFetchingLyrics, setIsFetchingLyrics] = useState(false);
  const [isGeneratingKaraoke, setIsGeneratingKaraoke] = useState(false);
  const [currentPitchMap, setCurrentPitchMap] = useState<ApiPitchMap | null>(null);
  const [interpolatedPositionMs, setInterpolatedPositionMs] = useState(0);
  const [currentPlaybackTimeSec, setCurrentPlaybackTimeSec] = useState(0);
  const [cachedTrackId, setCachedTrackId] = useState<string | null>(null);
  const [cachedPitchTrackId, setCachedPitchTrackId] = useState<string | null>(null);

  const animationFrameRef = useRef<number | null>(null);
  const karaokeAnimationRef = useRef<number | null>(null);
  const karaokeIntervalRef = useRef<number | null>(null);
  const lyricsContainerRef = useRef<HTMLDivElement | null>(null);
  const activeLineRef = useRef(0);
  const smoothTimeRef = useRef(0);
  const currentPositionRef = useRef<HTMLSpanElement | null>(null);
  const totalDurationRef = useRef<HTMLSpanElement | null>(null);
  const karaokeStartTimeRef = useRef<number | null>(null);
  const karaokeScoreRef = useRef(0);
  const karaokeComboRef = useRef(0);
  const karaokeMaxComboRef = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micByteBufferRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const micFloatBufferRef = useRef<Float32Array<ArrayBuffer> | null>(null);
  const targetNoteMidiRef = useRef<number | null>(null);
  const latestPitchHzRef = useRef<number | null>(null);
  const userPitchMidiRef = useRef<number | null>(null);
  const pitchCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cursorYRef = useRef<number | null>(null);
  const lyricsRetryTimerRef = useRef<number | null>(null);
  const fetchPitchTimeoutRef = useRef<number | null>(null);
  const lyricsRetryElapsedRef = useRef<number>(0);
  const loadedPitchTrackIdRef = useRef<string | null>(null);
  const matchingTimeMsRef = useRef<number>(0);
  const pitchCacheRef = useRef<number[]>([]);
  const vocalKeyOffsetRef = useRef<number>(0);
  const validNoteDiffsRef = useRef<number[]>([]);
  const [pitchBlocks, setPitchBlocks] = useState<Array<{ note: number; start: number; duration: number }>>([]);
  const backendClockRef = useRef({ positionMs: 0, receivedAt: 0, paused: true, durationMs: 0 });
  const lastClockEmitRef = useRef(0);
  const frameCountRef = useRef(0);

  const [sessionUsers, setSessionUsers] = useState<SessionUser[]>([]);
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null);

  const queue = useQuery({ queryKey: ["queue"], queryFn: voxariaApi.getQueue, refetchInterval: 10000 });
  const history = useQuery({ queryKey: ["history"], queryFn: async () => voxariaApi.getHistory().catch(() => mockData.history), refetchInterval: 14000 });
  const status = useQuery({ queryKey: ["status"], queryFn: async () => voxariaApi.getStatus().catch(() => mockData.status), refetchInterval: 10000 });
  const cache = useQuery({ queryKey: ["cache"], queryFn: async () => voxariaApi.getCache().catch(() => mockData.cache), refetchInterval: 15000 });
  const settings = useQuery({ queryKey: ["settings"], queryFn: async () => voxariaApi.getSettings().catch(() => mockData.settings) });
  const player = useQuery<PlayerData | null>({
    queryKey: ["player"],
    queryFn: async () => {
      const startedAt = Date.now();
      try {
        const data = await voxariaApi.getPlayer();
        const elapsed = Math.max(0, Date.now() - startedAt);
        const serverTimestampMs = data.serverTimestampMs ?? Date.now();
        const latencyCompensationSec = data.playing && !data.isPaused ? elapsed / 2000 : 0;
        const driftSec = Math.max(0, (Date.now() - serverTimestampMs) / 1000);

        return {
          id: data.id ?? null,
          title: data.title,
          artist: data.artist,
          cleanedTitle: data.cleanedTitle,
          cleanedArtist: data.cleanedArtist,
          url: data.url,
          uri: data.uri,
          trackUrl: data.trackUrl,
          durationSec: data.durationSec,
          positionSec: data.positionSec,
          currentPositionMs: data.currentPositionMs,
          currentPositionSec: data.currentPositionSec + latencyCompensationSec + driftSec,
          serverTimestampMs: data.serverTimestampMs,
          startTime: data.startTime,
          lastPausedAt: data.lastPausedAt,
          isPaused: data.isPaused,
          playing: data.playing,
          art: data.art,
          thumbnail: data.thumbnail,
          requesterName: data.requesterName,
          requesterAvatar: data.requesterAvatar,
          volume: data.volume,
        } as PlayerData;
      } catch (error) {
        console.error("Player polling failed:", error);
        throw error;
      }
    },
    refetchInterval: 2000,
  });
  const presets = useQuery({ queryKey: ["presets"], queryFn: voxariaApi.getPresets, refetchInterval: 30000 });
  const activeGuildId = useMemo(() => {
    const settingsData = (settings.data as {
      guildId?: string;
      loggedInUser?: { discordId?: string; sessionToken?: string };
      sessionToken?: string;
    } | undefined) ?? {};

    const fromSettings = settingsData.guildId?.trim();
    if (fromSettings) return fromSettings;
    const fromEnv = import.meta.env.VITE_VOXARIA_GUILD_ID?.trim();
    if (fromEnv) return fromEnv;
    return "owner";
  }, [settings.data]);
  const activeUserDiscordId = useMemo(
    () => {
      const settingsData = (settings.data as {
        loggedInUser?: { discordId?: string; sessionToken?: string };
        sessionToken?: string;
      } | undefined) ?? {};

      return (
        currentUser?.discordId?.trim() ||
        settingsData.loggedInUser?.discordId?.trim() ||
        currentUser?.id?.trim() ||
        "owner"
      );
    },
    [currentUser?.discordId, currentUser?.id, settings.data],
  );
  const activeSessionToken = useMemo(() => {
    const settingsData = (settings.data as {
      loggedInUser?: { discordId?: string; sessionToken?: string };
      sessionToken?: string;
    } | undefined) ?? {};

    return (
      currentUser?.sessionToken?.trim() ||
      settingsData.sessionToken?.trim() ||
      settingsData.loggedInUser?.sessionToken?.trim() ||
      undefined
    );
  }, [currentUser?.sessionToken, settings.data]);

  useEffect(() => {
    setApiAuthContext({
      guildId: activeGuildId,
      userId: activeUserDiscordId,
      sessionToken: activeSessionToken,
    });
  }, [activeGuildId, activeSessionToken, activeUserDiscordId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedPlaylistQuery(playlistBuilderQuery.trim());
    }, 400);

    return () => window.clearTimeout(timer);
  }, [playlistBuilderQuery]);

  const playlistSearch = useQuery({
    queryKey: ["playlist-search", debouncedPlaylistQuery],
    enabled: debouncedPlaylistQuery.length > 1,
    queryFn: async () => {
      try {
        return await voxariaApi.searchOnly(debouncedPlaylistQuery);
      } catch (error) {
        console.error("Catalog search failed:", error);
        return [];
      }
    },
    staleTime: 10000,
    retry: 1,
  });

  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: ["queue"] });
    void queryClient.invalidateQueries({ queryKey: ["history"] });
    void queryClient.invalidateQueries({ queryKey: ["status"] });
    void queryClient.invalidateQueries({ queryKey: ["cache"] });
    void queryClient.invalidateQueries({ queryKey: ["player"] });
  };

  const searchMutation = useMutation({
    mutationFn: async ({ query, guildId }: { query: string; guildId: string }) => voxariaApi.search(query, guildId),
    onSuccess: () => {
      toast({ title: "Queued", description: "Search request sent to Voxaria." });
      refreshAll();
    },
    onError: () => toast({ title: "Search failed", description: "Could not reach backend endpoint.", variant: "destructive" }),
  });

  const requestMutation = useMutation({
    mutationFn: async ({ query, guildId }: { query: string; guildId: string }) => voxariaApi.requestSong(query, guildId),
    onSuccess: () => {
      toast({ title: "Request submitted", description: "Song request pushed to queue." });
      setRequestTerm("");
      void queryClient.invalidateQueries({ queryKey: ["queue"] });
    },
    onError: (error) => {
      console.log("Song request failed:", error instanceof Error ? error.message : error);
      toast({
        title: "Request failed",
        description: resolveUiErrorMessage(error, "Could not submit request."),
        variant: "destructive",
      });
    },
  });

  const playbackMutation = useMutation({
    mutationFn: voxariaApi.playback,
    onSuccess: refreshAll,
    onError: () => toast({ title: "Control failed", description: "Playback action could not be completed.", variant: "destructive" }),
  });

  const previousTrackMutation = useMutation({
    mutationFn: voxariaApi.previousTrack,
    onSuccess: refreshAll,
    onError: () => toast({ title: "Control failed", description: "Could not jump to previous track.", variant: "destructive" }),
  });

  const clearQueueMutation = useMutation({
    mutationFn: voxariaApi.clearQueue,
    onSuccess: () => {
      toast({ title: "Queue cleared" });
      refreshAll();
    },
  });

  const summonBotMutation = useMutation({
    mutationFn: ({ guildId }: { guildId: string }) => voxariaApi.summonBot(guildId),
    onSuccess: () => toast({ title: "Summon sent", description: "Voxaria join request sent." }),
    onError: (error) =>
      toast({
        title: "Summon failed",
        description: resolveUiErrorMessage(error, "Could not send join request."),
        variant: "destructive",
      }),
  });

  const leaveMutation = useMutation({
    mutationFn: voxariaApi.leaveVoice,
    onSuccess: () => toast({ title: "Disconnected", description: "Voxaria left the voice channel." }),
  });

  const cleanCacheMutation = useMutation({
    mutationFn: voxariaApi.cleanAudioCache,
    onSuccess: () => {
      toast({ title: "Cache cleaned", description: "Audio cache clean command sent." });
      void queryClient.invalidateQueries({ queryKey: ["cache"] });
    },
  });

  const volumeMutation = useMutation({ mutationFn: voxariaApi.setVolume, onSuccess: refreshAll });

  const reorderQueueMutation = useMutation({
    mutationFn: ({ oldIndex, newIndex }: { oldIndex: number; newIndex: number }) => voxariaApi.reorderQueue(oldIndex, newIndex),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["queue"] }),
    onError: () => toast({ title: "Reorder failed", description: "Could not reorder queue item.", variant: "destructive" }),
  });

  const deleteQueueItemMutation = useMutation({
    mutationFn: (index: number) => voxariaApi.deleteQueueItem(index),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["queue"] }),
    onError: () => toast({ title: "Delete failed", description: "Could not remove queue item.", variant: "destructive" }),
  });

  const createPresetMutation = useMutation({
    mutationFn: (name: string) => voxariaApi.createPreset(name),
    onSuccess: async (_response, name) => {
      toast({ title: "Playlist created" });
      const trimmedName = name.trim();
      setNewPresetName("");
      await queryClient.invalidateQueries({ queryKey: ["presets"] });
      const refreshed = (queryClient.getQueryData(["presets"]) as ApiPreset[] | undefined) ?? [];
      const created = refreshed.find((preset) => preset.name === trimmedName);
      if (created) setActivePresetId(getPresetId(created));
    },
    onError: () => toast({ title: "Create failed", description: "Could not create playlist.", variant: "destructive" }),
  });

  const deletePresetMutation = useMutation({
    mutationFn: (presetId: string) => voxariaApi.deletePreset(presetId),
    onSuccess: () => {
      toast({ title: "Playlist deleted" });
      void queryClient.invalidateQueries({ queryKey: ["presets"] });
    },
    onError: () => toast({ title: "Delete failed", description: "Could not delete playlist.", variant: "destructive" }),
  });

  const addTrackToPresetMutation = useMutation({
    mutationFn: ({ presetId, track }: { presetId: string; track: ApiSearchResult }) =>
      voxariaApi.addTrackToPreset(presetId, track),
    onSuccess: async () => {
      toast({ title: "Track added" });
      await queryClient.invalidateQueries({ queryKey: ["presets"] });
      await queryClient.refetchQueries({ queryKey: ["presets"], type: "active" });
    },
    onError: () => toast({ title: "Add failed", description: "Could not add track to playlist.", variant: "destructive" }),
  });

  const removeTrackFromPresetMutation = useMutation({
    mutationFn: ({ presetId, trackIndex }: { presetId: string; trackIndex: number }) =>
      voxariaApi.removeTrackFromPreset(presetId, trackIndex),
    onSuccess: async () => {
      toast({ title: "Track removed" });
      await queryClient.invalidateQueries({ queryKey: ["presets"] });
      await queryClient.refetchQueries({ queryKey: ["presets"], type: "active" });
    },
    onError: () => toast({ title: "Remove failed", description: "Could not remove track.", variant: "destructive" }),
  });

  const importPlaylistToPresetMutation = useMutation({
    mutationFn: ({ presetId, url }: { presetId: string; url: string }) => voxariaApi.importPlaylistToPreset(presetId, url),
    onSuccess: async (response) => {
      const addedCount = response?.added ?? 0;
      toast({
        title: "Playlist imported",
        description: `Added ${addedCount} track${addedCount === 1 ? "" : "s"}.`,
      });
      setPlaylistImportUrl("");
      await queryClient.invalidateQueries({ queryKey: ["presets"] });
      await queryClient.refetchQueries({ queryKey: ["presets"], type: "active" });
    },
    onError: () =>
      toast({
        title: "Import failed",
        description: "Could not import playlist URL.",
        variant: "destructive",
      }),
  });

  const shuffleQueueMutation = useMutation({
    mutationFn: voxariaApi.shuffleQueue,
    onSuccess: () => {
      toast({ title: "Queue shuffled" });
      void queryClient.invalidateQueries({ queryKey: ["queue"] });
    },
    onError: () => toast({ title: "Shuffle failed", description: "Could not shuffle queue.", variant: "destructive" }),
  });

  const currentTrack = useMemo(
    () => {
      const rawId = (player.data?.id ?? "").trim();
      const cleanTitle = (player.data?.cleanedTitle ?? player.data?.title ?? "").trim();
      const cleanArtist = (player.data?.cleanedArtist ?? player.data?.artist ?? "").trim();
      
      // Fallback: If no track ID is accessible (or evaluates to 'undefined'), generate a sanitized slug
      const fallbackId = `${cleanTitle.toLowerCase().replace(/[^a-z0-9]/g, "_")}_${cleanArtist.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;
      const finalId = (rawId && rawId !== "undefined") ? rawId : fallbackId;

      return {
        title: cleanTitle,
        artist: cleanArtist,
        url: (player.data?.trackUrl ?? player.data?.url ?? player.data?.uri ?? "").trim(),
        id: finalId,
      };
    },
    [player.data?.cleanedTitle, player.data?.title, player.data?.cleanedArtist, player.data?.artist, player.data?.trackUrl, player.data?.url, player.data?.uri, player.data?.id],
  );

  const currentTrackKey = `${currentTrack.title}::${currentTrack.artist}`;
  const normalizedLyrics = useMemo(
    () => (lyricsData?.hasSynced ? lyricsData.lines : []),
    [lyricsData?.hasSynced, lyricsData?.lines],
  );
  const presetsData = presets.data ?? [];
  const activePreset = useMemo(
    () => presetsData.find((preset) => getPresetId(preset) === activePresetId) ?? null,
    [presetsData, activePresetId],
  );
  const activePresetTracks = activePreset?.items ?? [];

  useEffect(() => {
    setLyricsData(null);
    setLyricsUnavailable(false);
    setActiveLine(0);
    setCurrentPitchMap(null);
    setCachedTrackId(null);
    setCachedPitchTrackId(null);
    loadedPitchTrackIdRef.current = null;
    vocalKeyOffsetRef.current = 0;
    validNoteDiffsRef.current = [];
  }, [currentTrackKey]);

  const coercePitchMap = (payload: ApiKaraokeResponse): ApiPitchMap | null => {
    const candidate = payload.pitchMap ?? payload;
    if (!candidate?.frames?.length) return null;
    return {
      title: candidate.title ?? currentTrack.title,
      artist: candidate.artist ?? currentTrack.artist,
      frames: candidate.frames,
    };
  };

  const refreshLyrics = async () => {
    if (!currentTrack.title) {
      toast({ title: "No track playing", description: "Wait for a track before refreshing lyrics.", variant: "destructive" });
      return;
    }

    setIsFetchingLyrics(true);
    try {
      const response = await voxariaApi.fetchLyrics(currentTrack.title, currentTrack.artist, activeGuildId);
      const hasAnyLyrics = Boolean(response.lines.length || response.plain?.trim());

      if (!hasAnyLyrics) {
        setLyricsData(null);
        setLyricsUnavailable(true);
        setActiveLine(0);
        toast({ title: "Failed to find lyrics", variant: "destructive" });
        return;
      }

      setLyricsData({
        title: response.title || currentTrack.title,
        artist: response.artist || currentTrack.artist || "Unknown artist",
        source: response.source || "unknown",
        plain: response.plain || "",
        synced: response.synced || "",
        hasSynced: response.hasSynced,
        lines: response.lines ?? [],
      });
      setLyricsUnavailable(false);
      if (response.hasSynced && response.lines.length) {
        const adjustedPositionSec = (player.data?.currentPositionSec ?? 0) + (player.data?.playing && !player.data?.isPaused ? 0.1 : 0);
        const startingLine = Math.max(
          0,
          response.lines.reduce((last, line, index) => (line.timeSeconds <= adjustedPositionSec ? index : last), 0),
        );
        setActiveLine(startingLine);
        requestAnimationFrame(() => {
          lyricsContainerRef.current
            ?.querySelector<HTMLElement>(`[data-lyric-index='${startingLine}']`)
            ?.scrollIntoView({ block: "center", behavior: "smooth" });
        });
      } else {
        setActiveLine(0);
      }
      toast({ title: "Lyrics synced", description: "Lyrics refreshed successfully." });
    } catch (error) {
      console.error("Refresh lyrics failed:", error);
      setLyricsData(null);
      setLyricsUnavailable(true);
      setActiveLine(0);
      toast({ title: "Failed to find lyrics", variant: "destructive" });
    } finally {
      setIsFetchingLyrics(false);
    }
  };

  useEffect(() => {
    activeLineRef.current = activeLine;
  }, [activeLine]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LYRIC_CALIBRATION_STORAGE_KEY, `${Math.round(syncOffsetMs)}`);
  }, [syncOffsetMs]);

  useEffect(() => {
    if (!player.data) return;

    const now = performance.now();
    const positionMs = Math.max(0, Math.round((player.data.positionSec ?? 0) * 1000));
    const durationMs = Math.max(0, Math.round((player.data.durationSec ?? 0) * 1000));
    const paused = Boolean(player.data.isPaused ?? !player.data.playing);

    backendClockRef.current = {
      positionMs,
      receivedAt: now,
      paused,
      durationMs,
    };

    smoothTimeRef.current = positionMs;
    setInterpolatedPositionMs(positionMs);
  }, [player.data?.positionSec, player.data?.durationSec, player.data?.isPaused, player.data?.playing]);

  useEffect(() => {
    const tick = () => {
      const now = performance.now();
      const { positionMs, receivedAt, paused, durationMs } = backendClockRef.current;
      const elapsed = paused ? 0 : now - receivedAt;
      const nextMs = durationMs > 0 ? Math.min(durationMs, positionMs + elapsed) : Math.max(0, positionMs + elapsed);

      smoothTimeRef.current = nextMs;

      if (now - lastClockEmitRef.current >= 33) {
        lastClockEmitRef.current = now;
        setInterpolatedPositionMs(nextMs);
      }

      animationFrameRef.current = requestAnimationFrame(tick);
    };

    animationFrameRef.current = requestAnimationFrame(tick);
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, []);

  useEffect(() => {
    const playbackPositionSec = Math.max(0, interpolatedPositionMs / 1000);
    setCurrentPlaybackTimeSec(playbackPositionSec);
  }, [interpolatedPositionMs]);

  useEffect(() => {
    const adjustedMs = Math.max(0, (player.data?.currentPositionSec ?? 0) * 1000 - syncOffsetMs);
    smoothTimeRef.current = adjustedMs;

    if (currentPositionRef.current) {
      currentPositionRef.current.textContent = formatSec(adjustedMs / 1000);
    }

    if (totalDurationRef.current) {
      totalDurationRef.current.textContent = formatSec(player.data?.durationSec ?? 0);
    }

    if (!normalizedLyrics.length) return;

    let resolved = -1;
    for (let index = normalizedLyrics.length - 1; index >= 0; index -= 1) {
      if (normalizedLyrics[index].timeSeconds <= currentPlaybackTimeSec) {
        resolved = index;
        break;
      }
    }

    if (resolved !== activeLineRef.current) {
      activeLineRef.current = resolved;
      setActiveLine(resolved);
      if (resolved >= 0) {
        const target = lyricsContainerRef.current?.querySelector<HTMLElement>(`[data-lyric-index='${resolved}']`);
        target?.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    }
  }, [currentPlaybackTimeSec, interpolatedPositionMs, normalizedLyrics, player.data?.currentPositionSec, player.data?.durationSec, syncOffsetMs]);

  useEffect(() => {
    if (!lyricsData?.hasSynced || !normalizedLyrics.length) return;

    const adjustedPositionSec = player.data?.currentPositionSec ?? 0;
    const startingLine = Math.max(
      0,
      normalizedLyrics.reduce((last, line, index) => (line.timeSeconds <= adjustedPositionSec ? index : last), 0),
    );

    if (startingLine !== activeLineRef.current) {
      activeLineRef.current = startingLine;
      setActiveLine(startingLine);
      requestAnimationFrame(() => {
        lyricsContainerRef.current
          ?.querySelector<HTMLElement>(`[data-lyric-index='${startingLine}']`)
          ?.scrollIntoView({ block: "center", behavior: "smooth" });
      });
    }
  }, [lyricsData?.hasSynced, normalizedLyrics, player.data?.currentPositionSec]);

  useEffect(() => {
    if (typeof player.data?.volume === "number") {
      setUiVolume(Math.min(200, Math.max(0, player.data.volume)));
    }
  }, [player.data?.volume]);

  const cacheProgress = useMemo(() => {
    if (!cache.data) return 0;
    return Math.min(100, Math.round((cache.data.sizeMb / cache.data.maxMb) * 100));
  }, [cache.data]);

  const playerProgress = useMemo(() => {
    if (!player.data || !player.data.durationSec) return 0;
    const currentSec = Math.max(interpolatedPositionMs / 1000, 0);
    return Math.min(100, Math.round((currentSec / player.data.durationSec) * 100));
  }, [interpolatedPositionMs, player.data?.durationSec]);

  const displayVolume = useMemo(() => Math.min(200, Math.max(0, Math.round(uiVolume))), [uiVolume]);
  const boostActive = displayVolume > 100;
  const streakMultiplier = Math.max(1, Math.floor(karaokeCombo / 4) + 1);
  const targetNoteDisplay =
    targetNoteMidiRef.current === null
      ? "--"
      : `${midiToNoteLabel(targetNoteMidiRef.current)} (${Math.round(midiToFrequency(targetNoteMidiRef.current))}Hz)`;
  const arenaBallOffsetPct = useMemo(() => {
    if (!detectedPitchHz || targetNoteMidiRef.current === null) return 50;
    const targetHz = midiToFrequency(targetNoteMidiRef.current);
    const semitoneDelta = 12 * Math.log2(detectedPitchHz / targetHz);
    return Math.max(5, Math.min(95, 50 + semitoneDelta * 10));
  }, [detectedPitchHz, currentPlaybackTimeSec]);

  const loading = queue.isLoading || status.isLoading || cache.isLoading || settings.isLoading || player.isLoading;
  const playerUnavailable = player.isError;
  const queueUnavailable = queue.isError;
  const lyricsServiceUnavailable = false;
  const isKaraokeActive = karaokeEnabled;
  const canManageQueue = Boolean(currentUser?.permissions.dj || currentUser?.permissions.staff);
  const canViewStaffTab = (currentUser?.roleLevel ?? 0) >= 2;
  const manageableUsers = useMemo(
    () => sessionUsers.filter((user) => user.id !== currentUser?.id),
    [sessionUsers, currentUser?.id],
  );

  const createPreset = () => {
    const label = newPresetName.trim();
    if (!label) {
      toast({ title: "Name required", description: "Enter a playlist name.", variant: "destructive" });
      return;
    }
    createPresetMutation.mutate(label);
  };

  const addTrackToActivePreset = (track: ApiSearchResult) => {
    if (!activePreset) {
      toast({ title: "Select a playlist", description: "Create or pick a playlist first.", variant: "destructive" });
      return;
    }

    const presetId = getPresetId(activePreset);
    addTrackToPresetMutation.mutate({ presetId, track });
    setPlaylistBuilderQuery("");
    setDebouncedPlaylistQuery("");
  };

  const removeTrackFromActivePreset = (trackIndex: number) => {
    if (!activePreset) return;
    const presetId = getPresetId(activePreset);
    removeTrackFromPresetMutation.mutate({ presetId, trackIndex });
  };

  const handleDeployToQueue = async (tracks: any[]) => {
    if (!tracks || tracks.length === 0) {
      toast({ title: "No tracks available to deploy.", variant: "destructive" });
      return;
    }

    toast({ title: "Deploying playlist to live Discord queue..." });

    try {
      const authHeaders = activeSessionToken ? { Authorization: `Bearer ${activeSessionToken}` } : {};

      for (const track of tracks) {
        await fetch(`${API_BASE_URL}/music/request`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "ngrok-skip-browser-warning": "true",
            "x-guild-id": activeGuildId,
            "x-user-id": activeUserDiscordId,
            ...authHeaders,
          },
          body: JSON.stringify({
            query: track.url || track.title,
          }),
        });
      }
      toast({ title: "Entire playlist successfully appended to the live queue!" });
    } catch (error) {
      toast({ title: "An error occurred while deploying the playlist.", variant: "destructive" });
    }
  };

  const importExternalPlaylist = () => {
    if (!activePreset) {
      toast({ title: "Select a playlist", description: "Create or pick a playlist first.", variant: "destructive" });
      return;
    }

    const url = playlistImportUrl.trim();
    if (!url) {
      toast({ title: "URL required", description: "Paste a playlist URL to import.", variant: "destructive" });
      return;
    }

    const presetId = getPresetId(activePreset);
    importPlaylistToPresetMutation.mutate({ presetId, url });
  };

  const deletePreset = (preset: ApiPreset) => {
    const presetId = getPresetId(preset);
    deletePresetMutation.mutate(presetId, {
      onSuccess: () => {
        if (activePresetId === presetId) {
          const remaining = presetsData.filter((item) => getPresetId(item) !== presetId);
          setActivePresetId(remaining[0] ? getPresetId(remaining[0]) : null);
        }
      },
    });
  };

  const handleLyricSync = (idx: number, lineTimeSeconds: number) => {
    const clickedLineTime = lineTimeSeconds * 1000;
    const currentSmoothTime = Math.max(0, (player.data?.currentPositionSec ?? 0) * 1000);
    const newOffset = clickedLineTime - currentSmoothTime;

    setSyncOffsetMs(newOffset);
    setActiveLine(idx);
    toast({ title: "Syncing...", description: "Lyric calibration updated." });
  };

  const handleDrop = useCallback(
    (newIndex: number) => {
      if (!canManageQueue) return;
      if (dragIndex === null || dragIndex === newIndex) return;
      reorderQueueMutation.mutate({ oldIndex: dragIndex, newIndex });
      setDragIndex(null);
    },
    [canManageQueue, dragIndex, reorderQueueMutation],
  );

  const toggleUserPermission = (userId: string, permission: "dj" | "staff") => {
    setSessionUsers((prev) =>
      prev.map((user) =>
        user.id === userId
          ? {
              ...user,
              permissions: {
                ...user.permissions,
                [permission]: !user.permissions[permission],
              },
            }
          : user,
      ),
    );
  };

  const loginWithDiscord = () => {
    // Redirect to backend OAuth2 passport mount
    window.location.href = `${API_BASE_URL}/auth/discord`;
  };

  const fetchSession = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/auth/session`, {
        headers: { "ngrok-skip-browser-warning": "true" },
        credentials: "include"
      });
      // 401 is expected when no session exists — silently ignore it
      if (!response.ok) return false;
      const data = await response.json();
      if (data && data.success && data.loggedInUser) {
        setCurrentUser(data.loggedInUser);
        return true;
      }
      // Also handle the standard { user: {...} } format returned by the backend
      if (data && data.user) {
        const roleLevel = data.user.role ?? 0;
        setCurrentUser({
          id: data.user.id,
          name: data.user.username ?? data.user.global_name ?? data.user.id,
          discordId: data.user.id,
          sessionToken: undefined,
          avatar: data.user.avatar,
          roleLevel,
          permissions: {
            dj: roleLevel >= 1,
            staff: roleLevel >= 2,
          },
        });
        return true;
      }
    } catch (err) {
      // Network errors are expected when backend is offline
    }
    return false;
  }, [API_BASE_URL]);


  // Check auth session on app mount and handle redirect URL success flag
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const hasLoginSuccess = urlParams.get('login_status') === 'success';
    const userParam = urlParams.get('user');

    if (hasLoginSuccess) {
      if (userParam) {
        try {
          const decodedUser = JSON.parse(decodeURIComponent(userParam));
          if (decodedUser && decodedUser.name) {
            setCurrentUser(decodedUser);
            localStorage.setItem('vx_user_fallback', JSON.stringify(decodedUser));
          }
        } catch (e) {
          console.error("Failed to parse fallback user from URL:", e);
        }
      }
      // Clean up the URL bar cleanly so the parameter disappears from view
      window.history.replaceState({}, document.title, window.location.pathname);
    } else {
      // Check if we have a cached fallback user in localStorage
      const cachedUser = localStorage.getItem('vx_user_fallback');
      if (cachedUser) {
        try {
          const parsed = JSON.parse(cachedUser);
          if (parsed && parsed.name) {
            setCurrentUser(parsed);
          }
        } catch (e) {
          console.error("Failed to parse cached user:", e);
        }
      }
    }

    void fetchSession().then((success) => {
      if (hasLoginSuccess && success) {
        toast({
          title: "Welcome back!",
          description: "Successfully authenticated with Discord.",
        });
      }
    });
  }, [fetchSession, toast]);

  const logoutDiscord = async () => {
    try {
      await fetch(`${API_BASE_URL}/auth/logout`, {
        method: "POST",
        headers: { "ngrok-skip-browser-warning": "true" },
        credentials: "include"
      });
    } catch (err) {
      console.error("Failed to log out from backend:", err);
    }
    localStorage.removeItem('vx_user_fallback');
    setCurrentUser(null);
    toast({ title: "Logged out", description: "Role-gated controls are now hidden." });
  };

  const getNearestPitchSemitone = useCallback((frames: ApiPitchMap["frames"], atMs: number) => {
    if (!frames.length) return null;

    let nearest = frames[0];
    for (let i = 1; i < frames.length; i += 1) {
      const candidate = frames[i];
      if (Math.abs(candidate.timeMs - atMs) < Math.abs(nearest.timeMs - atMs)) nearest = candidate;
    }

    return nearest.midi % 12;
  }, []);

  const getNearestPitchFrame = useCallback((frames: ApiPitchMap["frames"], atMs: number) => {
    if (!frames.length) return null;

    let nearest = frames[0];
    for (let i = 1; i < frames.length; i += 1) {
      const candidate = frames[i];
      if (Math.abs(candidate.timeMs - atMs) < Math.abs(nearest.timeMs - atMs)) nearest = candidate;
    }

    return nearest;
  }, []);

  const startKaraoke = async () => {
    if (isGeneratingKaraoke) return;
    if (!activeGuildId || !currentTrack.url) {
      toast({
        title: "Karaoke unavailable",
        description: "Current track URL is missing, so karaoke processing cannot start.",
        variant: "destructive",
      });
      return;
    }

    setIsGeneratingKaraoke(true);
    try {
      const karaokePayload = await voxariaApi.startKaraoke(activeGuildId, currentTrack.url);

      // Check if the backend returned a 'processing' status (stem separation in progress)
      const isProcessing = (karaokePayload as { status?: string }).status === "processing";
      const nextPitchMap = coercePitchMap(karaokePayload);

      // If stems are not ready yet, start karaoke optimistically — fetchPitchData will poll
      if (!nextPitchMap && !isProcessing) {
        throw new Error("Pitch map unavailable");
      }

      if (nextPitchMap) {
        setCurrentPitchMap(nextPitchMap);
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const highPass = audioContext.createBiquadFilter();
      highPass.type = "highpass";
      highPass.frequency.value = 80;

      const lowPass = audioContext.createBiquadFilter();
      lowPass.type = "lowpass";
      lowPass.frequency.value = 1000;

      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(highPass);
      highPass.connect(lowPass);
      lowPass.connect(analyser);

      mediaStreamRef.current = stream;
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      micByteBufferRef.current = new Uint8Array(new ArrayBuffer(analyser.fftSize));
      micFloatBufferRef.current = new Float32Array(new ArrayBuffer(analyser.fftSize * Float32Array.BYTES_PER_ELEMENT));
      targetNoteMidiRef.current = null;

      setKaraokeEnabled(true);
      void fetchPitchData();
      void refreshLyrics();
      setKaraokeScore(0);
      setKaraokeCombo(0);
      setMaxCombo(0);
      setMicVolumePercent(0);
      setIsSingingActive(false);
      karaokeScoreRef.current = 0;
      karaokeComboRef.current = 0;
      karaokeMaxComboRef.current = 0;
      karaokeStartTimeRef.current = Date.now();
      setScoreSummaryOpen(false);
 
      if (isProcessing) {
        toast({
          title: "Karaoke processing…",
          description: "Stem separation is running. Pitch map will appear shortly — sing along once it loads!",
        });
      } else {
        toast({ title: "Karaoke ready", description: "Pitch map generated and karaoke mode started." });
      }
    } catch (error) {
      console.error("Start karaoke failed:", error);
      toast({ title: "Karaoke failed", description: "Could not generate karaoke pitch map.", variant: "destructive" });
    } finally {
      setIsGeneratingKaraoke(false);
    }
  };


  const stopKaraoke = useCallback(() => {
    if (karaokeAnimationRef.current) cancelAnimationFrame(karaokeAnimationRef.current);
    if (karaokeIntervalRef.current) window.clearInterval(karaokeIntervalRef.current);
    if (lyricsRetryTimerRef.current) {
      window.clearInterval(lyricsRetryTimerRef.current);
      lyricsRetryTimerRef.current = null;
    }
    karaokeAnimationRef.current = null;
    karaokeIntervalRef.current = null;

    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;

    if (audioContextRef.current) {
      void audioContextRef.current.close();
      audioContextRef.current = null;
    }

    analyserRef.current = null;
    micByteBufferRef.current = null;
    micFloatBufferRef.current = null;
    targetNoteMidiRef.current = null;
    latestPitchHzRef.current = null;
    userPitchMidiRef.current = null;
    setUserPitchMidi(null);
    setDetectedPitchHz(null);
    setMicVolumePercent(0);
    setIsSingingActive(false);
    setKaraokeEnabled(false);
  }, []);

  const handleHotReload = async () => {
    console.log("🔄 [HOT RELOAD] Initiating forced arena session sync...");
    
    if (!currentTrack.title) return;

    // 1. Force state parameters to temporarily drop out so hooks recognize a hard change
    setLyricsData(null);
    setPitchBlocks([]);
    
    // 2. Manually invoke existing fetch methods directly using the active playing track payload
    try {
      // Re-trigger the lyrics fetch call directly
      const response = await voxariaApi.fetchLyrics(currentTrack.title, currentTrack.artist, activeGuildId);
      const hasAnyLyrics = Boolean(response.lines.length || response.plain?.trim());
      if (hasAnyLyrics) {
        setLyricsData(response);
        setLyricsUnavailable(false);
      }

      // Re-trigger the pitch canvas binary data load pass directly
      const authHeaders = activeSessionToken ? { Authorization: `Bearer ${activeSessionToken}` } : {};
      const trackIdParam = currentTrack.url ? `?trackId=${encodeURIComponent(currentTrack.url)}` : (currentTrack.id ? `?trackId=${encodeURIComponent(currentTrack.id)}` : "");
      const pitchRes = await fetch(`${API_BASE_URL}/music/karaoke/pitch-data${trackIdParam}`, {
        headers: {
          "ngrok-skip-browser-warning": "true",
          "x-guild-id": activeGuildId,
          "x-user-id": activeUserDiscordId,
          ...authHeaders,
        },
      });
      const pitchData = await pitchRes.json();
      
      const convertToBlocks = (frames: any[]) => {
        if (!Array.isArray(frames)) return [];
        const validFrames = frames
          .filter(f => f && typeof f.timeMs === "number" && typeof f.midi === "number" && f.midi > 0)
          .sort((a, b) => a.timeMs - b.timeMs);

        if (validFrames.length === 0) return [];

        const groups: Array<{ note: number; start: number; duration: number }> = [];
        let currentGroup: any[] = [validFrames[0]];

        for (let i = 1; i < validFrames.length; i++) {
          const prev = currentGroup[currentGroup.length - 1];
          const curr = validFrames[i];
          const timeDiff = (curr.timeMs - prev.timeMs) / 1000;
          const pitchDiff = Math.abs(curr.midi - prev.midi);

          if (timeDiff < 0.15 && pitchDiff <= 0.5) {
            currentGroup.push(curr);
          } else {
            const start = currentGroup[0].timeMs / 1000;
            const lastTime = currentGroup[currentGroup.length - 1].timeMs / 1000;
            const duration = (lastTime - start) + 0.1;
            const avgMidi = currentGroup.reduce((sum, f) => sum + f.midi, 0) / currentGroup.length;
            groups.push({ start, duration, note: avgMidi });
            currentGroup = [curr];
          }
        }

        if (currentGroup.length > 0) {
          const start = currentGroup[0].timeMs / 1000;
          const lastTime = currentGroup[currentGroup.length - 1].timeMs / 1000;
          const duration = (lastTime - start) + 0.1;
          const avgMidi = currentGroup.reduce((sum, f) => sum + f.midi, 0) / currentGroup.length;
          groups.push({ start, duration, note: avgMidi });
        }
        return groups;
      };

      if (Array.isArray(pitchData) && pitchData.length > 0) {
        const blocks = convertToBlocks(pitchData);
        setPitchBlocks(blocks);
        setCurrentPitchMap({
          title: currentTrack.title,
          artist: currentTrack.artist,
          frames: pitchData,
        });
        setCachedPitchTrackId(currentTrack.id);
      } else if (pitchData && Array.isArray(pitchData.blocks) && pitchData.blocks.length > 0) {
        const blocks = convertToBlocks(pitchData.blocks);
        setPitchBlocks(blocks);
        setCurrentPitchMap({
          title: currentTrack.title,
          artist: currentTrack.artist,
          frames: pitchData.blocks,
        });
        setCachedPitchTrackId(currentTrack.id);
      } else if (pitchData && Array.isArray(pitchData.frames) && pitchData.frames.length > 0) {
        const blocks = convertToBlocks(pitchData.frames);
        setPitchBlocks(blocks);
        setCurrentPitchMap({
          title: currentTrack.title,
          artist: currentTrack.artist,
          frames: pitchData.frames,
        });
        setCachedPitchTrackId(currentTrack.id);
      }
      
      console.log("🚀 [HOT RELOAD] Arena synchronization complete! UI canvas updated cleanly.");
      toast({ title: "Arena reloaded", description: "Lyrics and pitch data synchronized successfully." });
    } catch (err) {
      console.error("❌ [HOT RELOAD] Hard sync manual fetch pass crashed: ", err);
      toast({ title: "Reload failed", description: "Could not synchronize arena stream.", variant: "destructive" });
    }
  };

  const handleRefreshLyrics = async () => {
    // Map internal states to structures expected by the requested worker function code
    const playerState = { track: currentTrack };
    const setLyrics = (val: any) => {
      if (val === null) {
        setLyricsData(null);
        setLyricsUnavailable(true);
      } else {
        // Let's pass the parsed output through normalizeLyricsPayload to ensure it conforms to ApiLyrics
        const normalized = normalizeLyricsPayload({
          title: currentTrack.title,
          artist: currentTrack.artist || "Unknown",
          source: "Refreshed API",
          plain: "",
          synced: "",
          hasSynced: true,
          lines: val
        });
        setLyricsData(normalized);
        setLyricsUnavailable(false);
      }
    };

    if (!playerState?.track) return;
    setLyrics(null); // Clear broken view state first
    
    try {
        const response = await fetch(`${API_BASE_URL}/music/lyrics`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-user-id': 'owner' },
            body: JSON.stringify({ 
                title: playerState.track.title, 
                artist: playerState.track.artist || 'Unknown',
                forceResync: true // Forces server to skip cached file reads
            })
        });
        const data = await response.json();
        if (data && data.lines) {
            setLyrics(data.lines);
            toast({ title: "Lyrics refreshed", description: "Manual resync of lyrics succeeded." });
        }
    } catch (err) {
        console.error("❌ Failed to force-sync text lines via manual handler: ", err);
        toast({ title: "Refresh failed", description: "Failed to force-sync text lines.", variant: "destructive" });
    }
  };

  const detectedNoteLabel = useMemo(() => {
    if (!detectedPitchHz) return "--";
    const midi = Math.round(12 * Math.log2(detectedPitchHz / 440) + 69);
    return NOTE_NAMES[((midi % 12) + 12) % 12];
  }, [detectedPitchHz]);

  const pitchMatchDelta = useMemo(() => {
    if (!detectedPitchHz || targetNoteMidiRef.current === null) return Number.POSITIVE_INFINITY;
    const targetHz = midiToFrequency(targetNoteMidiRef.current);
    const targetMidi = 69 + 12 * Math.log2(targetHz / 440);
    const sungMidi = 69 + 12 * Math.log2(detectedPitchHz / 440);
    return Math.abs((sungMidi - targetMidi) * 100);
  }, [detectedPitchHz, currentPlaybackTimeSec]);

  const isPitchMatching = Number.isFinite(pitchMatchDelta) && pitchMatchDelta <= KARAOKE_MATCH_TOLERANCE_CENTS;

  const contestants = useMemo(
    () => [
      {
        id: currentUser?.id ?? "current",
        username: currentUser?.name ?? "You",
        streak: karaokeCombo,
        active: isSingingActive,
        score: karaokeScore,
        isCurrentUser: true,
      },
    ]
      .sort((a, b) => b.score - a.score)
      .map((contestant, index) => ({ ...contestant, rank: index + 1 })),
    [currentUser?.id, currentUser?.name, isSingingActive, karaokeCombo, karaokeScore, maxCombo],
  );

  useEffect(() => {
    if (!presetsData.length) {
      setActivePresetId(null);
      return;
    }

    if (!activePresetId || !presetsData.some((preset) => getPresetId(preset) === activePresetId)) {
      setActivePresetId(getPresetId(presetsData[0]));
    }
  }, [presetsData, activePresetId]);

  useEffect(() => {
    karaokeScoreRef.current = karaokeScore;
  }, [karaokeScore]);

  useEffect(() => {
    karaokeComboRef.current = karaokeCombo;
  }, [karaokeCombo]);

  useEffect(() => {
    karaokeMaxComboRef.current = maxCombo;
  }, [maxCombo]);

  useEffect(() => {
    if (!karaokeEnabled || !analyserRef.current || !micByteBufferRef.current || !micFloatBufferRef.current) return;

    const analyzer = analyserRef.current;
    const byteBuffer = micByteBufferRef.current;
    const floatBuffer = micFloatBufferRef.current;
    const VOCAL_ENERGY_THRESHOLD = 0.03; // RMS energy threshold constant for noise gate

    const detectFrame = () => {
      analyzer.getByteTimeDomainData(byteBuffer as unknown as Uint8Array<ArrayBuffer>);
      analyzer.getFloatTimeDomainData(floatBuffer as unknown as Float32Array<ArrayBuffer>);

      // 1. Calculate the RMS energy of the current frame to determine proximity volume
      let sum = 0;
      for (let i = 0; i < floatBuffer.length; i += 1) {
        sum += floatBuffer[i] * floatBuffer[i];
      }
      const rms = Math.sqrt(sum / floatBuffer.length);
      const isEnergyAboveGate = rms >= VOCAL_ENERGY_THRESHOLD;

      const db = 20 * Math.log10(Math.max(rms, 1e-8));
      const gated = db < KARAOKE_GATE_THRESHOLD_DB || !isEnergyAboveGate;

      const volumePercent = Math.min(100, Math.max(0, ((db + 80) / 80) * 100));
      setMicVolumePercent(Number.isFinite(volumePercent) ? volumePercent : 0);
      setIsSingingActive(!gated);

      // 2. Gate the Pitch Tracking: Only process if energy gate is open
      if (!gated) {
        const pitchHz = detectPitchFromAutocorrelation(floatBuffer, audioContextRef.current?.sampleRate ?? 44100);
        if (pitchHz > 0) {
          // Pass frequency through a 5-frame rolling average buffer for vibrato protection / visual stability
          pitchCacheRef.current.push(pitchHz);
          if (pitchCacheRef.current.length > 5) {
            pitchCacheRef.current.shift();
          }
          const smoothedHz = pitchCacheRef.current.reduce((a, b) => a + b, 0) / pitchCacheRef.current.length;

          latestPitchHzRef.current = smoothedHz;
          setDetectedPitchHz(smoothedHz);
          const midi = 69 + 12 * Math.log2(smoothedHz / 440);
          userPitchMidiRef.current = midi;
          setUserPitchMidi(midi);
          
          const activeTarget = targetNoteMidiRef.current;
          if (activeTarget !== null) {
            // Track transposition offset on first 3 valid notes
            if (validNoteDiffsRef.current.length < 3) {
              const rawDiff = midi - activeTarget;
              let normalizedDiff = rawDiff % 12;
              if (normalizedDiff > 6) normalizedDiff -= 12;
              if (normalizedDiff < -6) normalizedDiff += 12;
              validNoteDiffsRef.current.push(normalizedDiff);
              if (validNoteDiffsRef.current.length === 3) {
                const avg = validNoteDiffsRef.current.reduce((a, b) => a + b, 0) / 3;
                vocalKeyOffsetRef.current = Math.round(avg);
                console.log("🔒 [TRANSPOSITION] Active key offset locked to:", vocalKeyOffsetRef.current);
              }
            }

            // Octave-blind chroma matching math
            const transposedTarget = activeTarget + vocalKeyOffsetRef.current;
            const userNoteClass = ((Math.round(midi) % 12) + 12) % 12;
            const targetNoteClass = ((Math.round(transposedTarget) % 12) + 12) % 12;
            
            let pitchDistance = Math.abs(userNoteClass - targetNoteClass);
            if (pitchDistance > 6) {
              pitchDistance = 12 - pitchDistance;
            }

            if (pitchDistance <= 1.5) {
              matchingTimeMsRef.current += 16.6;
            }
          }
        } else {
          latestPitchHzRef.current = null;
          setDetectedPitchHz(null);
          userPitchMidiRef.current = null;
          setUserPitchMidi(null);
          pitchCacheRef.current = [];
        }
      } else {
        latestPitchHzRef.current = null;
        setDetectedPitchHz(null);
        userPitchMidiRef.current = null;
        setUserPitchMidi(null);
      }

      karaokeAnimationRef.current = requestAnimationFrame(detectFrame);
    };

    karaokeAnimationRef.current = requestAnimationFrame(detectFrame);
    return () => {
      if (karaokeAnimationRef.current) cancelAnimationFrame(karaokeAnimationRef.current);
      karaokeAnimationRef.current = null;
    };
  }, [karaokeEnabled]);

  useEffect(() => {
    if (!karaokeEnabled) return;

    const toSemitone = (pitchHz: number) => {
      const midi = Math.round(12 * Math.log2(pitchHz / 440) + 69);
      return ((midi % 12) + 12) % 12;
    };

    karaokeIntervalRef.current = window.setInterval(() => {
      const sungHz = latestPitchHzRef.current;
      const userMidi = userPitchMidiRef.current;

      // 3. Freeze the Scoring Engine: If userPitchMidi is null (silent or gated), pause scoring immediately
      if (userMidi === null || !sungHz) {
        // Do not update score, do not increment streak, do not break streak. Freeze.
        return;
      }

      // Humming fallback scoring if pitchBlocks is empty
      if (!pitchBlocks.length) {
        if (isSingingActive) {
          const nextCombo = karaokeComboRef.current + 1;
          const gain = 100 + nextCombo * 8;
          const nextScore = karaokeScoreRef.current + gain;

          karaokeComboRef.current = nextCombo;
          karaokeScoreRef.current = nextScore;
          karaokeMaxComboRef.current = Math.max(karaokeMaxComboRef.current, nextCombo);

          setKaraokeCombo(nextCombo);
          setKaraokeScore(nextScore);
          setMaxCombo(karaokeMaxComboRef.current);
        } else if (karaokeComboRef.current !== 0) {
          karaokeComboRef.current = 0;
          setKaraokeCombo(0);
        }
        return;
      }

      // Standard pitch matching scoring using pitchBlocks target note
      const activeTargetMidi = targetNoteMidiRef.current;
      if (activeTargetMidi === null) {
        if (karaokeComboRef.current !== 0) {
          karaokeComboRef.current = 0;
          setKaraokeCombo(0);
        }
        return;
      }

      const onNote = matchingTimeMsRef.current >= 10;
      matchingTimeMsRef.current = 0;

      if (onNote) {
        const nextCombo = karaokeComboRef.current + 1;
        // Boosted scoring: Interval is 120ms, so 100 points/second ≈ 12 points per interval tick
        const extraPointsPerTick = Math.round(100 * (KARAOKE_SCORE_TICK_MS / 1000));
        const gain = 100 + nextCombo * 8 + extraPointsPerTick;
        const nextScore = karaokeScoreRef.current + gain;
 
        karaokeComboRef.current = nextCombo;
        karaokeScoreRef.current = nextScore;
        karaokeMaxComboRef.current = Math.max(karaokeMaxComboRef.current, nextCombo);
 
        setKaraokeCombo(nextCombo);
        setKaraokeScore(nextScore);
        setMaxCombo(karaokeMaxComboRef.current);
      } else if (karaokeComboRef.current !== 0) {
        karaokeComboRef.current = 0;
        setKaraokeCombo(0);
      }
    }, KARAOKE_SCORE_TICK_MS);
 
    return () => {
      if (karaokeIntervalRef.current) window.clearInterval(karaokeIntervalRef.current);
      karaokeIntervalRef.current = null;
    };
  }, [karaokeEnabled, pitchBlocks, isSingingActive, karaokeScore]);

  useEffect(() => {
    if (!karaokeEnabled || !player.data?.durationSec) return;

    const endWatcher = window.setInterval(() => {
      const ended = smoothTimeRef.current >= player.data.durationSec * 1000;
      if (!ended) return;

      stopKaraoke();
      setScoreSummaryOpen(true);
      toast({ title: "Song complete", description: "Karaoke score summary is ready." });
      window.clearInterval(endWatcher);
    }, 400);

    return () => window.clearInterval(endWatcher);
  }, [karaokeEnabled, player.data?.durationSec, stopKaraoke]);

  const fetchPitchData = useCallback(async () => {
    if (!karaokeEnabled) return;
    if (!currentTrack.title) return;
    try {
      if (fetchPitchTimeoutRef.current) {
        window.clearTimeout(fetchPitchTimeoutRef.current);
        fetchPitchTimeoutRef.current = null;
      }

      const authHeaders = activeSessionToken ? { Authorization: `Bearer ${activeSessionToken}` } : {};
      // Use the track URL as the identifier since the backend keys pitch maps by URL hash
      const trackIdParam = currentTrack.url ? `?trackId=${encodeURIComponent(currentTrack.url)}` : (currentTrack.id ? `?trackId=${encodeURIComponent(currentTrack.id)}` : "");
      const response = await fetch(`${API_BASE_URL}/music/karaoke/pitch-data${trackIdParam}`, {
        headers: {
          "ngrok-skip-browser-warning": "true",
          "x-guild-id": activeGuildId,
          "x-user-id": activeUserDiscordId,
          ...authHeaders,
        },
      });
      const data = await response.json();

      // Guard check again in case mode changed during network request
      if (!karaokeEnabled) return;

      // Helper to convert timeMs/midi frames and consolidate into continuous blocks
      const convertToBlocks = (frames: any[]) => {
        if (!Array.isArray(frames)) return [];
        
        // Filter out zero/null notes first and sort by timeMs ascending
        const validFrames = frames
          .filter(f => f && typeof f.timeMs === "number" && typeof f.midi === "number" && f.midi > 0)
          .sort((a, b) => a.timeMs - b.timeMs);

        if (validFrames.length === 0) return [];

        const groups: Array<{ note: number; start: number; duration: number }> = [];
        let currentGroup: any[] = [validFrames[0]];

        for (let i = 1; i < validFrames.length; i++) {
          const prev = currentGroup[currentGroup.length - 1];
          const curr = validFrames[i];
          
          const timeDiff = (curr.timeMs - prev.timeMs) / 1000;
          const pitchDiff = Math.abs(curr.midi - prev.midi);

          if (timeDiff < 0.15 && pitchDiff <= 0.5) {
            currentGroup.push(curr);
          } else {
            // Commit current group
            const start = currentGroup[0].timeMs / 1000;
            const lastTime = currentGroup[currentGroup.length - 1].timeMs / 1000;
            const duration = (lastTime - start) + 0.1; // 100ms minimum block duration
            const avgMidi = currentGroup.reduce((sum, f) => sum + f.midi, 0) / currentGroup.length;
            groups.push({
              start,
              duration,
              note: avgMidi
            });
            // Start new group
            currentGroup = [curr];
          }
        }

        // Commit last group
        if (currentGroup.length > 0) {
          const start = currentGroup[0].timeMs / 1000;
          const lastTime = currentGroup[currentGroup.length - 1].timeMs / 1000;
          const duration = (lastTime - start) + 0.1;
          const avgMidi = currentGroup.reduce((sum, f) => sum + f.midi, 0) / currentGroup.length;
          groups.push({
            start,
            duration,
            note: avgMidi
          });
        }

        return groups;
      };

      if (Array.isArray(data) && data.length > 0) {
        const blocks = convertToBlocks(data);
        if (cachedPitchTrackId !== currentTrack.id) {
          setPitchBlocks(blocks);
          // Also update currentPitchMap so the "Pitch Map: Ready" indicator shows and MIDI scoring works
          setCurrentPitchMap({
            title: currentTrack.title,
            artist: currentTrack.artist,
            frames: data,
          });
          setCachedPitchTrackId(currentTrack.id);
        }
        console.log("Loaded snapped pitch blocks (raw array):", blocks.length);
        // Toast only once when the map transitions from unavailable → available
        if (loadedPitchTrackIdRef.current !== currentTrack.id) {
          toast({ title: "Pitch map ready", description: "Karaoke pitch tracking is now active." });
          loadedPitchTrackIdRef.current = currentTrack.id;
        }
      } else if (data && data.status === "processing") {
        setPitchBlocks([]);
        console.log("Pitch data is processing, scheduling retry...");
        fetchPitchTimeoutRef.current = window.setTimeout(() => {
          void fetchPitchData();
        }, 3000);
      } else if (data && Array.isArray(data.blocks) && data.blocks.length > 0) {
        const blocks = convertToBlocks(data.blocks);
        if (cachedPitchTrackId !== currentTrack.id) {
          setPitchBlocks(blocks);
          setCurrentPitchMap({
            title: currentTrack.title,
            artist: currentTrack.artist,
            frames: data.blocks,
          });
          setCachedPitchTrackId(currentTrack.id);
        }
        console.log("Loaded snapped pitch blocks (wrapped):", blocks.length);
        if (loadedPitchTrackIdRef.current !== currentTrack.id) {
          toast({ title: "Pitch map ready", description: "Karaoke pitch tracking is now active." });
          loadedPitchTrackIdRef.current = currentTrack.id;
        }
      } else if (data && Array.isArray(data.frames) && data.frames.length > 0) {
        const blocks = convertToBlocks(data.frames);
        if (cachedPitchTrackId !== currentTrack.id) {
          setPitchBlocks(blocks);
          setCurrentPitchMap({
            title: currentTrack.title,
            artist: currentTrack.artist,
            frames: data.frames,
          });
          setCachedPitchTrackId(currentTrack.id);
        }
        console.log("Loaded snapped pitch blocks (frames list):", blocks.length);
        if (loadedPitchTrackIdRef.current !== currentTrack.id) {
          toast({ title: "Pitch map ready", description: "Karaoke pitch tracking is now active." });
          loadedPitchTrackIdRef.current = currentTrack.id;
        }
      } else {
        setPitchBlocks([]);
      }
    } catch (err) {
      console.error("Failed to load snapped pitch blocks:", err);
      setPitchBlocks([]);
      if (karaokeEnabled) {
        fetchPitchTimeoutRef.current = window.setTimeout(() => {
          void fetchPitchData();
        }, 5000);
      }
    }
  }, [API_BASE_URL, activeGuildId, activeUserDiscordId, activeSessionToken, currentTrack.title, currentTrack.id, karaokeEnabled, cachedPitchTrackId]);

  const startLyricsAutoFetchLoop = useCallback(() => {
    if (lyricsRetryTimerRef.current) {
      window.clearInterval(lyricsRetryTimerRef.current);
    }
    lyricsRetryElapsedRef.current = 0;

    const poll = async () => {
      if (!currentTrack.title) return;
      try {
        const response = await voxariaApi.fetchLyrics(currentTrack.title, currentTrack.artist, activeGuildId);
        const hasAnyLyrics = Boolean(response.lines.length || response.plain?.trim());
        if (hasAnyLyrics) {
          if (cachedTrackId !== currentTrack.id) {
            setLyricsData(response);
            setCachedTrackId(currentTrack.id);
          }
          setLyricsUnavailable(false);
          if (response.hasSynced) {
            if (lyricsRetryTimerRef.current) {
              window.clearInterval(lyricsRetryTimerRef.current);
              lyricsRetryTimerRef.current = null;
            }
            return;
          }
        }
      } catch (err) {
        console.error("Lyrics retry poll failed:", err);
      }

      lyricsRetryElapsedRef.current += 10;
      if (lyricsRetryElapsedRef.current >= 60) {
        if (lyricsRetryTimerRef.current) {
          window.clearInterval(lyricsRetryTimerRef.current);
          lyricsRetryTimerRef.current = null;
        }
        toast({ title: "Lyrics sync timed out", description: "Falling back to Genius / plain lyrics." });
      }
    };

    void poll();
    lyricsRetryTimerRef.current = window.setInterval(poll, 10000);
  }, [currentTrack.title, currentTrack.artist, currentTrack.id, activeGuildId, cachedTrackId]);

  const currentTrackId = currentTrack.id;
  const playerPlaying = player.data?.playing;

  useEffect(() => {
    if (!karaokeEnabled) {
      setPitchBlocks([]);
      return;
    }

    void fetchPitchData();
    startLyricsAutoFetchLoop();

    return () => {
      if (fetchPitchTimeoutRef.current) {
        window.clearTimeout(fetchPitchTimeoutRef.current);
        fetchPitchTimeoutRef.current = null;
      }
    };
  }, [currentTrackId, playerPlaying, karaokeEnabled]);

  // Update target MIDI note from blocks
  useEffect(() => {
    if (!pitchBlocks.length) {
      targetNoteMidiRef.current = null;
      return;
    }
    const currentBlock = pitchBlocks.find(
      (b) => currentPlaybackTimeSec >= b.start && currentPlaybackTimeSec <= b.start + b.duration
    );
    targetNoteMidiRef.current = currentBlock ? currentBlock.note : null;
  }, [pitchBlocks, currentPlaybackTimeSec]);

  // Draw Pitch Canvas function
  const drawPitchCanvas = useCallback((dt: number) => {
    const canvas = pitchCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const centerY = height / 2;

    // 1. Clear frame first
    ctx.clearRect(0, 0, width, height);

    // Solid dark slate background (#1e293b)
    ctx.fillStyle = "#1e293b"; 
    ctx.fillRect(0, 0, width, height);

    // 2. Setup absolute MIDI range dynamically based on active pitchBlocks with cushion
    let minMidi = 48; // Default C3
    let maxMidi = 72; // Default C5
    const activeNotes = pitchBlocks.filter((n) => n.note > 0);
    if (activeNotes.length > 0) {
      const notes = activeNotes.map((n) => n.note + vocalKeyOffsetRef.current);
      minMidi = Math.min(...notes) - 2;
      maxMidi = Math.max(...notes) + 2;
      // Ensure visual height of at least 12 semitones
      if (maxMidi - minMidi < 12) {
        maxMidi = minMidi + 12;
      }
    }

    const padding = 20;
    const availableHeight = height - (padding * 2);

    const mapMidiToY = (midiNote: number) => {
      const range = maxMidi - minMidi;
      if (!range || range <= 0) return centerY;
      return padding + (1.0 - (midiNote - minMidi) / range) * availableHeight;
    };

    // 3. Draw Horizontal Semitone Grid Lines & C-Note Octave Labels
    const naturalMidiNotes = [48, 50, 52, 53, 55, 57, 59, 60, 62, 64, 65, 67, 69, 71, 72];
    for (let midi = minMidi; midi <= maxMidi; midi++) {
      const y = mapMidiToY(midi);
      const isC = midi % 12 === 0;

      if (pitchBlocks.length === 0) {
        if (!naturalMidiNotes.includes(midi)) continue;
      }

      if (isC) {
        ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();

        const octave = Math.floor(midi / 12) - 1;
        const label = `C${octave}`;

        ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
        ctx.font = "bold 11px sans-serif";
        ctx.textBaseline = "middle";
        ctx.fillText(label, 8, y);
      } else {
        ctx.strokeStyle = "rgba(255, 255, 255, 0.03)";
        ctx.lineWidth = 1.0;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
    }

    // Render a Central Horizon Target at Middle C (C4 / MIDI = 60) when pitchBlocks is empty
    if (pitchBlocks.length === 0) {
      const middleCY = mapMidiToY(60);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(0, middleCY);
      ctx.lineTo(width, middleCY);
      ctx.stroke();
      ctx.setLineDash([]); 

      ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
      ctx.font = "bold 10px sans-serif";
      ctx.fillText("C4 Horizon", width - 80, middleCY - 8);
    }

    // Horizontal Scroll Physics: Playhead line anchored at 25% of canvas width
    const playbackTimeSec = currentPlaybackTimeSec; 
    const pixelsPerSecond = 140; 
    const playheadX = width * 0.25;

    // Draw Vertical Playhead Line
    ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX, height);
    ctx.stroke();

    // 4. Draw Scrolling Target Note Blocks with Diagnostic Rendering Counter
    frameCountRef.current += 1;
    let renderedNotesCount = 0;
    const activeTargetMidi = targetNoteMidiRef.current;

    if (pitchBlocks.length > 0) {
      pitchBlocks.forEach((block) => {
        // Skip silent blocks
        if (!block.note || block.note <= 0) return;

        const noteX = playheadX + (block.start - playbackTimeSec) * pixelsPerSecond;
        const noteWidth = block.duration * pixelsPerSecond;

        if (noteX + noteWidth < 0 || noteX > width) return;
        renderedNotesCount += 1;

        const transposedNote = block.note + vocalKeyOffsetRef.current;
        const y = mapMidiToY(transposedNote);

        const isActive = activeTargetMidi !== null && Math.abs(block.note - activeTargetMidi) <= 0.1;
        const sungHz = latestPitchHzRef.current;
        let isHit = false;

        if (isActive && sungHz && sungHz > 0) {
          const sungMidi = 69 + 12 * Math.log2(sungHz / 440);
          const userNoteClass = ((Math.round(sungMidi) % 12) + 12) % 12;
          const targetNoteClass = ((Math.round(transposedNote) % 12) + 12) % 12;
          
          let pitchDistance = Math.abs(userNoteClass - targetNoteClass);
          if (pitchDistance > 6) {
            pitchDistance = 12 - pitchDistance;
          }
          isHit = pitchDistance <= 1.5;
        }

        // Force a hot pink (#ec4899) fill style for hits or standard neon blue (#38bdf8) for miss/idle
        ctx.fillStyle = isHit ? "#ec4899" : "#38bdf8"; 
        
        // Protect the height property: if calculated height is faulty or zero, force it to 16 pixels
        const noteHeight = 16;
        const finalHeight = (noteHeight && noteHeight > 0) ? noteHeight : 16;

        ctx.strokeStyle = isHit ? "rgba(236, 72, 153, 0.4)" : "rgba(56, 189, 248, 0.3)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(noteX, y - finalHeight / 2, noteWidth, finalHeight, 6);
        ctx.fill();
        ctx.stroke();
      });
    }

    // Log diagnostic coordinates on frame 240 for first note block
    if (frameCountRef.current === 240 && pitchBlocks.length > 0) {
      const activePills = pitchBlocks.filter((b) => b.note > 0);
      if (activePills.length > 0) {
        const first = activePills[0];
        const noteX = playheadX + (first.start - playbackTimeSec) * pixelsPerSecond;
        const noteY = mapMidiToY(first.note);
        const noteWidth = first.duration * pixelsPerSecond;
        const noteHeight = 16;
        const finalHeight = (noteHeight && noteHeight > 0) ? noteHeight : 16;
        console.log("📐 [FIRST NOTE REAL PIXELS]:", { x: noteX, y: noteY, w: noteWidth, h: finalHeight });
      }
    }

    // Log diagnostic counter once every 60 frames
    if (frameCountRef.current % 60 === 0) {
      console.log(`📊 [CANVAS RENDER] Frame ${frameCountRef.current}: Rendering ${renderedNotesCount} note blocks inside screen window.`);
    }

    // 5. User Vocal Pitch Tracking Arrow with Easing
    const activeMidi = userPitchMidiRef.current;
    const hasAudioVocal = activeMidi !== null && micVolumePercent > 5;
    const isVocalActive = pitchBlocks.length > 0 ? activeMidi !== null : hasAudioVocal;

    let targetMidiY = centerY;
    if (isVocalActive && activeMidi !== null) {
      targetMidiY = mapMidiToY(activeMidi);
    } else {
      targetMidiY = centerY;
    }

    const dtComp = Math.max(0.001, Math.min(0.1, dt)); 
    if (cursorYRef.current === null) {
      cursorYRef.current = targetMidiY;
    } else {
      cursorYRef.current += (targetMidiY - cursorYRef.current) * (1 - Math.exp(-0.15 * dtComp * 60));
    }

    const arrowY = Math.max(10, Math.min(height - 10, cursorYRef.current));

    if (!isVocalActive) {
      ctx.fillStyle = "#ff3366"; 
      ctx.beginPath();
      ctx.arc(playheadX, arrowY, 6, 0, Math.PI * 2);
      ctx.fill();

      ctx.shadowBlur = 8;
      ctx.shadowColor = "#ff3366";
      ctx.strokeStyle = "#ff3366";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.shadowBlur = 0;
    } else {
      let isMatch = false;
      if (pitchBlocks.length > 0 && activeTargetMidi !== null && activeMidi !== null) {
        const transposedTarget = activeTargetMidi + vocalKeyOffsetRef.current;
        const userNoteClass = ((Math.round(activeMidi) % 12) + 12) % 12;
        const targetNoteClass = ((Math.round(transposedTarget) % 12) + 12) % 12;
        let pitchDistance = Math.abs(userNoteClass - targetNoteClass);
        if (pitchDistance > 6) {
          pitchDistance = 12 - pitchDistance;
        }
        isMatch = pitchDistance <= 1.5; 
      }
      const arrowColor = isMatch ? "#22c55e" : "#38bdf8"; 

      ctx.fillStyle = arrowColor;
      ctx.beginPath();
      ctx.moveTo(playheadX + 8, arrowY); 
      ctx.lineTo(playheadX - 8, arrowY - 6); 
      ctx.lineTo(playheadX - 8, arrowY + 6); 
      ctx.closePath();
      ctx.fill();

      ctx.shadowBlur = 10;
      ctx.shadowColor = arrowColor;
      ctx.strokeStyle = arrowColor;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }, [pitchBlocks, currentPlaybackTimeSec, isSingingActive]);

  // RequestAnimationFrame loop for canvas rendering when karaoke is active
  useEffect(() => {
    if (!karaokeEnabled) return;
 
    let animId: number;
    let lastTime = performance.now();
    const render = () => {
      const now = performance.now();
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      drawPitchCanvas(dt);
      animId = requestAnimationFrame(render);
    };
    animId = requestAnimationFrame(render);
 
    return () => {
      cancelAnimationFrame(animId);
    };
  }, [karaokeEnabled, drawPitchCanvas]);

  useEffect(() => () => stopKaraoke(), [stopKaraoke]);

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-background p-4 text-foreground">
        <div className="mx-auto flex min-h-[calc(100vh-2rem)] w-full max-w-5xl flex-col gap-4">
          <div className="flex items-center justify-end">
            <Button className="neon-glow" onClick={loginWithDiscord}>
              Login with Discord
            </Button>
          </div>

          <article className="relative flex min-h-[520px] flex-1 flex-col rounded-md border border-primary/35 bg-panel-soft/75 p-5 shadow-soft neon-edge">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-xl font-bold text-primary">Expanded Visualizer</h2>
                <p className="text-sm text-muted-foreground">
                  {playerUnavailable
                    ? "Service Unavailable"
                    : `${player.data?.title ?? "No track playing"} — ${player.data?.artist ?? "Unknown artist"}`}
                </p>
              </div>

              <Button
                variant="outline"
                className="border-primary/55 text-primary hover:bg-accent/40"
                onClick={() => void refreshLyrics()}
                disabled={isFetchingLyrics || !currentTrack.title}
              >
                {isFetchingLyrics ? <Loader2 className="h-4 w-4 animate-spin" /> : "Refresh Lyrics"}
              </Button>
            </div>

            <div className="mb-3 rounded-md border border-primary/45 bg-accent/25 px-3 py-2 text-sm text-primary neon-glow">
              {lyricsServiceUnavailable
                ? "Service Unavailable"
                : lyricsUnavailable
                  ? "Lyrics not available"
                  : `Source: ${lyricsData?.source || "Unknown"}`}
            </div>

            <div ref={lyricsContainerRef} className="h-full overflow-y-auto px-3">
              <div className="mx-auto flex w-full max-w-4xl flex-col gap-2 py-2">
                {lyricsData?.hasSynced && normalizedLyrics.length ? (
                  normalizedLyrics.map((line, idx) => (
                    <button
                      key={`${line.text}-${idx}`}
                      data-lyric-index={idx}
                      data-lyric-time={line.timeSeconds}
                      onClick={() => handleLyricSync(idx, line.timeSeconds)}
                      className={`block w-full rounded-md border px-6 py-3 text-center text-xl leading-relaxed whitespace-normal break-words transition-all duration-300 ease-in-out hover:bg-muted/50 ${
                        idx === activeLine ? "border-primary/65 bg-accent/35 neon-glow" : "border-border/20"
                      } ${getLyricLineClassName(idx, activeLine)}`}
                    >
                      {line.text}
                    </button>
                  ))
                ) : lyricsData?.plain?.trim() ? (
                  <p className="whitespace-pre-line rounded-md border border-border/60 bg-panel/70 px-6 py-4 text-center text-base leading-relaxed text-foreground/85">
                    {lyricsData.plain}
                  </p>
                ) : (
                  <p className="rounded-md border border-border/60 bg-panel/70 px-6 py-4 text-center text-sm text-muted-foreground">
                    {lyricsServiceUnavailable ? "Service Unavailable" : "Lyrics not available"}
                  </p>
                )}
              </div>
            </div>
          </article>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="relative min-h-screen lg:pl-[240px]">
        <aside className="fixed left-0 top-0 z-20 hidden h-screen w-[240px] flex-col border-r border-border/70 bg-panel/90 p-4 backdrop-blur-xl lg:flex">
          <div className="mb-8 rounded-md border border-primary/40 bg-panel-soft/85 p-3 shadow-soft neon-glow">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Discord Music Bot</p>
            <h1 className="text-xl font-semibold text-primary">Voxaria</h1>
          </div>

          <nav className="space-y-2">
            {navItems.map(({ label, icon: Icon }, idx) => (
              <button
                key={label}
                className={`flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition ${
                  idx === 0
                    ? "border-primary/65 bg-accent/70 text-accent-foreground shadow-soft neon-glow"
                    : "border-border/70 bg-panel-soft/65 text-muted-foreground hover:border-primary/55 hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </nav>

          <div className="mt-auto rounded-md border border-border/70 bg-panel-soft/75 p-3 text-xs text-muted-foreground">
            <p>Status: <span className="text-success">{status.data?.online ? "Online" : "Offline"}</span></p>
            <p>Shard #{status.data?.activeShard ?? 0} · {status.data?.pingMs ?? 0}ms</p>
          </div>
        </aside>

        <main className="flex min-h-screen flex-col pb-36">
          <header className="sticky top-0 z-10 border-b border-border/70 bg-background/85 p-4 backdrop-blur-xl">
            <div className="flex flex-col gap-3 rounded-md border border-border/70 bg-panel-soft/70 p-2 shadow-soft">
              <div className="flex flex-wrap items-center gap-2">
                <Search className="ml-1 h-4 w-4 text-primary" />
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Youtube className="h-4 w-4 text-primary" />
                  <Disc3 className="h-4 w-4 text-primary" />
                  <span className="text-[11px]">Spotify</span>
                </div>
                <Input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search songs..."
                  className="h-10 min-w-[220px] flex-1 border-none bg-transparent focus-visible:ring-0"
                />
                <Button
                  className="h-10 rounded-md neon-glow"
                  disabled={searchMutation.isPending || !searchTerm.trim()}
                  onClick={() => searchMutation.mutate({ query: searchTerm.trim(), guildId: activeGuildId })}
                >
                  {searchMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}
                </Button>
                <Button
                  className="h-10 rounded-md neon-glow"
                  disabled={summonBotMutation.isPending}
                  onClick={() => summonBotMutation.mutate({ guildId: activeGuildId })}
                >
                  {summonBotMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Summon Bot"}
                </Button>
                {currentUser && (
                  <div className="flex items-center gap-2 rounded-md border border-primary/40 bg-panel-soft/60 px-3 py-1">
                    {currentUser.avatar ? (
                      <img src={currentUser.avatar} alt="Avatar" className="h-6 w-6 rounded-full border border-primary object-cover" />
                    ) : (
                      <UserCircle2 className="h-6 w-6 text-primary" />
                    )}
                    <span className="text-xs font-semibold text-primary">{currentUser.name}</span>
                  </div>
                )}
                <Button variant="outline" className="h-10 border-primary/55 text-primary hover:bg-accent/35" onClick={logoutDiscord}>
                  <LogOut className="h-4 w-4" />
                </Button>
              </div>

            </div>
          </header>

          {!karaokeEnabled ? (
            <section className="flex-1 p-4">
              <div className="grid h-full gap-4 xl:grid-cols-[1.8fr_380px]">
                <article className="relative flex min-h-[520px] flex-col rounded-md border border-primary/35 bg-panel-soft/75 p-5 shadow-soft neon-edge">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-xl font-bold text-primary">Expanded Visualizer</h2>
                    <p className="text-sm text-muted-foreground">
                      {playerUnavailable
                        ? "Service Unavailable"
                        : `${player.data?.title ?? "No track playing"} — ${player.data?.artist ?? "Unknown artist"}`}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant={karaokeEnabled ? "secondary" : "outline"}
                      className="border-primary/55 text-primary hover:bg-accent/40"
                      onClick={() => (karaokeEnabled ? stopKaraoke() : void startKaraoke())}
                      disabled={isGeneratingKaraoke}
                    >
                      {isGeneratingKaraoke ? <Loader2 className="h-4 w-4 animate-spin" /> : karaokeEnabled ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                      {isGeneratingKaraoke ? "Processing..." : karaokeEnabled ? "Stop Karaoke" : "Start Karaoke"}
                    </Button>
                    <Button
                    variant="outline"
                    className="border-primary/55 text-primary hover:bg-accent/40"
                    onClick={() => void refreshLyrics()}
                    disabled={isFetchingLyrics || !currentTrack.title}
                  >
                    {isFetchingLyrics ? <Loader2 className="h-4 w-4 animate-spin" /> : "Refresh Lyrics"}
                  </Button>
                  </div>
                </div>

                <div className="mb-3 rounded-md border border-primary/45 bg-accent/25 px-3 py-2 text-sm text-primary neon-glow">
                  {lyricsServiceUnavailable
                    ? "Service Unavailable"
                    : lyricsUnavailable
                      ? "Lyrics not available"
                      : `Source: ${lyricsData?.source || "Unknown"}`}
                </div>

                <div className="mb-3 grid grid-cols-2 gap-2 rounded-md border border-border/70 bg-panel/70 p-2 text-xs">
                  <div className="rounded-sm border border-border/70 bg-panel-soft/70 px-2 py-1">
                    <p className="text-muted-foreground">Score</p>
                    <p className="text-sm font-semibold text-primary">{karaokeScore.toLocaleString()}</p>
                  </div>
                  <div className="rounded-sm border border-border/70 bg-panel-soft/70 px-2 py-1">
                    <p className="text-muted-foreground">Combo</p>
                    <p className="text-sm font-semibold text-primary">x{karaokeCombo}</p>
                  </div>
                  <div className="rounded-sm border border-border/70 bg-panel-soft/70 px-2 py-1">
                    <p className="text-muted-foreground">Detected Note</p>
                    <p className="text-sm font-semibold text-primary">{detectedNoteLabel}</p>
                  </div>
                  <div className="rounded-sm border border-border/70 bg-panel-soft/70 px-2 py-1">
                    <p className="text-muted-foreground">Pitch Map</p>
                    <p className="text-sm font-semibold text-primary">{currentPitchMap?.frames?.length ? "Ready" : "Unavailable"}</p>
                  </div>
                </div>

                {isKaraokeActive && (
                  <Collapsible open={lyricsOpen} onOpenChange={setLyricsOpen} className="min-h-0 flex-1 rounded-md border border-border/70 bg-panel/75">
                    <CollapsibleTrigger className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium text-primary hover:bg-accent/25">
                      <span className="flex items-center gap-2"><Music size={18} /> Live Karaoke Lyrics</span>
                      {lyricsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </CollapsibleTrigger>
                    <CollapsibleContent className="h-[380px] border-t border-border/70 px-2 py-2">
                      <div ref={lyricsContainerRef} className="h-full overflow-y-auto px-3">
                        <div className="mx-auto flex w-full max-w-4xl flex-col gap-2 py-2">
                          {lyricsData?.hasSynced && normalizedLyrics.length ? (
                            normalizedLyrics.map((line, idx) => (
                              <button
                                key={`${line.text}-${idx}`}
                                data-lyric-index={idx}
                                data-lyric-time={line.timeSeconds}
                                onClick={() => handleLyricSync(idx, line.timeSeconds)}
                                className={`block w-full rounded-md border px-6 py-3 text-center text-2xl leading-relaxed whitespace-normal break-words transition-all duration-300 ease-in-out hover:bg-muted/50 ${
                                  idx === activeLine ? "border-primary/65 bg-accent/35 neon-glow" : "border-border/20"
                                } ${getLyricLineClassName(idx, activeLine)}`}
                              >
                                {line.text}
                              </button>
                            ))
                          ) : lyricsData?.plain?.trim() ? (
                            <p className="whitespace-pre-line rounded-md border border-border/60 bg-panel/70 px-6 py-4 text-center text-base leading-relaxed text-foreground/85">
                              {lyricsData.plain}
                            </p>
                          ) : (
                            <p className="rounded-md border border-border/60 bg-panel/70 px-6 py-4 text-center text-sm text-muted-foreground">
                              {lyricsServiceUnavailable ? "Service Unavailable" : "Lyrics not available"}
                            </p>
                          )}
                        </div>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                )}
              </article>

              <aside className="flex min-h-[520px] flex-col gap-4 rounded-md border border-border/70 bg-panel-soft/70 p-3 shadow-soft">
                <section className="rounded-md border border-primary/40 bg-panel/80 p-3 neon-glow">
                  <h3 className="mb-2 text-sm font-semibold text-primary">Request Song</h3>
                  <form
                    className="space-y-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!requestTerm.trim()) return;
                      requestMutation.mutate({ query: requestTerm.trim(), guildId: activeGuildId });
                    }}
                  >
                    <Input
                      value={requestTerm}
                      onChange={(e) => setRequestTerm(e.target.value)}
                      placeholder="Type song title, artist, or URL..."
                      className="h-9 bg-panel-soft/60"
                    />
                    <Button className="h-9 w-full neon-glow" disabled={requestMutation.isPending || !requestTerm.trim()}>
                      {requestMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Request"}
                    </Button>
                  </form>
                </section>

                <section className="flex min-h-0 flex-1 flex-col rounded-md border border-primary/40 bg-panel/80 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-base font-semibold text-primary">Upcoming Queue</h3>
                    <div className="flex items-center gap-2">
                      <Badge className="bg-accent text-accent-foreground">{(queue.data ?? []).length} tracks</Badge>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 border-primary/55 text-primary hover:bg-accent/35"
                        onClick={() => shuffleQueueMutation.mutate()}
                        disabled={shuffleQueueMutation.isPending}
                      >
                        <Shuffle className="h-3.5 w-3.5" /> Shuffle
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2 overflow-y-auto pr-1">
                    {queueUnavailable ? (
                      <p className="rounded-md border border-border/70 bg-panel/70 px-3 py-2 text-xs text-muted-foreground">Service Unavailable</p>
                    ) : (
                      (queue.data ?? []).map((track, index) =>
                        queueRow(
                          track,
                          index,
                          (idx) => deleteQueueItemMutation.mutate(idx),
                          (idx) => setDragIndex(idx),
                          handleDrop,
                          dragIndex === index,
                          canManageQueue,
                        ),
                      )
                    )}
                  </div>
                </section>
                </aside>
              </div>
            </section>
          ) : (
            <section className="flex-1 p-4">
              <div className="grid h-full gap-4 xl:grid-cols-[1.8fr_380px]">
                <article className="flex h-[680px] flex-col rounded-md border border-primary/35 bg-panel-soft/75 p-4 shadow-soft neon-edge">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="text-xl font-bold text-primary">Karaoke Arena</h2>
                      <p className="text-sm text-muted-foreground">Precision pitch tracking and live contest mode.</p>
                    </div>
                    <Badge className="bg-accent text-accent-foreground">Target: {targetNoteDisplay}</Badge>
                  </div>

                  {/* Vertical Split Panel: 70% Lyrics, 30% Pitch Visualizer Canvas */}
                  <div className="flex flex-1 flex-col gap-3 min-h-0 mb-4">
                    {/* Top 70% Synced Lyrics Scroll Panel */}
                    <div className="h-[68%] relative rounded-md border border-border/70 bg-panel/75 flex flex-col overflow-hidden">
                      <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
                        <button 
                          onClick={handleHotReload}
                          className="px-3 py-1.5 bg-emerald-500/20 border border-emerald-500/40 hover:bg-emerald-500/40 text-emerald-400 text-xs font-semibold rounded transition flex items-center gap-1.5"
                        >
                          🔄 Reload Arena Stream
                        </button>
                        <button 
                          onClick={handleRefreshLyrics}
                          className="px-3 py-1.5 bg-blue-500/20 border border-blue-500/40 hover:bg-blue-500/40 text-blue-400 text-xs font-semibold rounded transition flex items-center gap-1.5"
                        >
                          🎵 Refresh Lyrics
                        </button>
                        <div className="rounded-md border border-border/70 bg-panel-soft/80 px-2 py-1 text-xs text-primary">
                          Live Lyrics
                        </div>
                      </div>
                      <div ref={lyricsContainerRef} className="h-full overflow-y-auto px-4 py-6">
                        <div className="mx-auto flex w-full max-w-4xl flex-col gap-3 py-2">
                          {lyricsData?.hasSynced && normalizedLyrics.length ? (
                            normalizedLyrics.map((line, idx) => (
                              <button
                                key={`${line.text}-${idx}`}
                                data-lyric-index={idx}
                                data-lyric-time={line.timeSeconds}
                                onClick={() => handleLyricSync(idx, line.timeSeconds)}
                                className={`block w-full rounded-md px-6 py-3 text-center leading-relaxed whitespace-normal break-words transition-all duration-300 ease-in-out hover:bg-accent/10 ${
                                  idx === activeLine
                                    ? "text-primary text-3xl font-extrabold scale-[1.05] drop-shadow-[0_0_12px_hsl(var(--primary)/0.65)]"
                                    : "text-muted-foreground/50 text-xl font-medium scale-[0.98]"
                                }`}
                              >
                                {line.text}
                              </button>
                            ))
                          ) : lyricsData?.plain?.trim() ? (
                            <p className="whitespace-pre-line rounded-md bg-panel/70 px-6 py-4 text-center text-xl leading-relaxed text-foreground/80">
                              {lyricsData.plain}
                            </p>
                          ) : (
                            <p className="rounded-md bg-panel/70 px-6 py-4 text-center text-sm text-muted-foreground">
                              {isFetchingLyrics ? "Loading lyrics..." : "Lyrics not available. Start bot playback to view lyrics."}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Bottom 30% Pitch Tracker Canvas */}
                    <div className="h-[32%] relative rounded-md border border-border/70 bg-panel overflow-hidden">
                      <canvas
                        ref={pitchCanvasRef}
                        className="w-full h-full block"
                      />
                    </div>
                  </div>

                  <div className="grid gap-2 rounded-md border border-border/70 bg-panel/80 p-3 md:grid-cols-[1fr_1fr]">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant={karaokeEnabled ? "secondary" : "outline"}
                        className="border-primary/55 text-primary hover:bg-accent/40"
                        onClick={() => (karaokeEnabled ? stopKaraoke() : void startKaraoke())}
                        disabled={isGeneratingKaraoke}
                      >
                        {isGeneratingKaraoke ? <Loader2 className="h-4 w-4 animate-spin" /> : karaokeEnabled ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                        {isGeneratingKaraoke ? "Initializing..." : karaokeEnabled ? "Microphone On" : "Join & Start Singing"}
                      </Button>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Circle className={`h-3 w-3 ${isSingingActive ? "fill-success text-success" : "fill-danger text-danger"}`} />
                        {isSingingActive ? "Singing detected" : "Waiting for voice"}
                      </div>
                    </div>

                    <div className="space-y-2 rounded-md border border-border/70 bg-panel-soft/70 p-2">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Vocal Volume Input</span>
                        <span>{Math.round(micVolumePercent)}%</span>
                      </div>
                      <Progress value={micVolumePercent} className="h-2" />
                    </div>

                    <div className="flex items-center justify-between rounded-md border border-border/70 bg-panel-soft/70 px-3 py-2">
                      <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                        <Flame className="h-4 w-4" /> Streak multiplier
                      </div>
                      <span className="text-lg font-bold text-primary">x{streakMultiplier}</span>
                    </div>

                    <div className="flex items-center justify-between rounded-md border border-border/70 bg-panel-soft/70 px-3 py-2">
                      <span className="text-sm text-muted-foreground">Live Score</span>
                      <span className="font-mono text-2xl font-bold text-primary">{karaokeScore.toLocaleString()}</span>
                    </div>
                  </div>
                </article>

                <aside className="flex min-h-[560px] flex-col rounded-md border border-border/70 bg-panel-soft/70 p-3 shadow-soft">
                  <h3 className="mb-3 text-base font-semibold text-primary">Contest Leaderboard</h3>
                  <div className="space-y-2 overflow-y-auto pr-1">
                    {contestants.map((contestant) => (
                      <article
                        key={contestant.id}
                        className={`rounded-md border p-3 transition-all duration-300 ease-in-out ${
                          contestant.isCurrentUser
                            ? "border-success/70 bg-accent/30 shadow-[0_0_16px_hsl(var(--success)/0.25)]"
                            : "border-border/70 bg-panel/80"
                        }`}
                      >
                        <div className="mb-2 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="border-primary/45 text-primary">#{contestant.rank}</Badge>
                            <p className="text-sm font-semibold text-foreground">{contestant.username}</p>
                          </div>
                          <span className="font-mono text-base font-bold text-primary">{contestant.score.toLocaleString()}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>Streak: x{contestant.streak}</span>
                          <span className="inline-flex items-center gap-1">
                            <Circle className={`h-3 w-3 ${contestant.active ? "fill-success text-success" : "fill-muted text-muted-foreground"}`} />
                            {contestant.active ? "Singing" : "Idle"}
                          </span>
                        </div>
                      </article>
                    ))}
                  </div>
                </aside>
              </div>
            </section>
          )}

          <section className="grid gap-4 px-4 pb-4 lg:grid-cols-5">
            <article className="rounded-[12px] border border-primary/35 bg-panel-soft/70 p-4 shadow-soft backdrop-blur-xl neon-edge">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-primary">Now Playing</h3>
                <Badge className="bg-accent text-accent-foreground">Live</Badge>
              </div>

              <div className="flex items-center gap-3 rounded-md border border-border/70 bg-panel/70 p-3">
                {player.data?.thumbnail || player.data?.art ? (
                  <img
                    src={player.data?.thumbnail ?? player.data?.art ?? ""}
                    alt={`${player.data?.title ?? "Current song"} album cover`}
                    loading="lazy"
                    className="h-14 w-14 rounded-md border border-border/70 object-cover"
                  />
                ) : (
                  <div className="flex h-14 w-14 items-center justify-center rounded-md border border-border/70 bg-panel-soft">
                    <Disc3 className="h-5 w-5 text-primary" />
                  </div>
                )}

                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">{playerUnavailable ? "Service Unavailable" : player.data?.title ?? "No track playing"}</p>
                  <p className="truncate text-xs text-muted-foreground">{playerUnavailable ? "Service Unavailable" : player.data?.artist ?? "Waiting for backend data"}</p>
                  <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    {player.data?.requesterAvatar ? (
                      <img
                        src={player.data.requesterAvatar}
                        alt={`${player.data?.requesterName ?? "Requester"} avatar`}
                        loading="lazy"
                        className="h-4 w-4 rounded-full border border-border object-cover"
                      />
                    ) : (
                      <UserCircle2 className="h-4 w-4" />
                    )}
                    <span className="truncate">Requested by {player.data?.requesterName?.trim() || "Unknown"}</span>
                  </div>
                </div>
              </div>
            </article>

            <article className="rounded-md border border-border/70 bg-panel-soft/70 p-4 shadow-soft">
              <h3 className="mb-2 text-sm font-semibold">Audio Cache Status</h3>
              <p className="mb-2 text-xs text-muted-foreground">Cache Size: {cache.data?.sizeMb ?? 142} MB</p>
              <Progress value={cacheProgress} className="h-2" />
              <Button
                variant="outline"
                className="mt-3 w-full border-primary/50 text-primary hover:bg-accent/40"
                onClick={() => cleanCacheMutation.mutate()}
                disabled={cleanCacheMutation.isPending}
              >
                {cleanCacheMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Clean Audio Cache
              </Button>
            </article>

            {canViewStaffTab && (
              <article className="rounded-md border border-border/70 bg-panel-soft/70 p-4 shadow-soft">
                <h3 className="mb-2 text-sm font-semibold">Session Permissions</h3>
                {manageableUsers.length ? (
                  manageableUsers.map((user) => (
                    <div key={user.id} className="mb-2 last:mb-0 rounded-md border border-border/70 bg-panel p-2.5">
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-sm font-medium text-foreground">{user.name}</p>
                        <Badge variant="outline" className="border-primary/40 text-primary">Role {user.roleLevel}</Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="flex items-center justify-between rounded-md border border-border/70 px-2 py-1.5">
                          <span className="text-xs text-muted-foreground">DJ</span>
                          <Switch
                            checked={user.permissions.dj}
                            onCheckedChange={() => toggleUserPermission(user.id, "dj")}
                          />
                        </div>
                        <div className="flex items-center justify-between rounded-md border border-border/70 px-2 py-1.5">
                          <span className="text-xs text-muted-foreground">Staff</span>
                          <Switch
                            checked={user.permissions.staff}
                            onCheckedChange={() => toggleUserPermission(user.id, "staff")}
                          />
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="rounded-md border border-border/70 bg-panel/70 px-3 py-2 text-xs text-muted-foreground">
                    No other users in this session.
                  </p>
                )}
              </article>
            )}

            <article className="rounded-md border border-border/70 bg-panel-soft/70 p-4 shadow-soft">
              <h3 className="mb-2 text-sm font-semibold">Recent History</h3>
              <div className="space-y-2 overflow-y-auto" style={{ maxHeight: 132 }}>
                {(history.data ?? []).slice(0, 3).map((track, index) =>
                  queueRow(track, index, () => undefined, () => undefined, () => undefined, false, false),
                )}
              </div>
            </article>

            <AuditLogViewer />

            <article className="rounded-xl border border-primary/35 bg-panel-soft/70 p-4 shadow-soft neon-edge">
              <h3 className="mb-2 text-sm font-semibold text-primary">Playlist Presets</h3>
              <p className="rounded-md border border-border/70 bg-panel/70 px-3 py-2 text-xs text-muted-foreground">
                Playlist Builder now edits saved playlists only. It no longer pushes tracks to the live queue.
              </p>
            </article>
          </section>

          <section className="px-4 pb-4">
            <Tabs defaultValue="playlist-builder" className="rounded-md border border-border/70 bg-panel-soft/70 p-4 shadow-soft">
              <TabsList className="mb-3 h-9">
                <TabsTrigger value="playlist-builder">Playlist Builder</TabsTrigger>
              </TabsList>

              <TabsContent value="playlist-builder" className="mt-0 space-y-3">
                <div className="grid gap-3 lg:grid-cols-[300px_1fr]">
                  <aside className="rounded-md border border-border/70 bg-panel/80 p-3">
                    <h3 className="mb-2 text-sm font-semibold text-primary">Saved Playlists</h3>
                    <div className="mb-3 grid grid-cols-[1fr_auto] gap-2">
                      <Input
                        value={newPresetName}
                        onChange={(e) => setNewPresetName(e.target.value)}
                        placeholder="New playlist name"
                        className="h-9 bg-panel-soft/60"
                      />
                      <Button
                        size="sm"
                        className="h-9 neon-glow"
                        onClick={createPreset}
                        disabled={!newPresetName.trim() || createPresetMutation.isPending}
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    <div className="space-y-2" style={{ maxHeight: 360, overflowY: "auto" }}>
                      {presetsData.length ? (
                        presetsData.map((preset, idx) => {
                          const presetId = getPresetId(preset);
                          const isActive = activePresetId === presetId;
                          return (
                            <div
                              key={`${presetId}-${idx}`}
                              className={`flex items-center justify-between rounded-md border p-2 transition ${
                                isActive ? "border-primary/55 bg-accent/30" : "border-border/70 bg-panel-soft/70"
                              }`}
                            >
                              <button
                                type="button"
                                className="min-w-0 flex-1 text-left"
                                onClick={() => setActivePresetId(presetId)}
                              >
                                <p className="truncate text-xs font-semibold text-foreground">{preset.name}</p>
                                <p className="text-[11px] text-muted-foreground">{preset.tracks ?? preset.items?.length ?? 0} tracks</p>
                              </button>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-muted-foreground hover:bg-accent/35 hover:text-primary"
                                onClick={() => deletePreset(preset)}
                                disabled={deletePresetMutation.isPending}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          );
                        })
                      ) : (
                        <p className="rounded-md border border-border/70 bg-panel/70 px-3 py-2 text-xs text-muted-foreground">
                          No saved playlists yet.
                        </p>
                      )}
                    </div>
                  </aside>

                  <section className="rounded-md border border-border/70 bg-panel/80 p-3">
                    <h3 className="mb-2 text-sm font-semibold text-primary">Active Editor</h3>
                    {activePreset ? (
                      <>
                        <p className="mb-2 text-xs text-muted-foreground">Editing: {activePreset.name}</p>
                        <div className="relative mb-3">
                          <Input
                            value={playlistBuilderQuery}
                            onChange={(e) => setPlaylistBuilderQuery(e.target.value)}
                            placeholder="Search catalog and add tracks to this playlist..."
                            className="h-9 bg-panel-soft/60"
                          />

                          {playlistBuilderQuery.trim().length > 1 && (
                            <div className="absolute left-0 right-0 z-20 mt-1 max-h-56 space-y-2 overflow-y-auto rounded-md border border-border/70 bg-panel p-2 shadow-lg">
                              {playlistSearch.isFetching ? (
                                <div className="flex items-center gap-2 rounded-md border border-border/70 bg-panel-soft/70 px-3 py-2 text-xs text-muted-foreground">
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  Searching...
                                </div>
                              ) : playlistSearch.isError ? (
                                <p className="rounded-md border border-border/70 bg-panel-soft/70 px-3 py-2 text-xs text-muted-foreground">
                                  Service Unavailable
                                </p>
                              ) : (playlistSearch.data ?? []).length ? (
                                (playlistSearch.data ?? []).map((track) => (
                                  <div key={track.id} className="flex items-center gap-2 rounded-md border border-border/70 bg-panel-soft/70 p-2">
                                    {track.thumbnail ? (
                                      <img src={track.thumbnail} alt={`${track.title} thumbnail`} loading="lazy" className="h-12 w-12 rounded-md object-cover" />
                                    ) : (
                                      <div className="flex h-12 w-12 items-center justify-center rounded-md border border-border/70 bg-panel">
                                        <Disc3 className="h-4 w-4 text-muted-foreground" />
                                      </div>
                                    )}
                                    <div className="min-w-0 flex-1">
                                      <p className="truncate text-xs font-semibold text-foreground">{track.title}</p>
                                      <p className="truncate text-[11px] text-muted-foreground">{track.artist}</p>
                                    </div>
                                    <Button
                                      size="icon"
                                      className="h-8 w-8 neon-glow"
                                      onClick={() => addTrackToActivePreset(track)}
                                      disabled={addTrackToPresetMutation.isPending}
                                      aria-label={`Add ${track.title} to playlist`}
                                    >
                                      <Plus className="h-4 w-4" />
                                    </Button>
                                  </div>
                                ))
                              ) : (
                                  <p className="rounded-md border border-border/70 bg-panel-soft/70 px-3 py-2 text-xs text-muted-foreground">
                                    No results found.
                                </p>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="mb-3 rounded-md border border-primary/35 bg-accent/20 p-3">
                          <p className="mb-2 text-xs font-semibold text-primary">Import External Playlist</p>
                          <div className="flex items-center gap-2">
                            <Input
                              value={playlistImportUrl}
                              onChange={(e) => setPlaylistImportUrl(e.target.value)}
                              placeholder="Paste YouTube or Spotify playlist URL"
                              className="h-9 bg-panel-soft/60"
                            />
                            <Button
                              type="button"
                              onClick={importExternalPlaylist}
                              disabled={importPlaylistToPresetMutation.isPending}
                              className="h-9"
                            >
                              {importPlaylistToPresetMutation.isPending ? (
                                <span className="inline-flex items-center gap-2">
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                  Importing...
                                </span>
                              ) : (
                                "Import Playlist"
                              )}
                            </Button>
                          </div>
                        </div>

                        <button
                          onClick={() => handleDeployToQueue(activePresetTracks as any[])}
                          className="w-full mb-4 p-3 bg-neonGreen text-black font-bold rounded-xl hover:bg-neonGreen/80 transition-all flex items-center justify-center gap-2"
                        >
                          <Play size={18} /> Deploy Playlist to Live Bot Queue
                        </button>

                        <div className="space-y-2" style={{ maxHeight: 260, overflowY: "auto" }}>
                          {activePresetTracks.length ? (
                            activePresetTracks.map((track, index) => (
                              <div key={`${track.id}-${index}`} className="flex items-center justify-between rounded-md border border-border/70 bg-panel-soft/70 p-2">
                                <div className="min-w-0">
                                  <p className="truncate text-xs font-semibold text-foreground">{track.title}</p>
                                  <p className="truncate text-[11px] text-muted-foreground">{track.artist}</p>
                                </div>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7 text-muted-foreground hover:bg-accent/35 hover:text-primary"
                                  onClick={() => removeTrackFromActivePreset(index)}
                                  disabled={removeTrackFromPresetMutation.isPending}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            ))
                          ) : (
                            <p className="rounded-md border border-border/70 bg-panel/70 px-3 py-2 text-xs text-muted-foreground">
                              No tracks in this playlist yet.
                            </p>
                          )}
                        </div>
                      </>
                    ) : (
                      <p className="rounded-md border border-border/70 bg-panel/70 px-3 py-2 text-xs text-muted-foreground">
                        Create a playlist on the left to start editing.
                      </p>
                    )}
                  </section>
                </div>
              </TabsContent>
            </Tabs>
          </section>
        </main>
      </div>

      <Dialog open={scoreSummaryOpen} onOpenChange={setScoreSummaryOpen}>
        <DialogContent className="max-w-sm border-primary/35 bg-panel text-foreground">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-primary"><Trophy className="h-5 w-5" /> Score Summary</DialogTitle>
            <DialogDescription>Party of 1 run complete.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-md border border-border/70 bg-panel-soft/70 p-3">
              <p className="text-xs text-muted-foreground">Final Score</p>
              <p className="text-lg font-semibold text-primary">{karaokeScore.toLocaleString()}</p>
            </div>
            <div className="rounded-md border border-border/70 bg-panel-soft/70 p-3">
              <p className="text-xs text-muted-foreground">Best Combo</p>
              <p className="text-lg font-semibold text-primary">x{maxCombo}</p>
            </div>
          </div>
          <DialogFooter>
            <Button className="neon-glow" onClick={() => setScoreSummaryOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <footer className="fixed bottom-0 left-0 right-0 z-30 border-t border-border/70 bg-panel/90 px-4 py-3 backdrop-blur-xl">
        <div className="grid grid-cols-1 items-center gap-4 md:grid-cols-[1.2fr_1.6fr_1fr]">
          <div className="flex min-w-0 items-center gap-3">
            {player.data?.art ? (
              <img src={player.data.art} alt="Now playing cover" className="h-14 w-14 rounded object-cover" />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded border border-border bg-panel">
                <Disc3 className="h-5 w-5 text-muted-foreground" />
              </div>
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{playerUnavailable ? "Service Unavailable" : player.data?.title ?? "No track playing"}</p>
              <p className="truncate text-xs text-muted-foreground">{playerUnavailable ? "Service Unavailable" : player.data?.artist ?? "Unknown artist"}</p>
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-center gap-2">
              <Button size="icon" variant="secondary" className="border border-primary/35 text-primary hover:bg-accent/35" onClick={() => previousTrackMutation.mutate()}>
                <SkipBack className="h-4 w-4" />
              </Button>
              <Button size="icon" className="h-12 w-12 rounded-full neon-glow" onClick={() => playbackMutation.mutate("play_pause")}>
                {player.data?.isPaused === false ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
              </Button>
              <Button size="icon" variant="secondary" className="border border-primary/35 text-primary hover:bg-accent/35" onClick={() => playbackMutation.mutate("next")}>
                <SkipForward className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="secondary" className="border border-primary/35 text-primary hover:bg-accent/35" onClick={() => playbackMutation.mutate("stop")}>
                <Square className="h-4 w-4" />
              </Button>
            </div>
            <Progress value={playerProgress} className="h-1.5" />
            <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
              <span ref={currentPositionRef}>{formatSec(player.data?.positionSec ?? 0)}</span>
              <span ref={totalDurationRef}>{formatSec(player.data?.durationSec ?? 0)}</span>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3">
            <div className="flex w-44 items-center gap-2">
              <Volume2 className="h-4 w-4 text-primary" />
              <Slider
                value={[displayVolume]}
                max={200}
                step={1}
                onValueChange={([v]) => setUiVolume(v)}
                onValueCommit={([v]) => volumeMutation.mutate(v)}
                className="neon-glow rounded-full"
              />
              <span className={`w-12 text-right text-sm font-semibold text-primary ${boostActive ? "animate-pulse neon-text-boost" : "neon-text"}`}>
                {displayVolume}%
              </span>
            </div>
            <Separator orientation="vertical" className="hidden h-7 md:block" />
            <Button variant="outline" className="border-primary/55 text-primary hover:bg-accent/35" onClick={() => clearQueueMutation.mutate()}>
              Clear Queue
            </Button>
            <Button variant="outline" className="border-primary/55 text-primary hover:bg-accent/35" size="icon" onClick={() => leaveMutation.mutate()}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </footer>

      {loading && (
        <div className="pointer-events-none fixed right-4 top-4 z-40 rounded-md border border-primary/45 bg-panel px-3 py-1 text-xs text-primary neon-glow">
          Syncing live data...
        </div>
      )}
    </div>
  );
};

export default Index;
