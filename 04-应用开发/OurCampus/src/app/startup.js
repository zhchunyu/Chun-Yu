import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core'

const readyParts = new Set()
let checkReady = () => {}

export function markStartupReady(part) {
  readyParts.add(part)
  checkReady()
}

export function startStartup({ previewShell = false } = {}) {
  const overlay = document.getElementById('app-startup')
  if (!overlay) return
  if (previewShell) {
    // The actual app in the phone iframe owns its own startup animation.
    overlay.remove()
    return
  }

  const root = document.getElementById('root')
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const startedAt = performance.getEntriesByName('ourcampus-startup')[0]?.startTime ?? performance.now()
  const elapsed = performance.now() - startedAt
  const minimum = reduceMotion ? 450 : 2600
  let closing = false
  let minimumReached = elapsed >= minimum
  const wordmark = overlay.querySelector('.app-startup__wordmark')
  const reveal = () => {
    overlay.dataset.revealed = 'true'
    checkReady()
  }
  // Finish the lettering itself before starting the transition to the map.
  wordmark?.addEventListener('animationend', reveal, { once: true })
  if (reduceMotion || (wordmark?.getAnimations?.() ?? []).every((animation) => animation.playState === 'finished')) {
    overlay.dataset.revealed = 'true'
  }
  root.inert = true
  root.setAttribute('aria-hidden', 'true')

  const finish = () => {
    if (closing) return
    closing = true
    clearTimeout(minimumTimer)
    clearTimeout(maximumTimer)
    clearTimeout(waitingTimer)
    checkReady = () => {}
    // React has already mounted underneath; no second app or map initialization.
    root.inert = false
    root.removeAttribute('aria-hidden')
    if (Capacitor.getPlatform() === 'android') {
      // Core SystemBars also repaints the native safe-area surface using the
      // normal window background, rather than leaving the startup black there.
      void SystemBars.setStyle({ style: SystemBarsStyle.Light })
        .catch((error) => console.warn('Unable to restore Android system bars', error))
    }
    overlay.classList.add('is-leaving')
    const remove = () => overlay.remove()
    overlay.addEventListener('transitionend', (event) => {
      if (event.target === overlay && event.propertyName === 'opacity') remove()
    })
    window.setTimeout(remove, reduceMotion ? 220 : 900)
  }

  checkReady = () => {
    if (minimumReached && overlay.dataset.revealed === 'true'
      && ['interface', 'map', 'account'].every((part) => readyParts.has(part))) finish()
  }
  const minimumTimer = window.setTimeout(() => {
    minimumReached = true
    checkReady()
  }, Math.max(0, minimum - elapsed))
  // Do not hold navigation hostage to a failed SDK request or offline Auth.
  const maximumTimer = window.setTimeout(finish, Math.max(0, 6000 - elapsed))
  const waitingTimer = window.setTimeout(() => overlay.classList.add('is-waiting'), Math.max(0, 3200 - elapsed))
  checkReady()
}
