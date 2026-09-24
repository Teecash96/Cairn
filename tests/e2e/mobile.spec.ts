import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

test('landing page explains the complete route without mobile overflow', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Turn a rough idea into work your team can prove, reward, and ship.' })).toBeVisible()
  await expect(page.getByText('Plan once')).toBeVisible()
  await expect(page.getByText('Work daily')).toBeVisible()
  await expect(page.getByText('Finish together')).toBeVisible()
  await expect(page.getByText('No sign-ups. Your Nimiq wallet address is your identity and username in Cairn.')).toBeVisible()

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})

test('sample opens on Today and exposes the complete product route', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Explore a sample plan · no wallet needed' }).click()

  await expect(page.getByRole('heading', { name: 'Keep the route moving' })).toBeVisible()
  for (const tab of ['Today', 'Plan', 'Flow', 'Build', 'Track']) {
    await expect(page.getByRole('tab', { name: new RegExp(tab) })).toBeVisible()
  }

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})

test('team invites put wallet access first on mobile', async ({ page }) => {
  await page.goto('/?t=team-invite-example')

  await expect(page.getByRole('heading', { name: 'Open the shared work' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Connect Nimiq wallet' })).toBeVisible()
  await expect(page.getByText('No Cairn account or new plan is required.')).toBeVisible()
  await expect(page.getByLabel('The rough idea')).toHaveCount(0)

  const connectTop = await page.getByRole('button', { name: 'Connect Nimiq wallet' }).evaluate((element) => element.getBoundingClientRect().top)
  expect(connectTop).toBeLessThan(page.viewportSize()?.height ?? 700)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})

test('Routes opens a wallet action inbox without mobile overflow', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Routes' }).click()

  await expect(page.getByRole('heading', { name: 'What needs you now' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Connect wallet' })).toBeVisible()
  await expect(page.getByText("Cairn combines this device's personal work")).toBeVisible()

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})

test('landing page has no automatically detectable WCAG A or AA violations', async ({ page }) => {
  await page.goto('/')
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(results.violations).toEqual([])
})

test('structured data describes a free product rather than a NIM price', async ({ page }) => {
  await page.goto('/')
  const schema = await page.locator('script[type="application/ld+json"]').textContent()
  expect(schema).toBeTruthy()
  const product = JSON.parse(schema ?? '{}') as { isAccessibleForFree?: boolean; offers?: unknown }
  expect(product.isAccessibleForFree).toBe(true)
  expect(product.offers).toBeUndefined()
})

test('public usage evidence is readable on mobile without exposing user rows', async ({ page }) => {
  await page.route('**/api/usage', async (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      updatedAt: Date.now(), verifiedWallets: 18, activatedWallets: 12, repeatWallets: 7,
      activeToday: 3, active7Days: 9, plansGenerated: 14, planRefinements: 6,
      sharesCreated: 4, teamWorkspaces: 3, teamParticipants: 8, teamActions: 11,
      rewardsConfirmed: 2, rewardedLuna: 250_000, sources: [{ source: 'x-launch', wallets: 5 }],
    }),
  }))
  await page.goto('/usage')

  await expect(page.getByRole('heading', { name: 'Real work, counted without tracking people.' })).toBeVisible()
  await expect(page.getByText('18')).toBeVisible()
  await expect(page.getByText('2.5')).toBeVisible()
  await expect(page.getByText('No cookies, raw wallet addresses, IP history, plan text, or task content.')).toBeVisible()
  await expect(page.locator('body')).not.toContainText('NQ')
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})
