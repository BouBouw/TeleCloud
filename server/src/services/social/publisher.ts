/**
 * Social media publishing service.
 *
 * Token conventions (stored in SocialAccount):
 *   accessToken  = OAuth2 bearer token  OR  session cookie (platform-dependent)
 *   refreshToken = OAuth2 refresh token OR  CSRF token / secondary cookie
 *
 * Platform-specific notes:
 *   TIKTOK    — OAuth2 bearer from developers.tiktok.com (Content Posting API v2)
 *   INSTAGRAM — sessionid cookie (accessToken) + csrftoken cookie (refreshToken)
 *   YOUTUBE   — Google OAuth2 bearer (scope: youtube.upload)
 *   TWITTER   — OAuth2 User Access Token (scope: tweet.write, media.write)
 *   FACEBOOK  — Page Access Token (refreshToken = Page ID, fallback 'me')
 *   SNAPCHAT  — OAuth2 bearer (Snap Business API)
 *   LINKEDIN  — OAuth2 bearer (scope: w_member_social)
 *   PINTEREST — OAuth2 bearer + board ID in refreshToken
 */
import fs from 'fs/promises'

export interface PublishOptions {
  accessToken:   string
  refreshToken?: string | null
  videoPath: string
  caption:  string
  hashtags: string
  platform: string
}

