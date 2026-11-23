/** One of my Cortex organisations, as cortex_list_orgs gives it. */
export type Org = { name: string; slug: string; active: boolean }

export type Data = {
  orgs: Org[]
  /** Set when Cortex couldn't be read or switched. */
  error: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'cortex-band': {
      orgs: Data | null
      busy: boolean
      /** The band's open tab: a plugin's name, null for the first. */
      tab: string | null
      /** Closed by the person: hidden for this session, back in the next one. */
      hidden: boolean
      /** When this session last read Cortex, in $.clock.now()'s ms. */
      lastAt: number
    }
  }
}
