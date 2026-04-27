import { test as base, expect } from '@playwright/test'
import { CropperPage } from '../pages/CropperPage'
import { LauncherPage } from '../pages/LauncherPage'
import { MeetingPage } from '../pages/MeetingPage'
import { ModelSelectorPage } from '../pages/ModelSelectorPage'
import { OverlayPage } from '../pages/OverlayPage'
import { SettingsPage } from '../pages/SettingsPage'
import { setupElectronMock } from './electronMocks'
import { type ScenarioName, scenarios } from './mockScenarios'

interface TestFixtures {
  scenario: ScenarioName
  launcher: LauncherPage
  settings: SettingsPage
  overlay: OverlayPage
  meeting: MeetingPage
  cropper: CropperPage
  modelSelector: ModelSelectorPage
}

export const test = base.extend<TestFixtures>({
  scenario: ['default', { option: true }],

  launcher: async ({ page, scenario }, use) => {
    await setupElectronMock(page, scenarios[scenario])
    await use(new LauncherPage(page))
  },

  settings: async ({ page, scenario }, use) => {
    await setupElectronMock(page, scenarios[scenario])
    await use(new SettingsPage(page))
  },

  overlay: async ({ page, scenario }, use) => {
    await setupElectronMock(page, scenarios[scenario])
    await use(new OverlayPage(page))
  },

  meeting: async ({ page, scenario }, use) => {
    await setupElectronMock(page, scenarios[scenario])
    await use(new MeetingPage(page))
  },

  cropper: async ({ page, scenario }, use) => {
    await setupElectronMock(page, scenarios[scenario])
    await use(new CropperPage(page))
  },

  modelSelector: async ({ page, scenario }, use) => {
    await setupElectronMock(page, scenarios[scenario])
    await use(new ModelSelectorPage(page))
  },
})

export { expect }
