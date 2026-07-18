const BASE = '/api'

function getToken() {
  return localStorage.getItem('ss_token')
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken()
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  })

  if (res.status === 401) {
    localStorage.removeItem('ss_token')
    localStorage.removeItem('ss_refresh')
    window.location.replace('/login')
    throw new Error('Session expired')
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(body.error ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

// ── Auth ──────────────────────────────────────────────────────────────────────
export const authApi = {
  login:    (email: string, password: string) =>
    request<{ user: User; accessToken: string; refreshToken: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  register: (email: string, password: string, displayName: string) =>
    request<{ user: User; accessToken: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, displayName }),
    }),
  me:       () => request<{ user: User }>('/auth/me'),
  logout:   (refreshToken?: string) =>
    request('/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken }) }),
  deactivate: (password: string) =>
    request('/auth/account/deactivate', { method: 'POST', body: JSON.stringify({ password }) }),
  reactivate: (email: string, password: string) =>
    request<{ user: User; accessToken: string; refreshToken: string }>('/auth/account/reactivate', { method: 'POST', body: JSON.stringify({ email, password }) }),
  deleteAccount: (password: string) =>
    request('/auth/account', { method: 'DELETE', body: JSON.stringify({ password, confirmation: 'SUPPRIMER' }) }),
}

// ── Workspaces ────────────────────────────────────────────────────────────────
export const wsApi = {
  list:   () => request<{ workspaces: Workspace[] }>('/workspaces'),
  create: (name: string, slug: string) =>
    request<{ workspace: Workspace }>('/workspaces', {
      method: 'POST',
      body: JSON.stringify({ name, slug }),
    }),
  get: (id: string) => request<{ workspace: Workspace }>(`/workspaces/${id}`),
}

// ── Tracks ────────────────────────────────────────────────────────────────────
export const trackApi = {
  list:   (wsId: string, q?: string) =>
    request<{ tracks: Track[]; total: number }>(`/workspaces/${wsId}/tracks?limit=10000${q ? `&q=${q}` : ''}`),
  search: (wsId: string, q: string, offset = 0) =>
    request<{ results: SCResult[]; hasMore: boolean; nextOffset: number | null }>(
      `/workspaces/${wsId}/tracks/search?q=${encodeURIComponent(q)}&offset=${offset}`
    ),
  resolve: (wsId: string, url: string) =>
    request<{ result: SCResult }>(`/workspaces/${wsId}/tracks/resolve?url=${encodeURIComponent(url)}`),
  resolveSocial: (wsId: string, url: string) =>
    request<{ result: SocialResult }>(`/workspaces/${wsId}/tracks/resolve-social?url=${encodeURIComponent(url)}`),
  scrape: (wsId: string, soundcloudUrl: string) =>
    request<{ track: Track; alreadyExists?: boolean }>(`/workspaces/${wsId}/tracks/scrape`, {
      method: 'POST',
      body: JSON.stringify({ soundcloudUrl }),
    }),
  scrapeSocial: (wsId: string, url: string, outputFormat: 'MP3' | 'MP4' = 'MP3') =>
    request<{ track?: Track; video?: VideoFile; alreadyExists?: boolean; status?: 'queued'; jobId?: string; meta?: { title: string; thumbnail?: string } }>(`/workspaces/${wsId}/tracks/scrape-social`, {
      method: 'POST',
      body: JSON.stringify({ url, outputFormat }),
    }),
  delete: (wsId: string, trackId: string) =>
    request(`/workspaces/${wsId}/tracks/${trackId}`, { method: 'DELETE' }),
  update: (wsId: string, trackId: string, data: { title?: string; artist?: string; featuring?: string; album?: string; artworkUrl?: string }) =>
    request<{ track: Track }>(`/workspaces/${wsId}/tracks/${trackId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  streamUrl: (wsId: string, trackId: string) => {
    const token = getToken()
    const base = `/api/workspaces/${wsId}/tracks/${trackId}/stream`
    return token ? `${base}?token=${encodeURIComponent(token)}` : base
  },
  stemUrl: (wsId: string, trackId: string, stemType: 'vocals' | 'instrumental') => {
    const token = getToken()
    const base = `/api/workspaces/${wsId}/tracks/${trackId}/stems/${stemType}`
    return token ? `${base}?token=${encodeURIComponent(token)}` : base
  },
  separate: (wsId: string, trackId: string) =>
    request<{ vocals: boolean; instrumental: boolean }>(
      `/workspaces/${wsId}/tracks/${trackId}/separate`,
      { method: 'POST' },
    ),
  previewUrl: (wsId: string, streamUrl: string) => {
    const token = getToken()
    const params = new URLSearchParams({ streamUrl })
    if (token) params.set('token', token)
    return `/api/workspaces/${wsId}/tracks/stream-preview?${params}`
  },
  sendViaTelegram: (wsId: string, trackIds: string[], botId: string, opts?: { message?: string; groupFiles?: boolean }) =>
    request<{ results: { trackId: string; ok: boolean; error?: string }[] }>(
      `/workspaces/${wsId}/tracks/send`,
      { method: 'POST', body: JSON.stringify({ trackIds, botId, message: opts?.message, groupFiles: opts?.groupFiles }) },
    ),
  importFromWorkspace: (toWsId: string, fromWorkspaceId: string, trackIds: string[]) =>
    request<{ imported: object[]; count: number }>(
      `/workspaces/${toWsId}/tracks/import`,
      { method: 'POST', body: JSON.stringify({ fromWorkspaceId, trackIds }) },
    ),
  syncTelegram: (wsId: string, botId: string) =>
    request<{ imported: number; skipped: number; tracks: Track[] }>(
      `/workspaces/${wsId}/tracks/sync-telegram`,
      { method: 'POST', body: JSON.stringify({ botId }) },
    ),
  /** Returns an EventSource URL for the full MTProto sync (SSE stream). */
  syncTelegramFullUrl: (wsId: string, botId: string): string => {
    const token = getToken() ?? ''
    return `/api/workspaces/${wsId}/tracks/sync-telegram-full?botId=${encodeURIComponent(botId)}&token=${encodeURIComponent(token)}`
  },
  uploadArtwork: async (wsId: string, trackId: string, file: File): Promise<{ artworkUrl: string }> => {
    const token = getToken()
    const formData = new FormData()
    formData.append('artwork', file)
    const res = await fetch(`${BASE}/workspaces/${wsId}/tracks/${trackId}/artwork`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    })
    if (res.status === 401) {
      localStorage.removeItem('ss_token')
      localStorage.removeItem('ss_refresh')
      window.location.replace('/login')
      throw new Error('Session expired')
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error(body.error ?? `HTTP ${res.status}`)
    }
    return res.json()
  },
  recentArtworks: (wsId: string) =>
    request<{ artworkUrls: string[] }>(`/workspaces/${wsId}/tracks/recent-artworks`),
  uploadTrack: async (wsId: string, file: File): Promise<{ track: Track }> => {
    const token = getToken()
    const formData = new FormData()
    formData.append('file', file)
    const res = await fetch(`${BASE}/workspaces/${wsId}/tracks/upload`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    })
    if (res.status === 401) {
      localStorage.removeItem('ss_token')
      localStorage.removeItem('ss_refresh')
      window.location.replace('/login')
      throw new Error('Session expired')
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error(body.error ?? `HTTP ${res.status}`)
    }
    return res.json()
  },
}

// ── Bots ──────────────────────────────────────────────────────────────────────
export const botApi = {
  list:   (wsId: string) => request<{ bots: Bot[] }>(`/workspaces/${wsId}/bots`),
  create: (wsId: string, data: { name: string; telegramToken: string; channelId: string }) =>
    request<{ bot: Bot; warning?: string }>(`/workspaces/${wsId}/bots`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  action: (wsId: string, botId: string, action: 'start' | 'stop' | 'pause' | 'resume' | 'restart') =>
    request<{ bot: Bot }>(`/workspaces/${wsId}/bots/${botId}/action`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    }),
  logs:   (wsId: string, botId: string) =>
    request<{ logs: string }>(`/workspaces/${wsId}/bots/${botId}/logs`),
  update: (wsId: string, botId: string, data: { channelId?: string; reaction?: string | null; telegramToken?: string }) =>
    request<{ bot: Bot }>(`/workspaces/${wsId}/bots/${botId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  delete: (wsId: string, botId: string) =>
    request(`/workspaces/${wsId}/bots/${botId}`, { method: 'DELETE' }),
}

// ── Gallery ───────────────────────────────────────────────────────────────────
export const galleryApi = {
  list:     (wsId: string) => request<{ videos: VideoFile[] }>(`/workspaces/${wsId}/gallery`),
  delete:   (wsId: string, videoId: string) =>
    request(`/workspaces/${wsId}/gallery/${videoId}`, { method: 'DELETE' }),
  downloadUrl: (wsId: string, videoId: string) => {
    const token = getToken()
    return token
      ? `/api/workspaces/${wsId}/gallery/${videoId}/download?token=${encodeURIComponent(token)}`
      : `/api/workspaces/${wsId}/gallery/${videoId}/download`
  },
  streamUrl: (wsId: string, videoId: string) => {
    const token = getToken()
    return token
      ? `/api/workspaces/${wsId}/gallery/${videoId}/stream?token=${encodeURIComponent(token)}`
      : `/api/workspaces/${wsId}/gallery/${videoId}/stream`
  },
  thumbnailUrl: (wsId: string, videoId: string) => {
    const token = getToken()
    return token
      ? `/api/workspaces/${wsId}/gallery/${videoId}/thumbnail?token=${encodeURIComponent(token)}`
      : `/api/workspaces/${wsId}/gallery/${videoId}/thumbnail`
  },
}

// ── Types ─────────────────────────────────────────────────────────────────────
export interface User {
  id: string; email: string; displayName: string; globalRole: string
}
export interface Workspace {
  id: string; name: string; slug: string; ownerId: string; myRole?: string; myLibSend?: boolean
  _count?: { tracks: number; bots: number; members: number }
}
export interface Track {
  id: string; workspaceId: string; title: string; artist?: string
  featuring?: string; album?: string
  duration?: number; fileSize?: number; format: string; filePath: string
  artworkUrl?: string; soundcloudUrl?: string; playCount: number; createdAt: string
  sent?: boolean
}
export interface SCResult {
  id: string; title: string; artist: string; artworkUrl?: string
  duration?: number; permalink_url: string; streamUrl?: string
  likesCount?: number; playCount?: number; createdAt?: string
}
export interface SocialResult {
  id: string; title: string; artist: string; artworkUrl?: string
  duration?: number; permalink_url: string
  platform: 'tiktok' | 'instagram' | 'twitter' | 'snapchat'
}
export interface VideoFile {
  id: string; workspaceId: string; title: string; artist?: string
  platform: string; sourceUrl: string; filePath: string
  thumbnailUrl?: string; duration?: number; fileSize?: number
  socialId?: string; createdAt: string
}
export interface Bot {
  id: string; workspaceId: string; name: string; telegramToken: string
  channelId: string; containerId?: string; status: string
  broadcastCount: number; reaction?: string | null; createdAt: string
}
export interface MemberUser {
  id: string; email: string; displayName: string
}
export type AllPermKey =
  | 'canLibrary' | 'canStudio' | 'canMontage' | 'canChannels'
  | 'libRead' | 'libWrite' | 'libDelete' | 'libSend'
  | 'montageView' | 'montageEdit' | 'montageDelete'
  | 'chanView' | 'chanManage' | 'chanDelete'
export interface WorkspaceMember {
  id: string; workspaceId: string; userId: string; role: string
  canLibrary: boolean; canStudio: boolean; canMontage: boolean; canChannels: boolean
  libRead: boolean; libWrite: boolean; libDelete: boolean; libSend: boolean
  montageView: boolean; montageEdit: boolean; montageDelete: boolean
  chanView: boolean; chanManage: boolean; chanDelete: boolean
  joinedAt: string; user: MemberUser
}

// ── Members ───────────────────────────────────────────────────────────────────
export const memberApi = {
  list: (wsId: string) =>
    request<{ members: WorkspaceMember[] }>(`/workspaces/${wsId}/members`),
  add: (wsId: string, email: string, perms: Partial<Record<AllPermKey, boolean>>) =>
    request<{ member: WorkspaceMember }>(`/workspaces/${wsId}/members`, {
      method: 'POST', body: JSON.stringify({ email, ...perms }),
    }),
  updatePerms: (wsId: string, memberId: string, perms: Partial<Record<AllPermKey, boolean>>) =>
    request<{ member: WorkspaceMember }>(`/workspaces/${wsId}/members/${memberId}`, {
      method: 'PATCH', body: JSON.stringify(perms),
    }),
  remove: (wsId: string, memberId: string) =>
    request(`/workspaces/${wsId}/members/${memberId}`, { method: 'DELETE' }),
  searchUsers: (wsId: string, q: string) =>
    request<{ users: MemberUser[] }>(`/workspaces/${wsId}/users/search?q=${encodeURIComponent(q)}`),
}

// ── Montage ───────────────────────────────────────────────────────────────────
export type MontageStyle = 'DARK_TRAP' | 'CLEAN_MINIMAL' | 'HYPER_POP' | 'FAST_CUTS' | 'SLOW_MOTION' | 'CINEMATIC' | 'AMBIENT' | 'LYRIC_VIDEO' | 'EQ_VISUALIZER'
export type MontageDuration = 'AUTO' | 'SECONDS_15' | 'SECONDS_30' | 'SECONDS_60' | 'FULL_SONG'
export type MontageRatio = 'LANDSCAPE' | 'PORTRAIT' | 'SQUARE'

export interface MontageSourceVideo {
  id: string; projectId: string; type: 'URL' | 'UPLOAD'; source: string
  localPath: string | null; duration: number | null; createdAt: string
}
export interface MontageRenderJob {
  id: string; projectId: string; status: 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED'
  progress: number; currentStep: string; logs: string; error: string | null
  startedAt: string | null; finishedAt: string | null; createdAt: string
}
export interface MontageProject {
  id: string; workspaceId: string; title: string
  style: MontageStyle; durationMode: MontageDuration; ratio: MontageRatio
  audioPath: string | null; audioDuration: number | null
  outputPath: string | null; outputPortraitPath: string | null; outputSquarePath: string | null
  beatData: string | null; subtitleData: string | null
  status: 'DRAFT' | 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED'
  createdAt: string; updatedAt: string
  sourceVideos: MontageSourceVideo[]
  renderJob: MontageRenderJob | null
}

export interface MontageClip {
  id: string; projectId: string; sourceVideoId: string; position: number
  clipStart: number; clipEnd: number; outputStart: number; outputDuration: number
  effects: string; transition: string
  scoreMotion: number; scoreBrightness: number; scoreSharpness: number; scoreOverall: number
  createdAt: string
}

export interface BeatData {
  bpm: number; duration: number
  beats: number[]; drops: number[]
  bassHits: number[]              // sub-bass / kick peaks → primary frame-cut triggers
  audioOffset?: number            // best-segment start time (seconds from audio start)
  sections: Array<{ type: string; start: number; end: number; energy: number }>
}

async function uploadFile<T>(path: string, fieldName: string, file: File, extraFields?: Record<string, string>): Promise<T> {
  const token = getToken()
  const form = new FormData()
  form.append(fieldName, file)
  if (extraFields) { for (const [k, v] of Object.entries(extraFields)) form.append(k, v) }
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  })
  if (res.status === 401) { localStorage.removeItem('ss_token'); window.location.replace('/login'); throw new Error('Session expired') }
  if (!res.ok) { const b = await res.json().catch(() => ({ error: res.statusText })); throw new Error(b.error ?? `HTTP ${res.status}`) }
  return res.json()
}

export const montageApi = {
  list:        (wsId: string) => request<{ projects: MontageProject[] }>(`/workspaces/${wsId}/montage`),
  create:      (wsId: string, data: { title: string; style: MontageStyle; durationMode: MontageDuration; ratio: MontageRatio }) =>
    request<{ project: MontageProject }>(`/workspaces/${wsId}/montage`, { method: 'POST', body: JSON.stringify(data) }),
  get:         (wsId: string, id: string) => request<{ project: MontageProject }>(`/workspaces/${wsId}/montage/${id}`),
  delete:      (wsId: string, id: string) => request(`/workspaces/${wsId}/montage/${id}`, { method: 'DELETE' }),
  patch:       (wsId: string, id: string, data: Partial<{ title: string; style: MontageStyle; durationMode: MontageDuration; ratio: MontageRatio; audioPath: null }>) =>
    request<{ project: MontageProject }>(`/workspaces/${wsId}/montage/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  uploadAudio: (wsId: string, id: string, file: File) => uploadFile<{ project: MontageProject }>(`/workspaces/${wsId}/montage/${id}/audio`, 'audio', file),
  audioFromTrack: (wsId: string, id: string, trackId: string) =>
    request<{ project: MontageProject }>(`/workspaces/${wsId}/montage/${id}/audio-from-track`, { method: 'POST', body: JSON.stringify({ trackId }) }),
  audioFromVideo: (wsId: string, id: string, sourceVideoId: string, audioTrackIndex = 0) =>
    request<{ project: MontageProject }>(`/workspaces/${wsId}/montage/${id}/audio-from-video`, { method: 'POST', body: JSON.stringify({ sourceVideoId, audioTrackIndex }) }),
  addVideoUrl: (wsId: string, id: string, url: string) =>
    request<{ sourceVideo: MontageSourceVideo; downloading: boolean }>(`/workspaces/${wsId}/montage/${id}/video-url`, { method: 'POST', body: JSON.stringify({ url }) }),
  uploadVideo: (wsId: string, id: string, file: File) => uploadFile<{ sourceVideo: MontageSourceVideo }>(`/workspaces/${wsId}/montage/${id}/video-upload`, 'video', file),
  removeVideo: (wsId: string, id: string, svId: string) => request(`/workspaces/${wsId}/montage/${id}/videos/${svId}`, { method: 'DELETE' }),
  duplicateVideo: (wsId: string, id: string, svId: string) =>
    request<{ sourceVideo: MontageSourceVideo }>(`/workspaces/${wsId}/montage/${id}/videos/${svId}/duplicate`, { method: 'POST' }),
  videoFromGallery: (wsId: string, id: string, videoFileId: string) =>
    request<{ sourceVideo: MontageSourceVideo }>(`/workspaces/${wsId}/montage/${id}/video-from-gallery`, { method: 'POST', body: JSON.stringify({ videoFileId }) }),
  generate:    (wsId: string, id: string) => request<{ job: MontageRenderJob }>(`/workspaces/${wsId}/montage/${id}/generate`, { method: 'POST' }),
  status:      (wsId: string, id: string) => request<{ job: MontageRenderJob | null; status: string; outputPath: string | null }>(`/workspaces/${wsId}/montage/${id}/status`),
  transcribe:  (wsId: string, id: string, opts?: { language?: string; model?: string }) =>
    request<{ segments: Array<{ start: number; end: number; text: string }> }>(
      `/workspaces/${wsId}/montage/${id}/transcribe`,
      { method: 'POST', body: JSON.stringify(opts ?? {}) },
    ),
  downloadUrl: (wsId: string, id: string) => {
    const token = getToken()
    return `/api/workspaces/${wsId}/montage/${id}/download${token ? `?token=${encodeURIComponent(token)}` : ''}`
  },
  // Separate stream URL for the <video> player — uses the /stream endpoint which
  // supports HTTP Range requests (206 Partial Content), enabling seeking in the player.
  streamUrl: (wsId: string, id: string) => {
    const token = getToken()
    return `/api/workspaces/${wsId}/montage/${id}/stream${token ? `?token=${encodeURIComponent(token)}` : ''}`
  },
  audioUrl: (wsId: string, id: string) => {
    const token = getToken()
    return `/api/workspaces/${wsId}/montage/${id}/audio${token ? `?token=${encodeURIComponent(token)}` : ''}`
  },
  publish: (wsId: string, id: string, data: { accountId: string; platform: string; caption?: string; hashtags?: string; scheduledAt?: string }) =>
    request<{ post: SocialPost }>(`/workspaces/${wsId}/montage/${id}/publish`, { method: 'POST', body: JSON.stringify(data) }),
  listPosts: (wsId: string, id: string) =>
    request<{ posts: SocialPost[] }>(`/workspaces/${wsId}/montage/${id}/posts`),
  cancelPost: (wsId: string, id: string, postId: string) =>
    request(`/workspaces/${wsId}/montage/${id}/posts/${postId}`, { method: 'DELETE' }),
  reorderVideos: (wsId: string, id: string, order: string[]) =>
    request(`/workspaces/${wsId}/montage/${id}/videos/reorder`, { method: 'POST', body: JSON.stringify({ order }) }),
  // Generated clips
  getClips: (wsId: string, id: string) =>
    request<{ clips: MontageClip[] }>(`/workspaces/${wsId}/montage/${id}/clips`),
  updateClips: (wsId: string, id: string, clips: Array<{ id: string; position?: number; transition?: string; clipStart?: number; clipEnd?: number; outputStart?: number; outputDuration?: number }>) =>
    request(`/workspaces/${wsId}/montage/${id}/clips`, { method: 'PATCH', body: JSON.stringify({ clips }) }),
  addClip: (wsId: string, id: string, sourceVideoId: string, clipStart: number, clipEnd: number, extra?: { position?: number; outputStart?: number; outputDuration?: number; transition?: string; scoreOverall?: number; scoreMotion?: number; scoreBrightness?: number; scoreSharpness?: number; effects?: string }) =>
    request<{ clip: MontageClip }>(`/workspaces/${wsId}/montage/${id}/clips`, { method: 'POST', body: JSON.stringify({ sourceVideoId, clipStart, clipEnd, ...extra }) }),
  deleteClip: (wsId: string, id: string, clipId: string) =>
    request(`/workspaces/${wsId}/montage/${id}/clips/${clipId}`, { method: 'DELETE' }),
  renderEdits: (wsId: string, id: string) =>
    request<{ job: MontageRenderJob }>(`/workspaces/${wsId}/montage/${id}/render-edits`, { method: 'POST' }),
  getBeatData: (wsId: string, id: string) =>
    request<{ beatData: BeatData | null }>(`/workspaces/${wsId}/montage/${id}/beat-data`),
  saveSubtitles: (wsId: string, id: string, segments: Array<{ start: number; end: number; text: string }>, style?: Record<string, unknown>) =>
    request(`/workspaces/${wsId}/montage/${id}/subtitles`, { method: 'PATCH', body: JSON.stringify({ segments, style }) }),
  burnSubtitles: (wsId: string, id: string) =>
    request<{ ok: boolean }>(`/workspaces/${wsId}/montage/${id}/burn-subtitles`, { method: 'POST' }),
  generateMulti: (wsId: string, id: string) =>
    request<{ ok: boolean; message: string }>(`/workspaces/${wsId}/montage/${id}/generate-multi`, { method: 'POST' }),
  downloadFormatUrl: (wsId: string, id: string, ratio: 'LANDSCAPE' | 'PORTRAIT' | 'SQUARE') => {
    const token = getToken()
    return `/api/workspaces/${wsId}/montage/${id}/download-format?ratio=${ratio}${token ? `&token=${encodeURIComponent(token)}` : ''}`
  },
  frames: (wsId: string, id: string) => {
    const token = getToken()
    return request<{ frames: Array<{ id: string; videoId: string; time: number; url: string }> }>(
      `/workspaces/${wsId}/montage/${id}/frames${token ? `?token=${encodeURIComponent(token)}` : ''}`,
    )
  },
}

// ── Studio projects (audio studio save/restore) ─────────────────────────────
export interface StudioProjectMeta { id: string; name: string; createdAt: string; updatedAt: string }
export interface StudioProject extends StudioProjectMeta { data: string }

export const studioApi = {
  list:   (wsId: string) => request<{ projects: StudioProjectMeta[] }>(`/workspaces/${wsId}/studio`),
  get:    (wsId: string, id: string) => request<{ project: StudioProject }>(`/workspaces/${wsId}/studio/${id}`),
  create: (wsId: string, name: string, data: unknown) =>
    request<{ project: StudioProject }>(`/workspaces/${wsId}/studio`, { method: 'POST', body: JSON.stringify({ name, data }) }),
  update: (wsId: string, id: string, patch: { name?: string; data?: unknown }) =>
    request<{ project: StudioProject }>(`/workspaces/${wsId}/studio/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  delete: (wsId: string, id: string) => request(`/workspaces/${wsId}/studio/${id}`, { method: 'DELETE' }),
}

// ── Social ────────────────────────────────────────────────────────────────────
export type SocialPlatform = 'TIKTOK' | 'INSTAGRAM' | 'YOUTUBE' | 'TWITTER' | 'FACEBOOK' | 'SNAPCHAT' | 'LINKEDIN' | 'PINTEREST'
export interface SocialAccount {
  id: string
  platform: SocialPlatform
  accountName: string
  accountLabel: string | null
  accountId?: string
  createdAt: string
}
export interface SocialPost {
  id: string; projectId: string; platform: string
  caption?: string; hashtags?: string; scheduledAt?: string
  status: 'PENDING' | 'PUBLISHING' | 'DONE' | 'FAILED' | 'CANCELLED'
  error?: string; publishedUrl?: string; publishedAt?: string; createdAt: string
}
export const socialApi = {
  listAccounts: (wsId: string) =>
    request<{ accounts: SocialAccount[] }>(`/workspaces/${wsId}/social/accounts`),
  tiktokAuthUrl: (wsId: string) =>
    request<{ url: string }>(`/workspaces/${wsId}/social/tiktok/auth`),
  connect: (wsId: string, platform: string, data: {
    accountName: string; accountLabel?: string
    accessToken: string; refreshToken?: string; accountId?: string
  }) =>
    request<{ account: SocialAccount }>(`/workspaces/${wsId}/social/${platform.toLowerCase()}/connect`, {
      method: 'POST', body: JSON.stringify(data),
    }),
  update: (wsId: string, accountId: string, data: {
    accountName?: string; accountLabel?: string; accessToken?: string; refreshToken?: string
  }) =>
    request<{ account: SocialAccount }>(`/workspaces/${wsId}/social/accounts/${accountId}`, {
      method: 'PATCH', body: JSON.stringify(data),
    }),
  disconnect: (wsId: string, accountId: string) =>
    request(`/workspaces/${wsId}/social/accounts/${accountId}`, { method: 'DELETE' }),
}

// ── Admin ─────────────────────────────────────────────────────────────────────
export interface AdminStats {
  userCount: number; workspaceCount: number; trackCount: number
  botCount: number; activeBots: number
  uptimeSeconds: number; storageBytes: number; maxStorageBytes: number
}
export interface AdminUser {
  id: string; email: string; displayName: string; globalRole: string; createdAt: string
}
export const adminApi = {
  stats:   () => request<AdminStats>('/admin/stats'),
  users:   () => request<{ users: AdminUser[] }>('/admin/users'),
  setRole: (userId: string, globalRole: string) =>
    request<{ user: AdminUser }>(`/admin/users/${userId}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ globalRole }),
    }),
  getYouTubeCookies: () => request<{ configured: boolean; path: string; lines: number; mtime?: string }>('/admin/youtube-cookies'),
  saveYouTubeCookies: (cookies: string) =>
    request<{ ok: boolean; lines: number }>('/admin/youtube-cookies', {
      method: 'POST',
      body: JSON.stringify({ cookies }),
    }),
  deleteYouTubeCookies: () => request<{ ok: boolean }>('/admin/youtube-cookies', { method: 'DELETE' }),
}

// ── Tunnel ────────────────────────────────────────────────────────────────────
export interface TunnelJobStatus {
  id:           string
  status:       'pending' | 'running' | 'done' | 'failed'
  outputFormat: 'MP3' | 'MP4'
  meta:         { ytId: string; title: string; thumbnail?: string; duration?: number }
  error?:       string
  result?:      { trackId?: string; videoId?: string; title: string }
  updatedAt:    string
}

export const tunnelApi = {
  status: () => request<{ active: boolean; lastSeenMs: number }>('/tunnel/status'),
  pollJob: (jobId: string) => request<{ job: TunnelJobStatus }>(`/tunnel/jobs/${jobId}`),
}

// ── Converter ─────────────────────────────────────────────────────────────────
export interface ConversionJob {
  id: string; workspaceId: string
  inputName: string; inputFormat: string; outputFormat: string
  outputPath?: string; status: 'processing' | 'done' | 'error'
  errorMsg?: string; fileSize?: number; createdAt: string
}

export const convertApi = {
  convert: async (wsId: string, file: File, outputFormat: string): Promise<{ job: ConversionJob }> => {
    const token = getToken()
    const form  = new FormData()
    form.append('file', file)
    form.append('outputFormat', outputFormat)
    const res = await fetch(`${BASE}/workspaces/${wsId}/convert`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    })
    if (res.status === 401) { localStorage.removeItem('ss_token'); window.location.replace('/login'); throw new Error('Session expired') }
    if (!res.ok) { const b = await res.json().catch(() => ({ error: res.statusText })); throw new Error(b.error ?? `HTTP ${res.status}`) }
    return res.json()
  },
  history: (wsId: string) =>
    request<{ jobs: ConversionJob[] }>(`/workspaces/${wsId}/convert`),
  status: (wsId: string, jobId: string) =>
    request<{ job: ConversionJob }>(`/workspaces/${wsId}/convert/${jobId}`),
  downloadUrl: (wsId: string, jobId: string): string => {
    const token = getToken()
    return `/api/workspaces/${wsId}/convert/${jobId}/download${token ? `?token=${encodeURIComponent(token)}` : ''}`
  },
  delete: (wsId: string, jobId: string) =>
    request(`/workspaces/${wsId}/convert/${jobId}`, { method: 'DELETE' }),
}
