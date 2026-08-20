import type { Page } from '@playwright/test'

export async function dismissDemoPicker(page: Page): Promise<void> {
  const skip = page.getByRole('button', { name: 'Skip for now' })
  if (await skip.isVisible()) await skip.click()
}
