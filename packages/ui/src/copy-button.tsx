import { Check, Copy } from 'lucide-react'
import { useState } from 'react'

export function CopyButton({
  label = 'Copy',
  text,
}: {
  readonly label?: string
  readonly text: string
}) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      aria-label={copied ? 'Copied' : label}
      className="ui-icon-button ui-copy-button"
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        if (text.length === 0 || typeof navigator.clipboard?.writeText !== 'function') return
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1_200)
        })
      }}
      title={copied ? 'Copied' : label}
      type="button"
    >
      {copied ? (
        <Check aria-hidden="true" className="ui-icon" size={14} strokeWidth={1.7} />
      ) : (
        <Copy aria-hidden="true" className="ui-icon" size={14} strokeWidth={1.7} />
      )}
    </button>
  )
}
