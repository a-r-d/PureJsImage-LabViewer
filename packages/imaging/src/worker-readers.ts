import type { ReaderDescriptor } from '@pji-workbench/contracts'
import type { ScientificReader } from 'purejsimage/scientific'

type ReaderKey = 'aperio-svs' | 'cbf' | 'envi' | 'fits' | 'gsf' | 'mrc' | 'ome-tiff'

export const SUPPORTED_READERS = Object.freeze([
  { id: 'purejsimage/gsf', version: '1.0.0', format: 'GSF', extensions: ['gsf'], mediaTypes: [] },
  {
    id: 'purejsimage/envi',
    version: '1.0.0',
    format: 'ENVI',
    extensions: ['hdr', 'envi'],
    mediaTypes: [],
  },
  {
    id: 'purejsimage/fits',
    version: '1.0.0',
    format: 'FITS',
    extensions: ['fits', 'fit', 'fts'],
    mediaTypes: ['application/fits', 'image/fits'],
  },
  {
    id: 'purejsimage/mrc',
    version: '1.0.0',
    format: 'MRC / CCP4',
    extensions: ['mrc', 'map', 'ccp4'],
    mediaTypes: [],
  },
  {
    id: 'purejsimage/cbf',
    version: '1.0.0',
    format: 'CBF / imgCIF',
    extensions: ['cbf', 'imgcif'],
    mediaTypes: ['application/x-cbf'],
  },
  {
    id: 'purejsimage/ome-tiff',
    version: '1.0.0',
    format: 'OME-TIFF',
    extensions: ['ome.tif', 'ome.tiff', 'tif', 'tiff'],
    mediaTypes: ['image/tiff'],
  },
  {
    id: 'purejsimage/aperio-svs',
    version: '1.0.0',
    format: 'Aperio SVS',
    extensions: ['svs'],
    mediaTypes: ['image/tiff'],
  },
] satisfies readonly ReaderDescriptor[])

const loaders: Readonly<Record<ReaderKey, () => Promise<ScientificReader>>> = {
  gsf: async () => (await import('purejsimage/scientific/readers/gsf')).gsfReader,
  envi: async () => (await import('purejsimage/scientific/readers/envi')).enviReader,
  fits: async () => (await import('purejsimage/scientific/readers/fits')).fitsReader,
  mrc: async () => (await import('purejsimage/scientific/readers/mrc')).mrcReader,
  cbf: async () => (await import('purejsimage/scientific/readers/cbf')).cbfReader,
  'ome-tiff': async () => (await import('purejsimage/scientific/readers/ome-tiff')).omeTiffReader,
  'aperio-svs': async () =>
    (await import('purejsimage/scientific/readers/aperio-svs')).aperioSvsReader,
}

function extensionCandidates(name: string): readonly ReaderKey[] {
  const lower = name.toLowerCase()
  if (lower.endsWith('.ome.tiff') || lower.endsWith('.ome.tif')) return ['ome-tiff']
  const extension = lower.slice(lower.lastIndexOf('.') + 1)
  if (extension === 'gsf') return ['gsf']
  if (extension === 'hdr' || extension === 'envi') return ['envi']
  if (['fits', 'fit', 'fts'].includes(extension)) return ['fits']
  if (['mrc', 'map', 'ccp4'].includes(extension)) return ['mrc']
  if (['cbf', 'imgcif'].includes(extension)) return ['cbf']
  if (extension === 'svs') return ['aperio-svs']
  if (extension === 'tif' || extension === 'tiff') return ['ome-tiff', 'aperio-svs']
  return ['gsf', 'envi', 'fits', 'mrc', 'cbf', 'ome-tiff', 'aperio-svs']
}

export async function loadReadersForSource(name: string): Promise<readonly ScientificReader[]> {
  return Promise.all(extensionCandidates(name).map((key) => loaders[key]()))
}
