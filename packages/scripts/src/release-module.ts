import RELEASE_SYNC from '@jitl/quickjs-wasmfile-release-sync'
import { newQuickJSWASMModuleFromVariant } from 'quickjs-emscripten-core'

export async function loadReleaseQuickJs() {
  return newQuickJSWASMModuleFromVariant(RELEASE_SYNC)
}
