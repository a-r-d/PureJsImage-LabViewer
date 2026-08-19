import type { Camera } from './types.js'

/**
 * Framework-neutral camera holder. Keep this object outside React panel state
 * and subscribe panels to derived, low-frequency snapshots instead.
 */
export class ViewportCameraSession {
  #camera: Camera

  constructor(camera: Camera) {
    this.#camera = camera
  }

  get camera(): Camera {
    return this.#camera
  }

  replace(camera: Camera): Camera {
    this.#camera = camera
    return camera
  }
}
