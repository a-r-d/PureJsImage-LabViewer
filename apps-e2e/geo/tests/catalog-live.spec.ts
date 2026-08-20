import { expect, test } from '@playwright/test'

// biome-ignore lint/suspicious/noUndeclaredEnvVars: opt-in live e2e; not a Turbo task
const live = process.env['PJI_GEO_LIVE'] === '1'

test.describe('live government catalog probes', () => {
  test.skip(!live, 'Set PJI_GEO_LIVE=1 to probe CORS/Range in the browser.')

  test('probes NOAA Puerto Rico CUDEM Range and CORS from the browser', async ({ page }) => {
    test.setTimeout(60_000)
    await page.goto('/')
    const result = await page.evaluate(async () => {
      const href =
        'https://noaa-nos-coastal-lidar-pds.s3.amazonaws.com/dem/NCEI_third_Topobathy_PuertoRico_9524/ncei13_n17x75_w065x75_2022v1.tif'
      try {
        const response = await fetch(href, { method: 'GET', headers: { Range: 'bytes=0-3' } })
        if (response.status !== 206) {
          await response.body?.cancel()
          return { ok: false, message: `Range request returned HTTP ${String(response.status)}` }
        }
        const bytes = new Uint8Array(await response.arrayBuffer())
        return {
          ok: true,
          status: response.status,
          allowOrigin: response.headers.get('access-control-allow-origin'),
          expose: response.headers.get('access-control-expose-headers'),
          contentRange: response.headers.get('content-range'),
          encoding: response.headers.get('content-encoding'),
          tiffMagic:
            bytes.length === 4 &&
            ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0) ||
              (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0 && bytes[3] === 0x2a)),
        }
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) }
      }
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.status).toBe(206)
      expect(result.tiffMagic).toBe(true)
    }
  })
})
