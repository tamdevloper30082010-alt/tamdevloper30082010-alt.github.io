import type { EvidenceKind } from '../lib/proof'

/**
 * Hiển thị tệp thành quả: video thì có controls, ảnh thì bấm để phóng to.
 *
 * Video cần `preload="metadata"` chứ không phải `preload="auto"` — admin mở
 * hàng đợi duyệt là xem hàng chục tệp, tải hết thì nghẽn mạng vô ích.
 * `playsInline` để iOS không bật fullscreen ngay khi bấm play.
 */
export function EvidencePlayer({
  url,
  kind,
  alt,
  className = 'max-h-80',
}: {
  url: string
  kind: EvidenceKind
  alt: string
  className?: string
}) {
  if (kind === 'video') {
    return (
      <video
        src={url}
        controls
        preload="metadata"
        playsInline
        className={`w-full rounded-xl border border-accent/25 bg-black/30 object-contain ${className}`}
      />
    )
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="block overflow-hidden rounded-xl border border-accent/25"
    >
      <img
        src={url}
        alt={alt}
        loading="lazy"
        className={`w-full cursor-zoom-in bg-black/30 object-contain ${className}`}
      />
    </a>
  )
}
