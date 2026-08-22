import type { DensePlane } from '../src/kernels.js'

export interface ParticleBenchmarkFixture {
  readonly id: string
  readonly width: number
  readonly height: number
  readonly image: DensePlane
  readonly truth: Uint32Array
  readonly objectCount: number
  readonly polarity: 'light' | 'dark'
}

interface FixtureOptions {
  readonly seed: number
  readonly polarity: 'light' | 'dark'
  readonly columns: number
  readonly rows: number
  readonly gradient: number
  readonly noise: number
  readonly dimEvery?: number
}

/**
 * Generates deterministic SEM-like high-density planes with an exact instance mask.
 * The image generator and grader intentionally use different representations: grayscale
 * intensities are the input under test, while labels are retained only as the oracle.
 */
export function generatedParticleBenchmarkFixture(
  id: string,
  options: FixtureOptions,
): ParticleBenchmarkFixture {
  const cell = 15
  const margin = 10
  const width = options.columns * cell + margin * 2
  const height = options.rows * cell + margin * 2
  const truth = new Uint32Array(width * height)
  const intensities = new Float64Array(width * height)
  const random = seededRandom(options.seed)
  const background = options.polarity === 'light' ? 48 : 208
  const foreground = options.polarity === 'light' ? 205 : 46

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const gradient = options.gradient * (x / Math.max(1, width - 1) - 0.5)
      intensities[y * width + x] = background + gradient + (random() - 0.5) * options.noise
    }
  }

  let label = 0
  for (let row = 0; row < options.rows; row += 1) {
    for (let column = 0; column < options.columns; column += 1) {
      label += 1
      const cx = margin + column * cell + 7 + Math.round((random() - 0.5) * 2)
      const cy = margin + row * cell + 7 + Math.round((random() - 0.5) * 2)
      const radius = 3 + Math.floor(random() * 3)
      const dim = options.dimEvery !== undefined && label % options.dimEvery === 0
      const target = dim ? background + (options.polarity === 'light' ? 24 : -24) : foreground
      const radiusSquared = radius * radius
      for (let y = cy - radius; y <= cy + radius; y += 1) {
        for (let x = cx - radius; x <= cx + radius; x += 1) {
          if ((x - cx) ** 2 + (y - cy) ** 2 > radiusSquared) continue
          const index = y * width + x
          truth[index] = label
          const radial = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) / Math.max(1, radius)
          const texture = (random() - 0.5) * options.noise * 0.45
          intensities[index] =
            target + (options.polarity === 'light' ? -1 : 1) * radial * 9 + texture
        }
      }
    }
  }

  return {
    id,
    width,
    height,
    image: { width, height, components: 1, values: intensities },
    truth,
    objectCount: label,
    polarity: options.polarity,
  }
}

export function labelBinaryMask(
  mask: Uint8Array,
  width: number,
  height: number,
  connectivity: 4 | 8 = 8,
): Uint32Array {
  const labels = new Uint32Array(mask.length)
  const queue = new Uint32Array(mask.length)
  const offsets =
    connectivity === 4
      ? ([
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const)
      : ([
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
          [1, 1],
          [-1, -1],
          [1, -1],
          [-1, 1],
        ] as const)
  let label = 0
  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] === 0 || labels[start] !== 0) continue
    label += 1
    let head = 0
    let tail = 1
    queue[0] = start
    labels[start] = label
    while (head < tail) {
      const index = queue[head] ?? 0
      head += 1
      const x = index % width
      const y = Math.floor(index / width)
      for (const [dx, dy] of offsets) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const next = ny * width + nx
        if (mask[next] === 0 || labels[next] !== 0) continue
        labels[next] = label
        queue[tail] = next
        tail += 1
      }
    }
  }
  return labels
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    return state / 0x1_0000_0000
  }
}
