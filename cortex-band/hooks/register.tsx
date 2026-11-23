import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Org } from '../types'

// Prod stalled under load before (Nov 2026): read Cortex at most once a minute.
const EVERY_MS = 60_000

const orgs = atom({ plugin: 'cortex-band', key: 'orgs' } as const, null)
const busy = atom({ plugin: 'cortex-band', key: 'busy' } as const, false)
// Cortex's own mark (app/icon.svg): it follows light and dark mode by itself.
const LOGO = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"6 3 56 56\">\n  <style>.h{fill:#1c1917}.d{fill:#4f46e5}@media (prefers-color-scheme:dark){.h{fill:#f5f5f4}.d{fill:#818cf8}}</style>\n  <path class=\"h\" fill-rule=\"evenodd\" d=\"M20 56V46C12 41 10 33 10 28C10 15 20 6 32 6C45 6 54 15 54 27L58 36H53V44C53 48 50 50 46 50H40V56ZM27.36 24.9L25.18 21.12A2.1 2.1 0 0 1 28.82 19.02L31 22.8L33.18 19.02A2.1 2.1 0 0 1 36.82 21.12L34.64 24.9L39 24.9A2.1 2.1 0 0 1 39 29.1L34.64 29.1L36.82 32.88A2.1 2.1 0 0 1 33.18 34.98L31 31.2L28.82 34.98A2.1 2.1 0 0 1 25.18 32.88L27.36 29.1L23 29.1A2.1 2.1 0 0 1 23 24.9Z\"/>\n  <circle class=\"d\" cx=\"31\" cy=\"27\" r=\"1.7\"/>\n</svg>"

// A problem sits on a dark card in light and dark mode alike, so its text and icon stay light.
const ISSUE_BG = '#171717'
const ISSUE_TEXT = '#f5f5f4'
// Remix's information-line, beside a problem.
const INFO =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#f5f5f4" d="M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10-4.477 10-10 10Zm0-2a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM11 7h2v2h-2V7Zm0 4h2v6h-2v-6Z"/></svg>'

// Sync runs /cortex, the skill the team installs from Cortex; without it, no Sync.
export const syncCommand = (names: readonly string[]) => (names.includes('cortex') ? 'cortex' : null)

// $.state is the session's: a new session starts with the band shown again.
const hidden = atom({ plugin: 'cortex-band', key: 'hidden' } as const, false)

const tab = atom({ plugin: 'cortex-band', key: 'tab' } as const, null)

// The connector's server name differs by host ("claude.ai Cortex" in a terminal, an id in the
// desktop app), so find its tools by their own names: only Cortex has cortex_* tools.
async function toolName($: EngineInterface, tool: string) {
  const name = (await $.tool.list()).find(t => t.mcp && t.name.endsWith(`__${tool}`))?.name
  if (!name) throw new Error('Cortex connector not connected in this session')
  return name
}

async function call($: EngineInterface, tool: string, args?: Record<string, unknown>) {
  // The name is found at run time, so it can't be one of the typed literals.
  const input = { tool: await toolName($, tool), ...args } as Parameters<EngineInterface['tool']['call']>[0]
  const r = await $.tool.call(input)
  if ('deny' in r && r.deny) throw new Error(r.deny)
  if (r.isError) throw new Error(r.text || `${tool} failed`)
  return r.text ?? ''
}

// cortex_list_orgs answers a JSON array of { name, slug, role, active }.
export const orgsOf = (s: string): Org[] =>
  (JSON.parse(s) as Org[]).map(({ name, slug, active }) => ({ name, slug, active }))

// Two orgs may share a name (two orgs of one company): add the slug to tell them apart.
export const orgLabel = (o: Org, all: readonly Org[]) =>
  all.filter(x => x.name === o.name).length > 1 ? `${o.name} (${o.slug})` : o.name

// "cortex-band" → "Cortex", "ponytail" → "Ponytail".
export const tabLabel = (plugin: string) => {
  const name = plugin.replace(/-band$/, '')
  return name.charAt(0).toUpperCase() + name.slice(1)
}

