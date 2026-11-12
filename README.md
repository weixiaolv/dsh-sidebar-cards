# dsh-sidebar-cards

Turns the DeepSeek Harness left sidebar into VS Code–style cards: one card holds the
workspace/session tree, sorted by user-made categories; the other collects every panel
and shortcut entry that the shell used to scatter along the top and bottom of the sidebar.

```
▾ Workspaces                 [search] [+ category] [+]
    ▾ 管理 (5)
        ▾ ai_pm (1)
            能否读取飞书项目管理信息
        ▸ ai_组织 (4)
    ▸ 产品开发 (2)
    Uncategorized (3)
▾ Plugins                    [+]
    ▾ 工具 (3)
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
| Workspaces | Create / rename / delete / collapse categories; drag workspaces between them, rename, delete, start a session in one; open, rename, pin, archive or unarchive sessions (archiving a running session asks first), copy the session id; filter by text; three-way archived filter; five sessions per workspace by default, with "show more" adding ten at a time |
| Plugins | Collects every entry registered in `sidebar.panellist` and `sidebar.footer.action`; user-made groups, drag to regroup, hide / restore, click to open; collapsed by default |

## State

`~/.dsh/sidebar-cards/state.json`, read and written by the Host half through the
`/api/dsh-sidebar-cards/state` route. The browser's `localStorage` only mirrors it — the
Host copy wins. On first run the categories left in `localStorage` by
`dsh-workspace-categories` are migrated over.

## Known limitations

- Hiding the native rows depends on the shell's CSS module class names (`panelList` /
  `footerActions`). If a DSH upgrade renames them, the native rows simply reappear; nothing
  crashes.
- Overlaps `dsh-workspace-categories` and `dsh-panel-control`; keep only one of them.

## 中文说明

把 DeepSeek Harness 的左栏做成 VS Code 那种「功能卡片」侧边栏：工作区与会话按分类树组织，
可拖拽归类；原本散落在侧栏顶部图标行和底部快捷入口的插件入口，统一收进「插件」卡，可自建分组、
拖拽、隐藏。布局状态存在 Host 端的 `~/.dsh/sidebar-cards/state.json`，换端口、换浏览器、
刷新页面都不会丢。见上方能力表与已知限制。

---

## Development

Plain ESM, no build step: `index.js` is the Host half (the state route), `client.js` is the
browser half, `cordis.patch.yml` mounts the loader row. `assets/icon-512.png` is the
storefront icon; `locale/*.json` carries the display title and description.
