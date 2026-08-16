import type { ReaderDescriptor } from '@pji-workbench/contracts'
import type { ScientificReader } from 'purejsimage/scientific'

type ReaderKey =
  | 'png'
  | 'jpeg'
  | 'webp'
  | 'bmp'
  | 'jp2'
  | 'tiff'
  | 'ome-tiff'
  | 'aperio-svs'
  | 'digital-micrograph'
  | 'tia-ser'
  | 'tia-emi'
  | 'ncem-emd'
  | 'velox-emd'
  | 'blockfile'
  | 'mib'
  | 'gsf'
  | 'nanonis-sxm'
  | 'igor-binary-wave'
  | 'digital-surf'
  | 'x3p'
  | 'mrc'
  | 'nrrd'
  | 'meta-image'
  | 'nifti'
  | 'envi'
  | 'fits'
  | 'cbf'
  | 'rpl'
  | 'emsa'
  | 'ebsd-text'
  | 'npy'

const reader = (
  id: string,
  format: string,
  extensions: readonly string[],
  mediaTypes: readonly string[],
): ReaderDescriptor =>
  Object.freeze({
    id,
    version: '1.0.0',
    format,
    extensions,
    mediaTypes,
  })

/**
 * Portable initialize-time catalog. Values match the live 0.11.0 reader
 * descriptors so the Worker does not import every codec at startup.
 */
export const SUPPORTED_READERS = Object.freeze([
  reader('purejsimage/png', 'PNG', ['png'], ['image/png']),
  reader('purejsimage/jpeg', 'JPEG', ['jpg', 'jpeg', 'jpe'], ['image/jpeg']),
  reader('purejsimage/webp', 'WebP', ['webp'], ['image/webp']),
  reader('purejsimage/bmp', 'BMP', ['bmp', 'dib'], ['image/bmp', 'image/x-ms-bmp']),
  reader('purejsimage/jp2', 'JPEG 2000 / JP2', ['jp2'], ['image/jp2']),
  reader('purejsimage/tiff', 'TIFF', ['tif', 'tiff'], ['image/tiff', 'image/x-tiff']),
  reader('purejsimage/ome-tiff', 'OME-TIFF', ['tif', 'tiff'], ['image/tiff', 'image/x-tiff']),
  reader('purejsimage/aperio-svs', 'Aperio SVS', ['svs'], ['image/tiff', 'image/x-tiff']),
  reader(
    'purejsimage/digital-micrograph',
    'Gatan DigitalMicrograph',
    ['dm3', 'dm4'],
    ['application/x-gatan-dm3', 'application/x-gatan-dm4', 'application/x-digital-micrograph'],
  ),
  reader(
    'purejsimage/tia-ser',
    'FEI/Thermo TIA SER',
    ['ser'],
    ['application/x-fei-ser', 'application/x-thermo-tia-ser', 'application/x-tia-ser'],
  ),
  reader(
    'purejsimage/tia-emi',
    'FEI/Thermo TIA EMI',
    ['emi'],
    ['application/x-fei-emi', 'application/x-thermo-tia-emi', 'application/x-tia-emi'],
  ),
  reader('purejsimage/ncem-emd', 'NCEM EMD 0.2', ['emd'], ['application/x-hdf5']),
  reader('purejsimage/velox-emd', 'FEI/Thermo Velox EMD', ['emd'], ['application/x-hdf5']),
  reader(
    'purejsimage/blockfile',
    'NanoMegas ASTAR blockfile',
    ['blo'],
    ['application/x-nanomegas-blo'],
  ),
  reader('purejsimage/mib', 'Quantum Detectors Merlin MIB', ['mib'], ['application/x-merlin-mib']),
  reader('purejsimage/gsf', 'Gwyddion Simple Field', ['gsf'], ['application/x-gwyddion-spm']),
  reader('purejsimage/nanonis-sxm', 'Nanonis SXM', ['sxm'], ['application/x-nanonis-sxm']),
  reader(
    'purejsimage/igor-binary-wave',
    'Igor Binary Wave v5',
    ['ibw'],
    ['application/x-igor-binary-wave'],
  ),
  reader(
    'purejsimage/digital-surf',
    'Digital Surf SUR/PRO',
    ['sur', 'pro'],
    ['application/x-digitalsurf-sur'],
  ),
  reader('purejsimage/x3p', 'X3P surface exchange', ['x3p'], ['application/x-x3p']),
  reader(
    'purejsimage/mrc',
    'MRC/CCP4',
    ['mrc', 'map', 'ccp4'],
    ['application/x-mrc', 'application/x-ccp4'],
  ),
  reader('purejsimage/nrrd', 'NRRD', ['nrrd', 'nhdr'], ['application/x-nrrd']),
  reader(
    'purejsimage/meta-image',
    'MetaImage MHD/MHA',
    ['mhd', 'mha'],
    ['application/x-metaimage'],
  ),
  reader('purejsimage/nifti', 'NIfTI-1/2', ['nii', 'gz'], ['application/x-nifti']),
  reader('purejsimage/envi', 'ENVI', ['hdr', 'img', 'dat', 'raw'], ['application/x-envi']),
  reader('purejsimage/fits', 'FITS', ['fits', 'fit', 'fts'], ['application/fits', 'image/fits']),
  reader('purejsimage/cbf', 'CBF/imgCIF', ['cbf'], ['application/x-cbf']),
  reader(
    'purejsimage/rpl',
    'Lispix RPL/RAW',
    ['rpl', 'raw'],
    ['application/x-rpl', 'application/x-lispix-raw'],
  ),
  reader('purejsimage/emsa', 'EMSA/MAS spectrum', ['msa', 'emsa'], ['application/x-emsa-mas']),
  reader(
    'purejsimage/ebsd-text',
    'ANG/CTF orientation map',
    ['ang', 'ctf'],
    ['application/x-ebsd-ang', 'application/x-ebsd-ctf'],
  ),
  reader('purejsimage/npy', 'NumPy NPY', ['npy'], ['application/x-npy']),
]) satisfies readonly ReaderDescriptor[]