// Where the person connects or signs in to the Cortex connector again.
const CONNECTORS = 'https://claude.ai/settings/connectors'

// An error the connector causes (not connected, signed out): Connect fixes it, not Refresh.
// shortcut: matched on the error's words, switch to a reason code if the engine gives one.
export const isConnectError = (error: string) => /not connected|sign.?in|auth|unauthori[sz]ed|401|403/i.test(error)

// A Button, not a Link, so Connect is drawn like Sync. The mod API opens no URL itself.
// shortcut: macOS `open` only; a Windows or SSH host gets the address in a toast instead.
async function openConnectors($: EngineInterface) {
  const r = await $.process.run(['open', CONNECTORS]).catch(() => null)
  if (r?.exitCode !== 0) $.ui.toast(`Open ${CONNECTORS} to connect Cortex`)
}

// Per session: a read in another session must not hold this one's first read back.
const lastAt = atom({ plugin: 'cortex-band', key: 'lastAt' } as const, 0)

// A new session's connectors are still loading when it starts: wait up to 45 s for
// Cortex's tools before reading, so the band says Connecting… instead of Connect.
async function whenConnected($: EngineInterface) {
  for (let i = 0; i < 15; i++) {
    if ((await $.tool.list()).some(t => t.mcp && t.name.endsWith('__cortex_list_orgs'))) return
    await $.clock.sleep(3000)
  }
}

const within = <T,>($: EngineInterface, ms: number, p: Promise<T>) =>
  Promise.race([p, $.clock.sleep(ms).then((): T => { throw new Error(`Cortex didn't answer in ${ms / 1000}s`) })])

// Counts switches: a read that started before the latest one answers with the old org, and is dropped.
let switches = 0

// The dropdown shows the picked org at once, then Cortex is switched; a refusal puts the previous one back.
async function switchOrg($: EngineInterface, slug: string) {
  const before = await read($, orgs)
  const mine = ++switches
  await update($, orgs, v => v && { ...v, orgs: v.orgs.map(o => ({ ...o, active: o.slug === slug })), error: null })
  try {
    const list = await within($, 15_000, (async () => {
      await call($, 'cortex_switch_org', { slug })
      return orgsOf(await call($, 'cortex_list_orgs'))
    })())
    if (mine !== switches) return
    await update($, orgs, () => ({ orgs: list, error: null }))
  } catch (err) {
    if (mine !== switches) return
    const message = err instanceof Error ? err.message : String(err)
    await update($, orgs, () => ({ orgs: before?.orgs ?? [], error: message.slice(0, 80) }))
    $.ui.toast(`Cortex band: ${message.slice(0, 200)}`)
  }
}

