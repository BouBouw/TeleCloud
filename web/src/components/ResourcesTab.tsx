import { useState } from 'react'
import SoundCloudSearch from './SoundCloudSearch'
import SocialSearch from './SocialSearch'
import YouTubeSearch from './YouTubeSearch'
import type { Track } from '../lib/api'
import { useI18n } from '../i18n'

const S = {
  panel:    '#1a1a1a',
  border:   '#2a2a2a',
  accent:   '#f0a830',
  textMute: '#555',
  textFade: '#333',
}

type Platform = 'soundcloud' | 'youtube' | 'tiktok' | 'instagram' | 'snapchat' | 'x'

const PLATFORMS: { id: Platform; label: string; icon: string; available: boolean }[] = [
  { id: 'soundcloud', label: 'SoundCloud', icon: '/platform-icons/soundcloud.png', available: true  },
  { id: 'tiktok',     label: 'TikTok',     icon: '/platform-icons/tiktok.png',     available: true  },
  { id: 'instagram',  label: 'Instagram',  icon: '/platform-icons/instagram.png',  available: true  },
  { id: 'x',          label: 'X',          icon: '/platform-icons/x.png',          available: true  },
  { id: 'snapchat',   label: 'Snapchat',   icon: '/platform-icons/snapchat.png',   available: true  },
  { id: 'youtube',    label: 'YouTube',    icon: '/platform-icons/youtube.png',    available: true  },
]

interface Props {
  workspaceId: string
  onScrapeSuccess?: () => void
  libraryTracks?: Track[]
}

export default function ResourcesTab({ workspaceId, onScrapeSuccess, libraryTracks }: Props) {
  const { t } = useI18n()
  const [platform, setPlatform] = useState<Platform>('soundcloud')

  return (
    <div className="flex flex-col gap-4">
      {/* Platform selector */}
      <div className="grid grid-cols-6 gap-2">
        {PLATFORMS.map(p => (
          <button
            key={p.id}
            disabled={!p.available}
            onClick={() => p.available && setPlatform(p.id)}
            className="relative flex flex-col items-center gap-2 px-2 py-3 rounded-md transition-all disabled:opacity-35 disabled:cursor-not-allowed"
            style={{
              background: platform === p.id ? `${S.accent}12` : S.panel,
              border: `1px solid ${platform === p.id ? S.accent + '55' : S.border}`,
            }}
          >
            {platform === p.id && (
              <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full" style={{ background: S.accent }} />
            )}
            <img src={p.icon} alt={p.label} className="w-7 h-7 rounded-md object-contain" />
            <span className="hidden sm:block text-[11px] font-medium" style={{ color: platform === p.id ? S.accent : S.textMute }}>
              {p.label}
            </span>
            {!p.available && (
              <span className="hidden sm:block text-[9px]" style={{ color: S.textFade }}>{t('platform_coming_soon')}</span>
            )}
          </button>
        ))}
      </div>

      {/* Platform content */}
      {platform === 'soundcloud' && (
        <SoundCloudSearch workspaceId={workspaceId} onScrapeSuccess={onScrapeSuccess} libraryTracks={libraryTracks} />
      )}
      {platform === 'youtube' && (
        <YouTubeSearch workspaceId={workspaceId} onScrapeSuccess={onScrapeSuccess} libraryTracks={libraryTracks} />
      )}
      {(platform === 'tiktok' || platform === 'instagram' || platform === 'x' || platform === 'snapchat') && (
        <SocialSearch
          workspaceId={workspaceId}
          platform={platform}
          onScrapeSuccess={(_format) => onScrapeSuccess?.()}
          libraryTracks={libraryTracks}
        />
      )}
    </div>
  )
}
