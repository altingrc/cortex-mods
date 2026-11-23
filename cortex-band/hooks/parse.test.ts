import { expect, test } from 'claude-code/testing'

import { isConnectError, orgLabel, orgsOf, syncCommand, tabLabel } from './register'

const LIST = JSON.stringify([
  { name: 'Cortex', slug: 'cortex', role: 'admin', active: true },
  { name: 'Acme', slug: 'acme-eu', role: 'admin', active: false },
  { name: 'Acme', slug: 'acme-us', role: 'admin', active: false },
])

test('reads the organisations', () => {
  const orgs = orgsOf(LIST)
  expect(orgs.length).toBe(3)
  expect(orgs[0]).toEqual({ name: 'Cortex', slug: 'cortex', active: true })
})

test('tells orgs of the same name apart', () => {
  const orgs = orgsOf(LIST)
  expect(orgLabel(orgs[0]!, orgs)).toBe('Cortex')
  expect(orgLabel(orgs[1]!, orgs)).toBe('Acme (acme-eu)')
})

test('names the tabs', () => {
  expect(tabLabel('cortex-band')).toBe('Cortex')
  expect(tabLabel('ponytail')).toBe('Ponytail')
})

test('tells a connector problem from another error', () => {
  expect(isConnectError('Cortex connector not connected in this session')).toBe(true)
  expect(isConnectError('Unauthorized: sign in again')).toBe(true)
  expect(isConnectError("Cortex didn't answer in 15s")).toBe(false)
})

test('syncs with the skill the person has', () => {
  expect(syncCommand(['cortex', 'review'])).toBe('cortex')
  expect(syncCommand(['cortex-research'])).toBe(null)
})
