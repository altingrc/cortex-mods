# Cortex mods

Mods for Claude Code that bring [Cortex](https://slashcortex.com) into the session.

## cortex-band

A row above the prompt:

- the Cortex mark and a dropdown to pick the organisation Cortex works in;
- **Sync**, which runs `/cortex` when you have it;
- **Connect** (opens claude.ai's connector settings) and **Refresh** when something is wrong;
- **×** to hide it for this session; it comes back in the next one.

With other mods in the same row, it shows them as tabs.

It reads Cortex through your own Cortex connector in Claude, signed in as you, so it
sees only what you see. Without the connector it shows Connect and nothing else.

### Install

At the prompt of a terminal session:

```
/plugin install cortex-band --marketplace altingrc/cortex-mods
```

From a shell:

```bash
claude plugin install cortex-band --marketplace altingrc/cortex-mods
```

Answer `y` to add the marketplace, then pick a scope (user is first).

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then
Plugins, Add marketplace with `altingrc/cortex-mods`, then Add plugin.