const ID_TO_KEY = Object.freeze(
  Object.fromEntries(
    SUPPORTED_READERS.map((descriptor) => [
      descriptor.id,
      descriptor.id.slice('purejsimage/'.length) as ReaderKey,
    ]),
  ),
) as Readonly<Record<string, ReaderKey>>

const READER_KEYS = Object.freeze(
  SUPPORTED_READERS.map((descriptor) => {
    const key = ID_TO_KEY[descriptor.id]
    if (key === undefined) throw new Error(`Missing reader key for ${descriptor.id}`)
    return key
  }),
)

const loaders: Readonly<Record<ReaderKey, () => Promise<ScientificReader>>> = {
  png: async () => (await import('purejsimage/scientific/readers/png')).pngReader,
  jpeg: async () => (await import('purejsimage/scientific/readers/jpeg')).jpegReader,
  webp: async () => (await import('purejsimage/scientific/readers/webp')).webpReader,
  bmp: async () => (await import('purejsimage/scientific/readers/bmp')).bmpReader,
  jp2: async () => (await import('purejsimage/scientific/readers/jp2')).jp2Reader,
  tiff: async () => (await import('purejsimage/scientific/readers/tiff')).tiffReader,
  'ome-tiff': async () => (await import('purejsimage/scientific/readers/ome-tiff')).omeTiffReader,
  'aperio-svs': async () =>
    (await import('purejsimage/scientific/readers/aperio-svs')).aperioSvsReader,
  'digital-micrograph': async () =>
    (await import('purejsimage/scientific/readers/digital-micrograph')).digitalMicrographReader,
  'tia-ser': async () => (await import('purejsimage/scientific/readers/tia-ser')).tiaSerReader,
  'tia-emi': async () => (await import('purejsimage/scientific/readers/tia-emi')).tiaEmiReader,
  'ncem-emd': async () => (await import('purejsimage/scientific/readers/ncem-emd')).ncemEmdReader,
  'velox-emd': async () =>
    (await import('purejsimage/scientific/readers/velox-emd')).veloxEmdReader,
  blockfile: async () => (await import('purejsimage/scientific/readers/blockfile')).blockfileReader,
  mib: async () => (await import('purejsimage/scientific/readers/mib')).mibReader,
  gsf: async () => (await import('purejsimage/scientific/readers/gsf')).gsfReader,
  'nanonis-sxm': async () =>
    (await import('purejsimage/scientific/readers/nanonis-sxm')).nanonisSxmReader,
  'igor-binary-wave': async () =>
    (await import('purejsimage/scientific/readers/igor-binary-wave')).igorBinaryWaveReader,
  'digital-surf': async () =>
    (await import('purejsimage/scientific/readers/digital-surf')).digitalSurfReader,
  x3p: async () => (await import('purejsimage/scientific/readers/x3p')).x3pReader,
  mrc: async () => (await import('purejsimage/scientific/readers/mrc')).mrcReader,
  nrrd: async () => (await import('purejsimage/scientific/readers/nrrd')).nrrdReader,
  'meta-image': async () =>
    (await import('purejsimage/scientific/readers/meta-image')).metaImageReader,
  nifti: async () => (await import('purejsimage/scientific/readers/nifti')).niftiReader,
  envi: async () => (await import('purejsimage/scientific/readers/envi')).enviReader,
  fits: async () => (await import('purejsimage/scientific/readers/fits')).fitsReader,
  cbf: async () => (await import('purejsimage/scientific/readers/cbf')).cbfReader,
  rpl: async () => (await import('purejsimage/scientific/readers/rpl')).rplReader,
  emsa: async () => (await import('purejsimage/scientific/readers/emsa')).emsaReader,
  'ebsd-text': async () =>
    (await import('purejsimage/scientific/readers/ebsd-text')).ebsdTextReader,
  npy: async () => (await import('purejsimage/scientific/readers/npy')).npyReader,
}

