# dsh-sidebar-cards

Turns the DeepSeek Harness left sidebar into VS Code–style cards: one card holds the
workspace/session tree, sorted by user-made categories; the other collects every panel
and shortcut entry that the shell used to scatter along the top and bottom of the sidebar.

```
▾ Workspaces                 [search] [+ category] [+]
    ▾ Management (5)
        ▾ ai_pm (1)
            Can you read the project records in Feishu?
        ▸ ai_org (4)
    ▸ Product (2)
    Uncategorized (3)
▾ Plugins                    [+]
    ▾ Tools (3)
        Plugin Market
        Scheduler
        Task Board
    Ungrouped (2)
        Lark
        …
```

## Install

```sh
# from GitHub
dsh plugin --profile web add github:weixiaolv/dsh-sidebar-cards

# or from npm
dsh plugin --profile web add dsh-sidebar-cards
```

Then add the bundle to the profile's `dsh.profile.bundles` list (or enable it on the
Plugins page) and restart `dsh web`. Requires DSH `0.2.1-rc.3` or newer; checked on
`0.2.2-rc.1`.

## What it takes over

- The `sidebar.workspaces` slot (`priority: -200`), where it renders the two collapsible
  cards.
- The card style layer hides the shell's own top panel strip (`panelList`) and bottom
  shortcut row (`footerActions`) and re-renders their entries inside the Plugins card.
- The brand row, the new-session button and the settings entry stay native. The
  "native workspace list" entry at the bottom of the card and the "card sidebar" entry in
  the shell footer are both ways back to the shipped browser at any time.

## Capabilities

| Card | What it does |
| --- | --- |
| Workspaces | Create / rename / delete / collapse categories; drag workspaces between them, rename, delete, start a session in one; open, rename, pin, archive or unarchive sessions (archiving a running session asks first), copy the session id; five sessions per workspace by default, with "show more" adding ten at a time |
| Workspaces, view options | Three-way archived filter; sort workspaces by name or by their latest session, each in either direction (re-picking the active mode flips it); expand or collapse everything |
| Search | Matches a workspace's own title and path, and also keeps a workspace whose sessions match; while a query is active no session list is truncated and the "expand all hits" switch unfolds every hit without changing your saved fold state |
| Language | Every label ships in nine languages: English, Simplified and Traditional Chinese, Japanese, French, German, Spanish, Portuguese and Russian. The default follows the browser — zh-CN/SG to Simplified, zh-TW/HK/MO to Traditional, ja/fr/de/es/pt/ru to their own, anything else to English. The choice lives one level down in the Workspaces card's view options: a Language row shows the current language and opens a menu beside it — both lists stay on screen — that also pins “follow browser”, so the options menu itself stays short |
| Plugins | Collects every entry registered in `sidebar.panellist` and `sidebar.footer.action`; user-made groups, drag to regroup, hide / restore, click to open; its menu also opens the plugin list and starts a Creator session with a sidebar-plugin draft; collapsed by default |

## State

`~/.dsh/sidebar-cards/state.json`, read and written by the Host half through the
`/api/dsh-sidebar-cards/state` route. The browser's `localStorage` only mirrors it — the
Host copy wins. The same file keeps the language choice (`lang`: `auto`, `en`, `zh-Hans`,
`zh-Hant`, `ja`, `fr`, `de`, `es`, `pt` or `ru`), so the UI comes back in the language you
left it in.

## Known limitations

- Hiding the native rows depends on the shell's CSS module class names (`panelList` /
  `footerActions`). If a DSH upgrade renames them, the native rows simply reappear; nothing
  crashes.
- Overlaps `dsh-workspace-categories` and `dsh-panel-control`; keep only one of them.

## Development

Plain ESM, no build step: `index.js` is the Host half (the state route), `client.js` is the
browser half, `cordis.patch.yml` mounts the loader row. `assets/icon-512.png` is the
storefront icon; `locale/*.json` carries the display title and description.