// pressed: the person asked, so an error also goes to a toast; success shows nothing.
async function refresh($: EngineInterface, { pressed = false }: { pressed?: boolean } = {}) {
  const now = await $.clock.now()
  if (await read($, busy)) return
  // After a failure, read again on the next turn: the throttle only spaces out good reads.
  if (!pressed && !(await read($, orgs))?.error && now - (await read($, lastAt)) < EVERY_MS) return
  await update($, lastAt, () => now)
  const at = switches
  await update($, busy, () => true)
  try {
    const list = await within($, 15_000, (async () => orgsOf(await call($, 'cortex_list_orgs')))())
    if (at !== switches) return
    await update($, orgs, () => ({ orgs: list, error: null }))
  } catch (err) {
    if (at !== switches) return
    const message = err instanceof Error ? err.message : String(err)
    await update($, orgs, v => ({ orgs: v?.orgs ?? [], error: message.slice(0, 80) }))
    if (pressed) $.ui.toast(`Cortex band: ${message.slice(0, 200)}`)
  } finally {
    await update($, busy, () => false)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // $.state outlives a reload: a refresh cut off mid-way would leave it busy for good.
    await update($, busy, () => false)
    void whenConnected($).then(() => refresh($))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    void refresh($)
    return next(e)
  })

  // The band stacks one row per mod: show them as tabs, one row at a time.
  on('ui.render', { component: 'AbovePromptList' }, async ($, e, next) => {
    const { rows } = e.props
    if (rows.length < 2) return next(e)
    const picked = await read($, tab)
    const open = rows.find(r => r.plugin === picked) ?? rows[0]!
    const { Box, Button } = $.ui.resolve(e)
    return (
      <Box key="tabs" flexDirection="column" gap={1}>
        <Box flexDirection="row" gap={1} paddingBottom={1}>
          {rows.map(r =>
            r === open ? (
              <Button key={`tab:${r.plugin}`} variant="primary" label={tabLabel(r.plugin)} onPress={() => undefined} />
            ) : (
              <Button key={`tab:${r.plugin}`} plain label={tabLabel(r.plugin)} onPress={() => update($, tab, () => r.plugin)} />
            ),
          )}
        </Box>
        {await next({ ...e, props: { ...e.props, rows: [open] } })}
      </Box>
    )
  })

  // Our row: which organisation Cortex works in, Sync, and Connect or Refresh when something is wrong.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, hidden))) return next(e)
    const isBusy = await read($, busy)
    const sync = syncCommand((await $.command.list()).map(c => c.name))
    const els = $.ui.resolve(e)
    const { Box, Text, Button, Select } = els
    // Shown from the start: before the first read answers, the band says it is connecting.
    const v = (await read($, orgs)) ?? { orgs: [], error: null }
    const connecting = (await read($, orgs)) === null
    const active = v.orgs.find(o => o.active)
    return (
      <Box key="cortex" flexDirection="column" gap={1}>
        <Box flexDirection="row" gap={1} alignItems="center">
          {/* The terminal has no Svg: it goes without the mark. */}
          {'Svg' in els ? (
            <els.Svg key="logo" source={LOGO} alt="Cortex" width={18} height={18} />
          ) : null}
          {v.orgs.length > 0 ? (
            <Select
              key="org"
              options={v.orgs.map(o => ({ value: o.slug, label: orgLabel(o, v.orgs) }))}
              {...(active ? { value: active.slug } : {})}
              onSelect={slug => {
                if (slug !== active?.slug) void switchOrg($, slug)
              }}
            />
          ) : (
            <Text bold>Cortex</Text>
          )}
          {connecting ? <Text dimColor>Connecting…</Text> : null}
          <Box flexGrow={1} />
          <Box flexShrink={0} flexDirection="row" gap={1} alignItems="center">
            {sync ? <Button key="sync" variant="secondary" label="Sync" onPress={() => $.command.run({ command: sync, args: '' })} /> : null}
            <Button key="close" plain role="dismiss" label="×" onPress={() => update($, hidden, () => true)} />
          </Box>
        </Box>
        {/* A problem gets its own dark card: what went wrong, then what fixes it. */}
        {v.error ? (
          <Box
            key="issue"
            flexDirection="row"
            flexWrap="wrap"
            alignItems="center"
            gap={1}
            backgroundColor={ISSUE_BG}
            // No radius prop: a round border in the card's own colour rounds its corners.
            borderStyle="round"
            borderColor={ISSUE_BG}
            padding={1}
          >
            <Box flexGrow={1} flexShrink={1} flexDirection="row" gap={1} alignItems="center">
              {/* The terminal has no Svg: there the line starts with a plain "!". */}
              {'Svg' in els ? <els.Svg key="info" source={INFO} alt="Problem" width={14} height={14} /> : <Text>!</Text>}
              <Text color={ISSUE_TEXT} wrap="wrap">{v.error}</Text>
            </Box>
            <Box flexShrink={0} flexDirection="row" gap={1} alignItems="center">
              {isConnectError(v.error) ? <Button key="connect" variant="secondary" label="Connect" onPress={() => openConnectors($)} /> : null}
              {/* Refresh only when something went wrong: it reads by itself after every turn. */}
              <Button key="refresh" variant="secondary" label={isBusy ? 'Refreshing…' : 'Refresh'} onPress={() => refresh($, { pressed: true })} />
            </Box>
          </Box>
        ) : null}
      </Box>
    )
  })
}