const EXTENSION_PRIORITY = Object.freeze({
  'ome.tiff': Object.freeze(['ome-tiff'] as const),
  'ome.tif': Object.freeze(['ome-tiff'] as const),
  'nii.gz': Object.freeze(['nifti'] as const),
  tif: Object.freeze(['ome-tiff', 'aperio-svs', 'tiff'] as const),
  tiff: Object.freeze(['ome-tiff', 'aperio-svs', 'tiff'] as const),
  emd: Object.freeze(['ncem-emd', 'velox-emd'] as const),
  raw: Object.freeze(['rpl', 'envi'] as const),
  hdr: Object.freeze(['envi'] as const),
  envi: Object.freeze(['envi'] as const),
  img: Object.freeze(['envi'] as const),
  dat: Object.freeze(['envi'] as const),
  gz: Object.freeze(['nifti'] as const),
  imgcif: Object.freeze(['cbf'] as const),
})

const EXTRA_ACCEPT_EXTENSIONS = Object.freeze(['envi', 'imgcif', 'ome.tif', 'ome.tiff', 'nii.gz'])

export const SUPPORTED_FILE_ACCEPT = Object.freeze(
  [
    ...new Set([
      ...SUPPORTED_READERS.flatMap(({ extensions }) => extensions).filter(
        (extension) => extension !== 'gz',
      ),
      ...EXTRA_ACCEPT_EXTENSIONS,
    ]),
  ]
    .sort()
    .map((extension) => `.${extension}`)
    .join(','),
)

function keysForExtension(extension: string): readonly ReaderKey[] {
  return READER_KEYS.filter((key) => {
    const descriptor = SUPPORTED_READERS.find((entry) => ID_TO_KEY[entry.id] === key)
    return descriptor?.extensions.includes(extension) === true
  })
}

export function readerKeysForSource(name: string): readonly ReaderKey[] {
  const lower = name.toLowerCase()
  for (const compound of ['ome.tiff', 'ome.tif', 'nii.gz'] as const) {
    if (lower.endsWith(`.${compound}`)) return EXTENSION_PRIORITY[compound]
  }
  const separator = lower.lastIndexOf('.')
  const extension = separator === -1 ? '' : lower.slice(separator + 1)
  if (extension in EXTENSION_PRIORITY) {
    return EXTENSION_PRIORITY[extension as keyof typeof EXTENSION_PRIORITY]
  }
  const matches = keysForExtension(extension)
  return matches.length > 0 ? matches : READER_KEYS
}

export async function loadReadersForSource(name: string): Promise<readonly ScientificReader[]> {
  return Promise.all(readerKeysForSource(name).map((key) => loaders[key]()))
}
