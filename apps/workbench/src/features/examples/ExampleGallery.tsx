import { Button, EmptyState, Icon } from '@pji-workbench/ui'

export function ExampleGallery({ onClose }: { readonly onClose: () => void }) {
  return (
    <div className="url-dialog-backdrop">
      <section aria-label="Example library" className="url-dialog example-gallery" role="dialog">
        <header className="example-gallery__heading">
          <Icon name="examples" size={18} />
          <div>
            <p>Local-first examples</p>
            <h2>Example library</h2>
          </div>
        </header>
        <EmptyState
          title="No example corpus is enabled yet"
          description="Future examples require a licensed manifest, immutable URL, integrity hash, attribution, and bounded scenario before they can appear here. No external assets were downloaded."
        />
        <div className="url-dialog__actions">
          <Button onClick={onClose} variant="primary">
            Close
          </Button>
        </div>
      </section>
    </div>
  )
}
