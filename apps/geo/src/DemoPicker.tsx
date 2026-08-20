import type { AtlasStartDemo } from '@pji-workbench/domain-geo'
import { Button } from '@pji-workbench/ui'
import { useEffect, useRef } from 'react'

export function DemoPicker({
  demos,
  disabled,
  onClose,
  onOpen,
}: {
  readonly demos: readonly AtlasStartDemo[]
  readonly disabled: boolean
  readonly onClose: () => void
  readonly onOpen: (demoId: string) => void
}) {
  const firstRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    firstRef.current?.focus()
  }, [])

  return (
    <div
      aria-labelledby="geo-demo-title"
      aria-modal="true"
      className="geo-demo-picker"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
      }}
      role="dialog"
    >
      <div className="geo-demo-picker__surface">
        <header className="geo-demo-picker__header">
          <h2 id="geo-demo-title">Choose a demo</h2>
          <p>
            One click opens a known-good Cloud Optimized GeoTIFF with display mapping, stretch, and
            catalog provenance already set. Atlas stays in the source CRS and fetches only HTTP
            ranges.
          </p>
        </header>
        <ul className="geo-demo-picker__list">
          {demos.map((demo, index) => (
            <li key={demo.id}>
              <button
                disabled={disabled}
                onClick={() => onOpen(demo.id)}
                ref={index === 0 ? firstRef : undefined}
                type="button"
              >
                <strong>{demo.title}</strong>
                <span>{demo.catalogTitle}</span>
                <span>{demo.summary}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="geo-demo-picker__actions">
          <Button onClick={onClose}>Skip for now</Button>
        </div>
      </div>
    </div>
  )
}