export interface PublishResult {
  postId: string
  url?:   string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function cap(caption: string, hashtags: string, max = 2200): string {
  return `${caption}\n${hashtags}`.trim().slice(0, max)
}

async function readVideo(p: string): Promise<Buffer> {
  return fs.readFile(p)
}

// ── TikTok ────────────────────────────────────────────────────────────────────
// Content Posting API v2 — accessToken = OAuth2 bearer (developers.tiktok.com)
export async function publishToTikTok(opts: PublishOptions): Promise<PublishResult> {
  const video = await readVideo(opts.videoPath)
  const text  = cap(opts.caption, opts.hashtags, 2200)

  const initRes = await fetch('https://open.tiktokapis.com/v2/post/publish/video/init/', {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${opts.accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({
      post_info: {
        title:                    text,
        privacy_level:            'PUBLIC_TO_EVERYONE',
        disable_duet:             false,
        disable_comment:          false,
        disable_stitch:           false,
        video_cover_timestamp_ms: 1000,
      },
      source_info: {
        source:            'FILE_UPLOAD',
        video_size:        video.length,
        chunk_size:        video.length,
        total_chunk_count: 1,
      },
    }),
  })
  if (!initRes.ok) throw new Error(`TikTok init (${initRes.status}): ${await initRes.text()}`)
  const init = await initRes.json() as {
    data:  { publish_id: string; upload_url: string }
    error: { code: string; message: string }
  }
  if (init.error?.code && init.error.code !== 'ok') throw new Error(`TikTok: ${init.error.message}`)

  const { publish_id, upload_url } = init.data
  const upRes = await fetch(upload_url, {
    method:  'PUT',
    headers: {
      'Content-Type':   'video/mp4',
      'Content-Length': String(video.length),
      'Content-Range':  `bytes 0-${video.length - 1}/${video.length}`,
    },
    body: video,
  })
  if (!upRes.ok && upRes.status !== 206) throw new Error(`TikTok upload (${upRes.status})`)
  return { postId: publish_id }
}

// ── Instagram ─────────────────────────────────────────────────────────────────
// Cookie-based internal API — no developer app required
// accessToken = sessionid cookie value
// refreshToken = csrftoken cookie value
export async function publishToInstagram(opts: PublishOptions): Promise<PublishResult> {
  const video     = await readVideo(opts.videoPath)
  const caption   = cap(opts.caption, opts.hashtags, 2200)
  const csrftoken = opts.refreshToken ?? ''
  const uploadId  = Date.now().toString()
  const cookies   = `sessionid=${opts.accessToken}; csrftoken=${csrftoken}`

  const uploadRes = await fetch(`https://i.instagram.com/rupload_igvideo/${uploadId}_0`, {
    method:  'POST',
    headers: {
      Cookie:                       cookies,
      'X-CSRFToken':                csrftoken,
      'X-Instagram-Rupload-Params': JSON.stringify({
        media_type:                2,
        upload_id:                 uploadId,
        upload_media_duration_ms:  30000,
        upload_media_width:        1080,
        upload_media_height:       1920,
      }),
      'Content-Type':    'application/octet-stream',
      'Content-Length':  String(video.length),
      'X-Entity-Length': String(video.length),
      'X-Entity-Name':   `${uploadId}_0`,
      'X-Entity-Type':   'video/mp4',
      'Offset':          '0',
      'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    body: video,
  })
  if (!uploadRes.ok) throw new Error(`Instagram upload (${uploadRes.status}): ${await uploadRes.text()}`)

  const params = new URLSearchParams({
    upload_id:                     uploadId,
    caption,
    video_result:                  '',
    clips_share_preview_to_feed:   '1',
    disable_comments:              '0',
    like_and_view_counts_disabled: '0',
  })
  const cfgRes = await fetch('https://i.instagram.com/api/v1/media/configure_to_reel/', {
    method:  'POST',
    headers: {
      Cookie:         cookies,
      'X-CSRFToken':  csrftoken,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent':   'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    body: params.toString(),
  })
  if (!cfgRes.ok) throw new Error(`Instagram configure (${cfgRes.status}): ${await cfgRes.text()}`)
  const data = await cfgRes.json() as { media?: { id: string; code: string }; status: string }
  if (data.status !== 'ok') throw new Error(`Instagram configure: ${JSON.stringify(data)}`)
  const code = data.media?.code
  return {
    postId: data.media?.id ?? uploadId,
    url:    code ? `https://www.instagram.com/reel/${code}/` : undefined,
  }
}

// ── YouTube ───────────────────────────────────────────────────────────────────
// YouTube Data API v3 — accessToken = Google OAuth2 bearer (scope: youtube.upload)
export async function publishToYouTube(opts: PublishOptions): Promise<PublishResult> {
  const video       = await readVideo(opts.videoPath)
  const title       = opts.caption.slice(0, 100) || 'Nouveau montage'
  const description = `${opts.caption}\n\n${opts.hashtags}`.trim()
  const tags        = opts.hashtags.match(/#\w+/g)?.map(t => t.slice(1)) ?? []

  const initRes = await fetch(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    {
      method:  'POST',
      headers: {
        Authorization:             `Bearer ${opts.accessToken}`,
        'Content-Type':            'application/json',
        'X-Upload-Content-Type':   'video/mp4',
        'X-Upload-Content-Length': String(video.length),
      },
      body: JSON.stringify({
        snippet: { title, description, categoryId: '22', tags },
        status:  { privacyStatus: 'public', selfDeclaredMadeForKids: false },
      }),
    },
  )
  if (!initRes.ok) throw new Error(`YouTube init (${initRes.status}): ${await initRes.text()}`)
  const uploadUrl = initRes.headers.get('Location')
  if (!uploadUrl) throw new Error('YouTube: pas d\'URL d\'upload dans la réponse')

  const upRes = await fetch(uploadUrl, {
    method:  'PUT',
    headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(video.length) },
    body:    video,
  })
  if (!upRes.ok && upRes.status !== 200 && upRes.status !== 201) {
    throw new Error(`YouTube upload (${upRes.status}): ${await upRes.text()}`)
  }
  const yt = await upRes.json() as { id: string }
  return { postId: yt.id, url: `https://www.youtube.com/watch?v=${yt.id}` }
}

// ── Twitter / X ───────────────────────────────────────────────────────────────
// Twitter API v2 + v1.1 chunked media upload
// accessToken = OAuth2 User Access Token (scope: tweet.write, media.write)
export async function publishToTwitter(opts: PublishOptions): Promise<PublishResult> {
  const video = await readVideo(opts.videoPath)
  const text  = cap(opts.caption, opts.hashtags, 280)

  // INIT
  const initParams = new URLSearchParams({
    command:        'INIT',
    total_bytes:    String(video.length),
    media_type:     'video/mp4',
    media_category: 'tweet_video',
  })
  const initRes = await fetch('https://upload.twitter.com/1.1/media/upload.json', {
    method:  'POST',
    headers: { Authorization: `Bearer ${opts.accessToken}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    initParams.toString(),
  })
  if (!initRes.ok) throw new Error(`Twitter media init (${initRes.status}): ${await initRes.text()}`)
  const { media_id_string } = await initRes.json() as { media_id_string: string }

  // APPEND (5 MB chunks)
  const CHUNK = 5 * 1024 * 1024
  let seg = 0
  for (let off = 0; off < video.length; off += CHUNK) {
    const chunk = video.subarray(off, off + CHUNK)
    const fd = new FormData()
    fd.append('command',       'APPEND')
    fd.append('media_id',      media_id_string)
    fd.append('segment_index', String(seg++))
    fd.append('media', new Blob([chunk], { type: 'video/mp4' }))
    const aRes = await fetch('https://upload.twitter.com/1.1/media/upload.json', {
      method: 'POST', headers: { Authorization: `Bearer ${opts.accessToken}` }, body: fd,
    })
    if (!aRes.ok && aRes.status !== 204) throw new Error(`Twitter media append (${aRes.status})`)
  }

  // FINALIZE
  const finParams = new URLSearchParams({ command: 'FINALIZE', media_id: media_id_string })
  const finRes = await fetch('https://upload.twitter.com/1.1/media/upload.json', {
    method:  'POST',
    headers: { Authorization: `Bearer ${opts.accessToken}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    finParams.toString(),
  })
  if (!finRes.ok) throw new Error(`Twitter media finalize (${finRes.status})`)
  const finData = await finRes.json() as { processing_info?: { state: string } }

  // Poll processing
  if (finData.processing_info?.state === 'pending' || finData.processing_info?.state === 'in_progress') {
    await pollTwitterMedia(opts.accessToken, media_id_string)
  }

  // Create tweet
  const tweetRes = await fetch('https://api.twitter.com/2/tweets', {
    method:  'POST',
    headers: { Authorization: `Bearer ${opts.accessToken}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ text, media: { media_ids: [media_id_string] } }),
  })
  if (!tweetRes.ok) throw new Error(`Twitter tweet (${tweetRes.status}): ${await tweetRes.text()}`)
  const tw = await tweetRes.json() as { data: { id: string } }
  return { postId: tw.data.id, url: `https://x.com/i/web/status/${tw.data.id}` }
}

async function pollTwitterMedia(token: string, mediaId: string, timeout = 120_000): Promise<void> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 5000))
    const res  = await fetch(`https://upload.twitter.com/1.1/media/upload.json?command=STATUS&media_id=${mediaId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) break
    const d = await res.json() as { processing_info?: { state: string; error?: { message: string } } }
    const s = d.processing_info?.state
    if (s === 'succeeded') return
    if (s === 'failed') throw new Error(`Twitter media processing failed: ${d.processing_info?.error?.message}`)
  }
  throw new Error('Twitter media processing timeout')
}

// ── Facebook ──────────────────────────────────────────────────────────────────
// Facebook Graph API — direct video upload to Page
// accessToken = Page Access Token
// refreshToken = Page ID (optional, defaults to 'me')
export async function publishToFacebook(opts: PublishOptions): Promise<PublishResult> {
  const video   = await readVideo(opts.videoPath)
  const pageId  = opts.refreshToken?.trim() || 'me'
  const caption = cap(opts.caption, opts.hashtags, 63206)

  const fd = new FormData()
  fd.append('access_token', opts.accessToken)
  fd.append('description',  caption)
  fd.append('source',       new Blob([video], { type: 'video/mp4' }), 'video.mp4')

  const res = await fetch(`https://graph-video.facebook.com/v19.0/${pageId}/videos`, {
    method: 'POST',
    body:   fd,
  })
  if (!res.ok) throw new Error(`Facebook upload (${res.status}): ${await res.text()}`)
  const data = await res.json() as { id: string }
  return { postId: data.id, url: `https://www.facebook.com/video/${data.id}` }
}

// ── Snapchat ──────────────────────────────────────────────────────────────────
// Snap Business API — Spotlight upload
// accessToken = OAuth2 bearer token
export async function publishToSnapchat(opts: PublishOptions): Promise<PublishResult> {
  const video = await readVideo(opts.videoPath)
  const text  = cap(opts.caption, opts.hashtags, 160)

  const fd = new FormData()
  fd.append('file', new Blob([video], { type: 'video/mp4' }), 'snap.mp4')
  const upRes = await fetch('https://adsapi.snapchat.com/v1/media/upload', {
    method: 'POST', headers: { Authorization: `Bearer ${opts.accessToken}` }, body: fd,
  })
  if (!upRes.ok) throw new Error(`Snapchat upload (${upRes.status}): ${await upRes.text()}`)
  const upData = await upRes.json() as { media?: { id: string } }
  const mediaId = upData.media?.id
  if (!mediaId) throw new Error('Snapchat: pas d\'ID média dans la réponse')

  const pubRes = await fetch('https://adsapi.snapchat.com/v1/spotlight/create', {
    method:  'POST',
    headers: { Authorization: `Bearer ${opts.accessToken}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ media_id: mediaId, caption: text }),
  })
  if (!pubRes.ok) throw new Error(`Snapchat publish (${pubRes.status}): ${await pubRes.text()}`)
  const pub = await pubRes.json() as { id?: string }
  return { postId: pub.id ?? mediaId }
}

// ── LinkedIn ──────────────────────────────────────────────────────────────────
// LinkedIn Video API — register → upload → ugcPost
// accessToken = OAuth2 bearer token (scope: w_member_social)
export async function publishToLinkedIn(opts: PublishOptions): Promise<PublishResult> {
  const video = await readVideo(opts.videoPath)
  const text  = cap(opts.caption, opts.hashtags, 3000)

  const profileRes = await fetch('https://api.linkedin.com/v2/userinfo', {
    headers: { Authorization: `Bearer ${opts.accessToken}` },
  })
  if (!profileRes.ok) throw new Error(`LinkedIn profile (${profileRes.status}): ${await profileRes.text()}`)
  const profile  = await profileRes.json() as { sub: string }
  const ownerUrn = `urn:li:person:${profile.sub}`

  const regRes = await fetch('https://api.linkedin.com/v2/assets?action=registerUpload', {
    method:  'POST',
    headers: { Authorization: `Bearer ${opts.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      registerUploadRequest: {
        recipes: ['urn:li:digitalmediaRecipe:feedshare-video'],
        owner:   ownerUrn,
        serviceRelationships: [{ relationshipType: 'OWNER', identifier: 'urn:li:userGeneratedContent' }],
      },
    }),
  })
  if (!regRes.ok) throw new Error(`LinkedIn register (${regRes.status}): ${await regRes.text()}`)
  const regData = await regRes.json() as {
    value: {
      asset: string
      uploadMechanism: { 'com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest': { uploadUrl: string } }
    }
  }
  const assetUrn  = regData.value.asset
  const uploadUrl = regData.value.uploadMechanism['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'].uploadUrl

  const upRes = await fetch(uploadUrl, {
    method:  'PUT',
    headers: { Authorization: `Bearer ${opts.accessToken}`, 'Content-Type': 'application/octet-stream' },
    body:    video,
  })
  if (!upRes.ok && upRes.status !== 201) throw new Error(`LinkedIn upload (${upRes.status})`)

  const postRes = await fetch('https://api.linkedin.com/v2/ugcPosts', {
    method:  'POST',
    headers: {
      Authorization:               `Bearer ${opts.accessToken}`,
      'Content-Type':              'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body: JSON.stringify({
      author:         ownerUrn,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary:    { text },
          shareMediaCategory: 'VIDEO',
          media: [{
            status:      'READY',
            description: { text: text.slice(0, 200) },
            media:       assetUrn,
            title:       { text: opts.caption.slice(0, 100) || 'Vidéo' },
          }],
        },
      },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
    }),
  })
  if (!postRes.ok) throw new Error(`LinkedIn post (${postRes.status}): ${await postRes.text()}`)
  const post = await postRes.json() as { id: string }
  return { postId: post.id }
}

// ── Pinterest ─────────────────────────────────────────────────────────────────
// Pinterest API v5 — register media → S3 upload → create pin
// accessToken = OAuth2 bearer (scope: pins:write)
// refreshToken = board ID (required)
export async function publishToPinterest(opts: PublishOptions): Promise<PublishResult> {
  const video       = await readVideo(opts.videoPath)
  const description = cap(opts.caption, opts.hashtags, 500)

  const regRes = await fetch('https://api.pinterest.com/v5/media', {
    method:  'POST',
    headers: { Authorization: `Bearer ${opts.accessToken}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ media_type: 'video' }),
  })
  if (!regRes.ok) throw new Error(`Pinterest media register (${regRes.status}): ${await regRes.text()}`)
  const regData = await regRes.json() as {
    media_id:          string
    upload_url:        string
    upload_parameters: Record<string, string>
  }

  // Upload to S3 with signed form parameters
  const fd = new FormData()
  for (const [k, v] of Object.entries(regData.upload_parameters)) fd.append(k, v)
  fd.append('file', new Blob([video], { type: 'video/mp4' }), 'video.mp4')
  const upRes = await fetch(regData.upload_url, { method: 'POST', body: fd })
  if (!upRes.ok && upRes.status !== 204) throw new Error(`Pinterest upload (${upRes.status})`)

  // Resolve board ID (stored in refreshToken)
  let boardId = opts.refreshToken?.trim() ?? ''
  if (!boardId) {
    const bRes = await fetch('https://api.pinterest.com/v5/boards?page_size=1', {
      headers: { Authorization: `Bearer ${opts.accessToken}` },
    })
    if (bRes.ok) {
      const boards = await bRes.json() as { items: Array<{ id: string }> }
      boardId = boards.items[0]?.id ?? ''
    }
  }
  if (!boardId) throw new Error('Pinterest: Board ID requis. Renseignez l\'ID dans le champ Refresh Token.')

  const pinRes = await fetch('https://api.pinterest.com/v5/pins', {
    method:  'POST',
    headers: { Authorization: `Bearer ${opts.accessToken}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      board_id:     boardId,
      description,
      media_source: { source_type: 'video_id', media_id: regData.media_id },
    }),
  })
  if (!pinRes.ok) throw new Error(`Pinterest pin (${pinRes.status}): ${await pinRes.text()}`)
  const pin = await pinRes.json() as { id: string }
  return { postId: pin.id, url: `https://www.pinterest.com/pin/${pin.id}/` }
}

// ── Router ────────────────────────────────────────────────────────────────────
const PUBLISHERS: Record<string, (opts: PublishOptions) => Promise<PublishResult>> = {
  TIKTOK:    publishToTikTok,
  INSTAGRAM: publishToInstagram,
  YOUTUBE:   publishToYouTube,
  TWITTER:   publishToTwitter,
  FACEBOOK:  publishToFacebook,
  SNAPCHAT:  publishToSnapchat,
  LINKEDIN:  publishToLinkedIn,
  PINTEREST: publishToPinterest,
}

export async function publishVideo(platform: string, opts: PublishOptions): Promise<PublishResult> {
  const handler = PUBLISHERS[platform.toUpperCase()]
  if (!handler) throw new Error(`Plateforme inconnue: ${platform}`)
  return handler(opts)
}
