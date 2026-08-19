import { ThemeRoot } from '@pji-workbench/ui'

import type { PublicEnvironment } from './environment.js'
import { LIBRARY_SITE_URL, SHOWCASE_CARDS } from './showcase.js'

export function App({ environment }: { readonly environment: PublicEnvironment }) {
  return (
    <ThemeRoot className="gallery-theme" theme="dark">
      <div
        className="gallery"
        data-environment={environment.appEnvironment}
        data-gallery-ready="true"
      >
        <header className="gallery-header">
          <p className="gallery-kicker">PureJsImage showcase</p>
          <h1>Choose a domain application</h1>
          <p>
            Each card opens a separately built and deployed app. This gallery does not load imaging
            Workers or domain catalogs.
          </p>
        </header>
        <ul className="gallery-grid">
          {SHOWCASE_CARDS.map((card) => (
            <li key={card.id}>
              {card.status === 'planned' || card.href === undefined ? (
                <article aria-disabled="true" className="gallery-card gallery-card--planned">
                  <p className="gallery-kicker">Planned</p>
                  <h2>{card.title}</h2>
                  <p>{card.summary}</p>
                  <span>{card.hostLabel}</span>
                </article>
              ) : (
                <a className="gallery-card" href={card.href}>
                  <p className="gallery-kicker">Live</p>
                  <h2>{card.title}</h2>
                  <p>{card.summary}</p>
                  <span>{card.hostLabel}</span>
                </a>
              )}
            </li>
          ))}
        </ul>
        <footer className="gallery-footer">
          <p>
            The PureJsImage library site is <a href={LIBRARY_SITE_URL}>purejsimage.com</a>. That
            apex site is published from the core-library repository via GitHub Pages, not this
            showcase monorepo.
          </p>
        </footer>
      </div>
    </ThemeRoot>
  )
}
