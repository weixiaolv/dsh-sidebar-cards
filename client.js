/**
 * dsh-sidebar-cards — client half.
 *
 * Takes over the sidebar's `sidebar.workspaces` region and renders two
 * collapsible cards in it:
 *
 *   Workspaces —— categories > workspaces > sessions, with the management actions
 *             the native browser offers (rename / delete / archive / pin /
 *             new session / new workspace / search / archived filter).
 *   Plugins    —— every panel entry (`sidebar.panellist`) and loose shortcut entry
 *             (`sidebar.footer.action`) collected into one list, with user
 *             groups, hiding and reordering.
 *
 * The shell's own panel strip and foot shortcuts are drawn by ui-sidebar, which
 * no slot can rearrange, so a scoped CSS layer hides those two containers while
 * the cards are the active view; switching back to the native browser restores
 * them (the class is removed and our `sidebar.workspaces` registration is
 * disposed, which brings ui-workspace's browser back immediately).
 *
 * Data comes from the client Cordis services, no private RPC:
 *   ctx.get('workspaces').list -> { items, archivedSessionIds, pinnedSessionIds }
 *   ctx.get('sessions').list   -> { ids, byId }
 * Only the persisted layout talks to the Host, through the JSON state route in
 * index.js.
 */

/**
 * Build the plugin module. Kept separate from the loader call so a throw in the
 * build never aborts the whole Web boot, and so a second evaluation (client HMR
 * re-runs this bundle) can keep the first registration instead of dropping the
 * plugin entirely.
 */
function build(require) {
	var module = { exports: {} }
		var exports = module.exports
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

		const React = require('react')
		const h = React.createElement

		/**
		 * Optional seed package: it supplies the app's own icons and hover hints,
		 * so the sidebar keeps the shipped glyph language. Without it every icon
		 * degrades to the local SVG fallbacks below and hints fall back to `title`.
		 */
		let primitivesModule = null
		try {
			primitivesModule = require('@deepseek-ai/dsh-client-ui-primitives')
		} catch {
			primitivesModule = null
		}
		let Tooltip = primitivesModule && typeof primitivesModule.Tooltip === 'function' ? primitivesModule.Tooltip : null
		/** The app's own status dot (idle / ongoing / warning / done). */
		const StateDot = primitivesModule && typeof primitivesModule.StateDot === 'function' ? primitivesModule.StateDot : null

		/** One shipped icon by export name, or null when this build predates it. */
		function shipped(name) {
			if (!primitivesModule) return null
			const value = primitivesModule[name]
			return typeof value === 'function' ? value : null
		}

		const PACKAGE = 'dsh-sidebar-cards'
		const STYLE_ID = 'dsh-sidebar-cards/styles'
		const HTML_CLASS = 'dsc-on'
		const RPC_CHANNEL = '/api'
		const RPC_ENDPOINT = 'dsh-sidebar-cards/state'
		const MIRROR_KEY = 'dsh.sidebar-cards.state.v1'
		const UNASSIGNED = '__unassigned__'
		const UNGROUPED = '__ungrouped__'
		const SESSION_DEFAULT = 5
		const SESSION_STEP = 10
		const ARCHIVED_MODES = ['default', 'show', 'only']

		let ctxRef = null

		/* ------------------------------------------------------------ utilities */

		function timeOf(value) {
			if (typeof value === 'number' && Number.isFinite(value)) return value
			const parsed = Date.parse(typeof value === 'string' ? value : '')
			return Number.isNaN(parsed) ? 0 : parsed
		}

		function describe(reason) {
			if (reason instanceof Error) return reason.message
			try {
				return JSON.stringify(reason)
			} catch {
				return String(reason)
			}
		}

		function idOf(prefix) {
			return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
		}

		function labelOf(options, fallback) {
			try {
				const raw = options && options.label
				const value = typeof raw === 'function' ? raw() : raw
				if (typeof value === 'string' && value.trim() !== '') return value
			} catch {
				/* a locale thunk may throw before the locale is ready */
			}
			return fallback
		}

		/** Last path segment, used when a Workspace has no stored title. */
		function baseName(value) {
			const text = String(value === undefined || value === null ? '' : value).replace(/[\\/]+$/, '')
			const parts = text.split(/[\\/]/)
			return parts[parts.length - 1] || text
		}

		/* ------------------------------------------------------------ language */

		/**
		 * Every user-visible string, one row per message: [English, Chinese].
		 * `t()` takes the column of the language in force — the saved choice, or
		 * the browser's own language while the choice is "auto" (the default).
		 */
		/**
 * English fallback copy: what the cards render before the Host answers, and
 * the last resort for a message a translation omits. Every other language
 * lives in `locale/ui/<language>.json` and is fetched once per page.
 */
		const EN_STRINGS = {
			"card.workspaces": "Workspaces",
			"card.plugins": "Plugins",
			"card.unassigned": "Uncategorized",
			"card.ungrouped": "Ungrouped",
			"action.cancel": "Cancel",
			"action.confirm": "OK",
			"action.delete": "Delete",
			"action.close": "Close",
			"action.expandAll": "Expand all",
			"action.collapseAll": "Collapse all",
			"category.new": "New category",
			"category.newWorkspace": "New workspace in this category",
			"category.rename": "Rename category",
			"category.delete": "Delete category",
			"category.deleteMessage": "Workspaces in this category move to Uncategorized; no workspace is deleted.",
			"category.namePlaceholder": "Category name, for example Org management / Projects",
			"category.untitled": "Untitled category",
			"plugins.newGroup": "New plugin group",
			"plugins.renameGroup": "Rename group",
			"plugins.deleteGroup": "Delete group",
			"plugins.groupNamePlaceholder": "Group name, for example Tools / Data / Connectors",
			"plugins.dragHint": "Drag into a group",
			"plugins.restore": "Show again",
			"plugins.hide": "Hide entry",
			"plugins.empty": "No plugin entries to manage",
			"plugins.showHidden": "Show hidden entries",
			"plugins.showHiddenCount": "Show hidden entries ({n})",
			"card.files": "Files",
			"files.noSession": "Open a session to browse its files",
			"files.loading": "Reading…",
			"files.empty": "Empty folder",
			"files.error": "Could not read this folder",
			"files.truncated": "List shortened",
			"files.copyFiles": "Copy file paths",
			"files.copyNames": "Copy file names",
			"files.clearSelection": "Clear selection",
			"files.namesCopied": "File names copied",
			"files.copyFile": "Copy file path",
			"files.openWith": "Open folder with…",
			"files.options": "Folder options",
			"files.noSelection": "Select a file first",
			"files.collapseAll": "Collapse all folders",
			"files.copyPath": "Copy project path",
			"files.revealFinder": "Reveal in Finder",
			"files.revealExplorer": "Reveal in File Explorer",
			"files.revealGeneric": "Reveal in the file manager",
			"files.openDefault": "Open with the system default",
			"files.openWithApp": "Open with {app}",
			"files.fileManager": "File manager",
			"files.reveal": "Show in {app}",
			"files.expandLimited": "Expanded the first folders only",
			"files.directoryActions": "Folder actions…",
			"files.noPath": "No project folder",
			"files.copyDone": "Path copied",
			"files.reload": "Reload",
			"plugins.browsePlugins": "Browse other plugins",
			"plugins.createPlugin": "Create your plugin",
			"plugins.createPrompt": "Create a DSH plugin with a left sidebar entry.",
			"plugins.untitledGroup": "Untitled group",
			"session.rename": "Rename session",
			"session.pin": "Pin",
			"session.unpin": "Unpin",
			"session.fork": "Fork session",
			"session.copyId": "Copy session ID",
			"session.archive": "Archive",
			"session.unarchive": "Unarchive",
			"session.more": "More actions",
			"session.untitled": "Untitled",
			"session.empty": "No sessions yet",
			"session.noMatch": "No matching sessions",
			"session.showMore": "Show more",
			"session.showLess": "Show less",
			"session.runningTitle": "This session is still running",
			"session.runningMessage": "Stop it and archive?",
			"session.stopArchive": "Stop and archive",
			"workspace.newSession": "New session",
			"workspace.rename": "Rename workspace",
			"workspace.copyPath": "Copy path",
			"workspace.moveTo": "Move to category",
			"workspace.moveOut": "Remove from category",
			"workspace.delete": "Delete workspace",
			"workspace.deleteMessage": "Removes it from this list only; the folder on disk is untouched.",
			"workspace.more": "Workspace actions",
			"workspace.dropHint": "Drop a workspace here, or click + to create one",
			"workspace.empty": "No workspaces yet — click + above to add a folder",
			"options.title": "View options",
			"options.archivedHeader": "Archived sessions",
			"options.archivedDefault": "Hide archived",
			"options.archivedShow": "All conversations (show archived)",
			"options.archivedOnly": "Archived only",
			"options.sortHeader": "Workspace order",
			"options.sortManual": "Manual order",
			"options.sortName": "By name",
			"options.sortTime": "By latest session",
			"options.newHeader": "New group or workspace",
			"options.newGroup": "New category",
			"options.newWorkspace": "New workspace",
			"options.language": "Language",
			"options.langAuto": "Follow browser",
			"search.placeholder": "Filter workspaces and sessions…",
			"search.expandHits": "Expand all hits",
			"search.collapseHits": "Collapse hits",
			"mode.title": "View",
			"mode.native": "Native list",
			"mode.cards": "Card sidebar",
			"mode.toNative": "Switch to the native workspace list",
			"mode.toCards": "Switch to the card sidebar",
			"error.noDirectoryPicker": "No directory picker is available",
			"error.workspacesUnavailable": "The workspaces service is unavailable",
			"error.sessionsUnavailable": "The sessions service is unavailable",
			"error.pinUnavailable": "Pin is unavailable",
			"error.unpinUnavailable": "Unpin is unavailable",
			"error.forkUnavailable": "Fork is unavailable",
			"error.renameFailed": "Rename failed",
		}

		/** `key -> { language: text }`, filled by `loadStrings()` from the Host. */
		let STRINGS = null

		/** The languages this build carries, in menu order. */
		const LANGS = [
			{ code: 'en', label: 'English' },
			{ code: 'zh-Hans', label: '简体中文' },
			{ code: 'zh-Hant', label: '繁體中文' },
			{ code: 'ja', label: '日本語' },
			{ code: 'fr', label: 'Français' },
			{ code: 'de', label: 'Deutsch' },
			{ code: 'es', label: 'Español' },
			{ code: 'pt', label: 'Português' },
			{ code: 'ru', label: 'Русский' }
		]

		/** Per-language fallback chain, so a partial translation still renders. */
		const LANG_FALLBACK = {
			en: ['en'],
			'zh-Hans': ['zh-Hans', 'en'],
			'zh-Hant': ['zh-Hant', 'zh-Hans', 'en'],
			ja: ['ja', 'en'],
			fr: ['fr', 'en'],
			de: ['de', 'en'],
			es: ['es', 'en'],
			pt: ['pt', 'en'],
			ru: ['ru', 'en']
		}

		/** Map a BCP 47 tag — or a stored choice — onto one of LANGS, or ''. */
		function normalizeLang(value) {
			const tag = String(value === undefined || value === null ? '' : value).toLowerCase()
			if (tag === 'zh-hant' || tag === 'zh-tw' || tag === 'zh-hk' || tag === 'zh-mo') return 'zh-Hant'
			if (tag === 'zh' || tag.indexOf('zh-') === 0) return 'zh-Hans'
			if (tag === 'ja' || tag.indexOf('ja-') === 0) return 'ja'
			if (tag === 'fr' || tag.indexOf('fr-') === 0) return 'fr'
			if (tag === 'en' || tag.indexOf('en-') === 0) return 'en'
			if (tag === 'de' || tag.indexOf('de-') === 0) return 'de'
			if (tag === 'es' || tag.indexOf('es-') === 0) return 'es'
			if (tag === 'pt' || tag.indexOf('pt-') === 0) return 'pt'
			if (tag === 'ru' || tag.indexOf('ru-') === 0) return 'ru'
			return ''
		}

		/** The stored choice, with old values ('zh') and unknown tags folded in. */
		function sanitizeLang(value) {
			if (value === 'auto' || value === undefined || value === null) return 'auto'
			const mapped = normalizeLang(value)
			return mapped === '' ? 'auto' : mapped
		}

		/** The browser's preferred language mapped onto LANGS; English when none match. */
		function browserLang(nav) {
			const agent = nav === undefined ? (typeof navigator === 'undefined' ? null : navigator) : nav
			try {
				const tags = agent === null ? [] : Array.isArray(agent.languages) && agent.languages.length > 0 ? agent.languages : [agent.language]
				for (const tag of tags) {
					const mapped = normalizeLang(tag)
					if (mapped !== '') return mapped
				}
			} catch {
				/* no navigator here: English is the safe default */
			}
			return 'en'
		}

		/** The language in force: the saved choice, otherwise the browser's. */
		function currentLang() {
			const choice = sanitizeLang(getState() && getState().lang)
			return choice === 'auto' ? browserLang() : choice
		}

		/** The label of the language in force, shown beside the submenu row. */
		function currentLangLabel() {
			const code = currentLang()
			const entry = LANGS.find((item) => item.code === code)
			return entry === undefined ? code : entry.label
		}

		function t(key) {
			const chain = LANG_FALLBACK[currentLang()] || LANG_FALLBACK.en
			const row = STRINGS === null ? undefined : STRINGS[key]
			if (row !== undefined) {
				for (const code of chain) {
					const text = row[code]
					if (typeof text === 'string') return text
				}
			}
			const fallback = EN_STRINGS[key]
			return typeof fallback === 'string' ? fallback : key
		}

		/**
		 * Pull every language the package ships from the Host half (one call, one
		 * JSON body) and reshape it into `key -> { language: text }`. English stays
		 * embedded, so the cards stay readable whatever happens to this call.
		 */
		async function loadStrings() {
			const result = await hostCall('strings', {})
			const languages = result && result.languages
			if (languages === null || typeof languages !== 'object') return false
			const merged = {}
			for (const language of Object.keys(languages)) {
				const dictionary = languages[language]
				if (dictionary === null || typeof dictionary !== 'object') continue
				for (const key of Object.keys(dictionary)) {
					const text = dictionary[key]
					if (typeof text !== 'string') continue
					if (merged[key] === undefined) merged[key] = {}
					merged[key][language] = text
				}
			}
			if (Object.keys(merged).length === 0) return false
			STRINGS = merged
			notify()
			return true
		}

		/** `t()` with its `{name}` placeholders filled in. */
		function tf(key, values) {
			let out = t(key)
			const vars = values || {}
			for (const name of Object.keys(vars)) out = out.split('{' + name + '}').join(String(vars[name]))
			return out
		}

		function shortName(packageName) {
			return String(packageName || '')
				.replace(/^@[^/]+\//, '')
				.replace(/^dsh-?/, '')
				.replace(/^client-ui-/, '')
		}

		function isActiveRefusal(reason) {
			if (!(reason instanceof Error) || reason.name !== 'WorkspaceArchiveError') return false
			const rpcError = reason.rpcError
			return rpcError !== undefined && rpcError !== null && rpcError.code === 'workspace/session-active'
		}

		/** Subscribe to one of the Cordis snapshot stores delivered as a prop. */
		function useStoreSnapshot(store) {
			const subscribe = React.useCallback(
				(listener) => {
					if (!store || typeof store.subscribe !== 'function') return () => {}
					return store.subscribe(listener)
				},
				[store]
			)
			const getSnapshot = React.useCallback(
				() => (store && typeof store.getSnapshot === 'function' ? store.getSnapshot() : undefined),
				[store]
			)
			return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
		}

		/* -------------------------------------------------------------- state */

		const DEFAULTS = {
			version: 1,
			mode: 'cards',
			categories: [],
			assign: {},
			expanded: {},
			visible: {},
			archived: 'default',
			workspaceCollapsed: false,
			panelPins: { workspaces: null, plugins: null, files: null },
			workspaceSort: 'manual',
			workspaceSortDir: 'asc',
			lang: 'auto',
			pluginCollapsed: true,
			pluginGroups: [],
			pluginAssign: {},
			pluginHidden: [],
			pluginShowHidden: false,
			filesCollapsed: false
		}

		function sanitize(raw) {
			const merged = Object.assign({}, DEFAULTS, raw || {})
			const categories = Array.isArray(merged.categories)
				? merged.categories
						.filter((entry) => entry && typeof entry.id === 'string' && entry.id !== '')
						.map((entry) => ({
							id: entry.id,
							name: typeof entry.name === 'string' ? entry.name : '',
							collapsed: entry.collapsed === true
						}))
				: []
			const pluginGroups = Array.isArray(merged.pluginGroups)
				? merged.pluginGroups
						.filter((entry) => entry && typeof entry.id === 'string' && entry.id !== '')
						.map((entry) => ({
							id: entry.id,
							name: typeof entry.name === 'string' ? entry.name : '',
							collapsed: entry.collapsed === true
						}))
				: []
			return {
				version: 1,
				mode: merged.mode === 'native' ? 'native' : 'cards',
				categories,
				assign: asRecord(merged.assign),
				expanded: asRecord(merged.expanded),
				visible: asRecord(merged.visible),
				archived: ARCHIVED_MODES.indexOf(merged.archived) === -1 ? 'default' : merged.archived,
				workspaceCollapsed: merged.workspaceCollapsed === true,
				panelPins: (() => {
					const raw = merged.panelPins && typeof merged.panelPins === 'object' ? merged.panelPins : {}
					const pick = (key) => (typeof raw[key] === 'number' && raw[key] > 0 ? Math.round(raw[key]) : null)
					return { workspaces: pick('workspaces'), plugins: pick('plugins'), files: pick('files') }
				})(),
				workspaceSort: ['manual', 'name', 'time'].indexOf(merged.workspaceSort) === -1 ? 'manual' : merged.workspaceSort,
				workspaceSortDir: merged.workspaceSortDir === 'desc' ? 'desc' : 'asc',
				lang: sanitizeLang(merged.lang),
				pluginCollapsed: merged.pluginCollapsed !== false,
				pluginGroups,
				pluginAssign: asRecord(merged.pluginAssign),
				pluginHidden: Array.isArray(merged.pluginHidden) ? merged.pluginHidden.filter((v) => typeof v === 'string') : [],
				pluginShowHidden: merged.pluginShowHidden === true,
				filesCollapsed: merged.filesCollapsed === true
			}
		}

		function asRecord(value) {
			return value !== null && typeof value === 'object' && !Array.isArray(value) ? Object.assign({}, value) : {}
		}

		function readMirror() {
			try {
				const raw = window.localStorage.getItem(MIRROR_KEY)
				return sanitize(raw === null ? null : JSON.parse(raw))
			} catch {
				return sanitize(null)
			}
		}

		let state = readMirror()
		const stateListeners = new Set()
		let saveTimer = null
		let hydrated = false

		function getState() {
			return state
		}

		function notify() {
			for (const listener of stateListeners) {
				try {
					listener()
				} catch {
					/* one bad listener must not stop the rest */
				}
			}
		}

		function writeMirror(next) {
			try {
				window.localStorage.setItem(MIRROR_KEY, JSON.stringify(next))
			} catch {
				/* private mode or a full quota: the Host copy still has it */
			}
		}

		function setState(patch) {
			state = sanitize(Object.assign({}, state, patch))
			writeMirror(state)
			notify()
			scheduleSave()
		}

		function subscribeState(listener) {
			stateListeners.add(listener)
			return () => stateListeners.delete(listener)
		}

		function useStateTick() {
			return React.useSyncExternalStore(subscribeState, getState, getState)
		}

		function scheduleSave() {
			if (saveTimer !== null) clearTimeout(saveTimer)
			saveTimer = setTimeout(() => {
				saveTimer = null
				save()
			}, 300)
		}

		function getRpc() {
			const ctx = ctxRef
			if (!ctx) return null
			let connection = null
			try {
				connection = ctx.connection || null
			} catch {
				connection = null
			}
			if (!connection && typeof ctx.get === 'function') {
				try {
					connection = ctx.get('connection') || null
				} catch {
					connection = null
				}
			}
			const rpc = connection && connection.rpc
			return rpc && typeof rpc.call === 'function' ? rpc : null
		}

		async function hostCall(method, payload) {
			const rpc = getRpc()
			if (!rpc) return null
			try {
				const result = await rpc.call(RPC_CHANNEL, RPC_ENDPOINT, { method, payload })
				if (!result || result.ok !== true) return null
				return result.value
			} catch {
				return null
			}
		}

		/**
		 * Persist the layout. The state object is sent both nested and flat: a
		 * Host half that predates the nested envelope reads the flat copy, one
		 * that knows the envelope reads the nested copy.
		 */
		async function save() {
			const rpc = getRpc()
			if (!rpc) return
			try {
				const result = await rpc.call(RPC_CHANNEL, RPC_ENDPOINT, { method: 'save', state, payload: { state } })
				if (!result || result.ok !== true) return
			} catch {
				/* the route is unavailable: the local mirror still holds the layout */
			}
		}

		/**
		 * Load the Host copy once at startup. A Host copy wins over the local
		 * mirror; without one the mirror (written on every change) is the best
		 * available answer and is immediately written back.
		 */
		async function hydrate() {
			const result = await hostCall('get', {})
			if (result && result.state && typeof result.state === 'object') {
				state = sanitize(Object.assign({}, state, result.state))
				hydrated = true
				writeMirror(state)
				notify()
				return
			}
			hydrated = true
			save()
		}

		/* -------------------------------------------------------------- icons */

		const ICON = {
			chevron: 'M6 3.5 10.5 8 6 12.5',
			plus: 'M8 3.4v9.2M3.4 8h9.2',
			pencil: 'M11.6 2.4l2 2-7.4 7.4-2.8.8.8-2.8z',
			trash: 'M3.2 4.6h9.6M6.4 4.6V3.2h3.2v1.4M4.6 4.6l.6 8.2h5.6l.6-8.2',
			search: 'M7 2.6a4.4 4.4 0 1 1 0 8.8 4.4 4.4 0 0 1 0-8.8zM10.3 10.3 13.8 13.8',
			folder:
				'M2.2 4.6A1.6 1.6 0 0 1 3.8 3h2.1l1.3 1.7h5A1.6 1.6 0 0 1 13.8 6.3v5.1A1.6 1.6 0 0 1 12.2 13H3.8A1.6 1.6 0 0 1 2.2 11.4z',
			chat: 'M13.6 8.1c0 2.6-2.5 4.7-5.6 4.7-.7 0-1.4-.1-2-.3L2.9 14l1-2.5C3.2 10.7 2.9 9.5 2.9 8.1 2.9 5.5 5.4 3.4 8 3.4s5.6 2.1 5.6 4.7z',
			archive: 'M2.4 2.9h11.2v2.9H2.4zM3.4 5.8h9.2v6.6a1.2 1.2 0 0 1-1.2 1.2H4.6a1.2 1.2 0 0 1-1.2-1.2zM6.3 8.3h3.4',
			unarchive:
				'M2.4 2.9h11.2v2.9H2.4zM3.4 5.8h9.2v6.6a1.2 1.2 0 0 1-1.2 1.2H4.6a1.2 1.2 0 0 1-1.2-1.2zM8 12.9V8.1M6.1 10l1.9-1.9L9.9 10',
			pin: 'M9.4 2.3 13.7 6.6 11.9 8.4 11.3 11.3 8.1 8.1 3.4 12.8 3.2 12.6 7.9 7.9 4.7 4.7 7.6 4.1z',
			eye: 'M1.8 8S4.2 3.9 8 3.9 14.2 8 14.2 8 11.8 12.1 8 12.1 1.8 8 1.8 8zM8 6.1a1.9 1.9 0 1 1 0 3.8 1.9 1.9 0 0 1 0-3.8z',
			eyeOff: 'M2 2l12 12M6.4 4.3A6.9 6.9 0 0 1 8 3.9C11.8 3.9 14.2 8 14.2 8a10 10 0 0 1-2 2.4M4.2 5.6A9.9 9.9 0 0 0 1.8 8S4.2 12.1 8 12.1c.6 0 1.2-.1 1.7-.3',
			grip: 'M6 4h.01M10 4h.01M6 8h.01M10 8h.01M6 12h.01M10 12h.01',
			more: 'M3.5 8h.01M8 8h.01M12.5 8h.01',
			close: 'M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6',
			layers: 'M8 2.2 14 5.5 8 8.8 2 5.5zM2 9l6 3.3L14 9M2 12.2 8 15.5l6-3.3',
			plug: 'M6 2.6v3M10 2.6v3M4.4 5.6h7.2v2.3a3.6 3.6 0 0 1-3.6 3.6A3.6 3.6 0 0 1 4.4 7.9zM8 11.5v2.4',
			pinwheel: 'M8 2.5c2 0 3.5 1.6 3.5 3.5S10 9.5 8 9.5 4.5 7.9 4.5 6 6 2.5 8 2.5zM8 13.5c-2 0-3.5-1.6-3.5-3.5S6 6.5 8 6.5s3.5 1.6 3.5 3.5-1.5 3.5-3.5 3.5z',
			file: 'M4.4 2.4h4.2l3 3v8.2H4.4zM8.4 2.6v3.2h3',
			copy: 'M5.2 5.2h7.4v7.4H5.2zM3.4 10.8V3.4h7.4',
			openIn: 'M6.4 9.6 12 4M12 4H8.2M12 4v3.8M11.2 10.4v2.4H3.2V4.8h2.4',
			arrowLeft: 'M12.5 8H3.5M6.8 4.7 3.5 8l3.3 3.3',
			expand: 'M4.5 6 8 9.5 11.5 6M4.5 10.5 8 14l3.5-3.5',
			chevronDown: 'M4 6l4 4 4-4',
			chevronUp: 'M4 10l4-4 4 4',
			list: 'M3 4.2h10M3 8h10M3 11.8h10',
			branch: 'M4.5 3.5v9M4.5 6.5a3 3 0 0 1 3-3h4M4.5 10.5a3 3 0 0 0 3 3h4M11.5 3.5v0M10 2l1.5 1.5L10 5M10 14.5l1.5-1.5M10 11l1.5 1.5',
			sliders: 'M2.5 4.5h5M10 4.5h3.5M2.5 8h3M8 8h5.5M2.5 11.5h7M12 11.5h1.5M8.6 4.5a1.1 1.1 0 1 1-2.2 0 1.1 1.1 0 0 1 2.2 0M7.6 8a1.1 1.1 0 1 1-2.2 0 1.1 1.1 0 0 1 2.2 0M11.6 11.5a1.1 1.1 0 1 1-2.2 0 1.1 1.1 0 0 1 2.2 0'
		}

		const SHIPPED = {
			chevron: shipped('IconTriangleRightFillRegular'),
			plus: shipped('IconPlusOutlineRegular'),
			sliders: shipped('IconSlidersTwoOutlineRegular'),
			search: shipped('IconSearchOutlineRegular'),
			folder: shipped('IconFolderCloseRegular'),
			folderOpen: shipped('IconFolderOpenOutlineRegular'),
			more: shipped('IconEllipsisOutlineRegular'),
			pencil: shipped('IconEditOutlineRegular'),
			trash: shipped('IconTrashOutlineRegular'),
			close: shipped('IconCloseOutlineRegular'),
			archive: shipped('IconArchiveOutlineRegular'),
			unarchive: shipped('IconUnarchiveOutlineRegular'),
			pin: shipped('IconPinOutlineRegular'),
			branch: shipped('IconBranchOutlineRegular'),
			list: shipped('IconFlatListOutlineRegular'),
			layers: shipped('IconWorkspaceTreeOutlineRegular'),
			plug: shipped('IconCordisPluginOutlineRegular'),
			pinwheel: shipped('IconPluginPinwheelOutlineRegular'),
			file: shipped('IconDeliverDocRegular'),
			reload: shipped('IconRefreshOutlineRegular'),
			copy: shipped('IconCopyOutlineRegular'),
			openIn: shipped('IconRightUpOutlineRegular'),
			expand: shipped('IconChevronsUpDownOutlineRegular'),
			chevronDown: shipped('IconChevronDownOutlineRegular'),
			chevronUp: shipped('IconChevronUpOutlineRegular')
		}

		function Icon(props) {
			const size = props.size === undefined ? 14 : props.size
			const ShippedIcon = SHIPPED[props.name]
			if (ShippedIcon) return h(ShippedIcon, { size })
			const path = ICON[props.name] || ICON.more
			const dots = props.name === 'more' || props.name === 'grip'
			return h(
				'svg',
				{
					className: 'dsc-svg',
					width: size,
					height: size,
					viewBox: '0 0 16 16',
					fill: 'none',
					'aria-hidden': 'true',
					focusable: 'false'
				},
				h('path', {
					d: path,
					stroke: 'currentColor',
					strokeWidth: dots ? 2.4 : 1.4,
					strokeLinecap: 'round',
					strokeLinejoin: 'round'
				})
			)
		}

		/* ---------------------------------------------------------- primitives */

		function hint(label) {
			return function withHint(node) {
				if (Tooltip === null) {
					return React.cloneElement(node, { title: label })
				}
				return h(Tooltip, { label, delayMs: 500 }, node)
			}
		}

		function IconButton(props) {
			const className = 'dsc-iconbtn' + (props.active ? ' dsc-iconbtn-active' : '') + (props.className ? ' ' + props.className : '')
			const node = h(
				'button',
				{
					type: 'button',
					className,
					'aria-label': props.label,
					onClick: (event) => {
						event.stopPropagation()
						if (props.onClick) props.onClick(event)
					},
					onPointerDown: (event) => event.stopPropagation()
				},
				h(Icon, { name: props.name, size: props.size === undefined ? 13 : props.size })
			)
			return hint(props.label)(node)
		}

		function Popover(props) {
			const ref = React.useRef(null)
			const flyoutRef = React.useRef(null)
			/** A row that carries a submenu opens a sibling panel beside the menu. */
			const [flyout, setFlyout] = React.useState(null)
			React.useEffect(() => {
				const close = (event) => {
					const insideMenu = ref.current !== null && ref.current.contains(event.target)
					const insideFlyout = flyoutRef.current !== null && flyoutRef.current.contains(event.target)
					if (insideMenu || insideFlyout) return
					props.onClose()
				}
				const onKey = (event) => {
					if (event.key !== 'Escape') return
					if (flyout !== null) setFlyout(null)
					else props.onClose()
				}
				document.addEventListener('mousedown', close, true)
				document.addEventListener('keydown', onKey)
				return () => {
					document.removeEventListener('mousedown', close, true)
					document.removeEventListener('keydown', onKey)
				}
			}, [flyout])

			const open = (item, element) => {
				if (!Array.isArray(item.submenu)) return
				const rect = element.getBoundingClientRect()
				setFlyout({ items: item.submenu, left: rect.left, right: rect.right, top: rect.top })
			}

			const openNow = (item) => flyout !== null && flyout.items === item.submenu

			const renderItem = (item, index, inFlyout) =>
				item.separator === true
					? h('div', { className: 'dsc-menu-sep', key: 'sep' + index })
					: item.header === true
						? h('div', { className: 'dsc-menu-head', key: 'head' + index }, item.label)
						: h(
								'button',
								{
									type: 'button',
									key: 'item' + index,
									role: 'menuitem',
									'aria-haspopup': Array.isArray(item.submenu) ? 'menu' : undefined,
									'aria-expanded': Array.isArray(item.submenu) ? openNow(item) : undefined,
									className: 'dsc-menu-item' + (item.danger ? ' dsc-menu-danger' : '') + (openNow(item) ? ' dsc-menu-item-open' : ''),
									onMouseEnter: (event) => {
										// The flyout never closes itself: its rows are where the pointer
										// lands next. Only a plain row in the parent menu closes it.
										if (inFlyout === true) return
										if (Array.isArray(item.submenu)) open(item, event.currentTarget)
										else if (flyout !== null) setFlyout(null)
									},
									onClick: (event) => {
										if (Array.isArray(item.submenu)) {
											open(item, event.currentTarget)
											return
										}
										props.onClose()
										if (item.onSelect) item.onSelect()
									}
								},
								item.iconSrc
									? h('img', { className: 'dsc-menu-appicon', src: item.iconSrc, width: 13, height: 13, alt: '' })
									: item.icon
										? h(Icon, { name: item.icon, size: 13 })
										: null,
								h('span', { className: 'dsc-menu-label' }, item.label),
								item.trailing ? h('span', { className: 'dsc-menu-trailing' }, item.trailing) : null,
								Array.isArray(item.submenu) ? h('span', { className: 'dsc-menu-caret' }, h(Icon, { name: 'chevron', size: 12 })) : null
							)

			const style = {
				position: 'fixed',
				left: Math.max(8, Math.min(props.x, window.innerWidth - 220)),
				top: Math.max(8, Math.min(props.y, window.innerHeight - 40 - (props.items.length + 2) * 28)),
				zIndex: 4000
			}

			let flyoutStyle = null
			if (flyout !== null) {
				const width = 200
				const height = Math.min(flyout.items.length * 27 + 10, window.innerHeight - 16)
				// Prefer the right side of the menu, flip left when it would overflow.
				let left = flyout.right + 4
				if (left + width > window.innerWidth - 8) left = flyout.left - width - 4
				flyoutStyle = {
					position: 'fixed',
					left: Math.max(8, left),
					top: Math.max(8, Math.min(flyout.top - 4, window.innerHeight - height - 8)),
					width,
					zIndex: 4001
				}
			}

			return h(
				React.Fragment,
				null,
				h('div', { className: 'dsc-menu', style, ref, role: 'menu' }, props.items.map((item, index) => renderItem(item, index, false))),
				flyout === null
					? null
					: h('div', { className: 'dsc-menu dsc-menu-flyout', style: flyoutStyle, ref: flyoutRef, role: 'menu' }, flyout.items.map((item, index) => renderItem(item, index, true)))
			)
		}

		function Dialog(props) {
			const inputRef = React.useRef(null)
			const [value, setValue] = React.useState(props.initialValue === undefined ? '' : props.initialValue)
			React.useEffect(() => {
				if (inputRef.current) {
					inputRef.current.focus()
					inputRef.current.select()
				}
			}, [])
			const submit = () => {
				if (props.confirmOnly === true) return props.onSubmit()
				const trimmed = value.trim()
				if (trimmed === '' && props.allowEmpty !== true) return
				props.onSubmit(trimmed)
			}
			return h(
				'div',
				{ className: 'dsc-scrim', role: 'presentation' },
				h(
					'div',
					{
						className: 'dsc-dialog',
						role: 'dialog',
						'aria-modal': 'true',
						'aria-label': props.title,
						onKeyDown: (event) => {
							if (event.key === 'Enter') submit()
							if (event.key === 'Escape') props.onCancel()
						}
					},
					h('div', { className: 'dsc-dialog-title' }, props.title),
					props.message ? h('div', { className: 'dsc-dialog-message' }, props.message) : null,
					props.confirmOnly === true
						? null
						: h('input', {
								ref: inputRef,
								className: 'dsc-input',
								value,
								placeholder: props.placeholder || '',
								onChange: (event) => setValue(event.target.value)
							}),
					h(
						'div',
						{ className: 'dsc-dialog-actions' },
						h(
							'button',
							{ type: 'button', className: 'dsc-btn', onClick: props.onCancel },
							t('action.cancel')
						),
						h(
							'button',
							{
								type: 'button',
								className: 'dsc-btn dsc-btn-primary' + (props.danger ? ' dsc-btn-danger' : ''),
								onClick: submit
							},
							props.confirmLabel || t('action.confirm')
						)
					)
				)
			)
		}

		/**
		 * The glyph the plugin itself registered.
		 *
		 * The shipped sidebar still renders every panel row (our CSS only hides
		 * it), so the original icon is the SVG inside that row's own button. This
		 * clones that SVG — a static node — instead of re-rendering the plugin's
		 * component, which the slot API does not hand out. A row whose glyph
		 * cannot be found keeps the generic one.
		 */
		/** Give a cloned SVG node its own definition ids and rewrite references. */
		function renameSvgIds(root) {
			let suffix = 0
			const ids = new Map()
			const unique = 'dscg' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
			const scan = [root, ...(root.querySelectorAll ? Array.from(root.querySelectorAll('[id]')) : [])]
			for (const element of scan) {
				if (!element.getAttribute) continue
				const id = element.getAttribute('id')
				if (id === null || id === '') continue
				if (ids.has(id)) continue
				suffix += 1
				ids.set(id, unique + '-' + suffix)
			}
			if (ids.size === 0) return
			for (const [oldId, newId] of ids) {
				for (const element of scan) {
					if (!element.getAttribute) continue
					if (element.getAttribute('id') === oldId) element.setAttribute('id', newId)
				}
			}
			const all = root.querySelectorAll ? [root, ...Array.from(root.querySelectorAll('*'))] : [root]
			for (const element of all) {
				if (!element.attributes) continue
				for (const attribute of Array.from(element.attributes)) {
					let value = attribute.value
					if (value === null || value.indexOf('#') === -1) continue
					let next = value
					for (const [oldId, newId] of ids) next = next.split('#' + oldId).join('#' + newId)
					if (next !== value) element.setAttribute(attribute.name, next)
				}
			}
		}

		function ClonedIcon(props) {
			const hostRef = React.useRef(null)
			const [found, setFound] = React.useState(false)
			React.useEffect(() => {
				const host = hostRef.current
				if (!host) return
				let clone = null
				const timers = []
				const label = String(props.label || '').trim()
				const attempt = () => {
					if (clone !== null) return true
					if (hostRef.current === null) return false
					const scope = Array.from(
						document.querySelectorAll(
							'[class*="panelList"] button, [class*="panelList"] [role="button"], [class*="footerActions"] button'
						)
					)
					const textOf = (element) => (element.getAttribute('aria-label') || element.textContent || '').replace(/\s+/g, ' ').trim()
					// Exact label first: "Plugins" must not borrow "Plugin Market"'s glyph.
					let match = scope.find((element) => label !== '' && textOf(element) === label)
					if (!match && label !== '') match = scope.find((element) => textOf(element).indexOf(label) !== -1)
					if (!match) return false
					// Clone the element that actually carries the glyph: some plugins
					// render an <img> or a styled box instead of an <svg>, and cloning
					// only the <svg> would leave an empty square.
					const wrapsIcon = (element) =>
						element instanceof Element && (element.tagName === 'svg' || element.querySelector('svg, img') !== null)
					let iconNode = Array.from(match.children).find((child) => wrapsIcon(child)) || null
					if (iconNode === null) {
						const inner = match.querySelector('svg, img')
						iconNode = inner === null ? null : inner.closest('span') || inner
					}
					if (iconNode === null) return false
					clone = iconNode.cloneNode(true)
					// A cloned SVG shares its definition ids with the original. The
					// original lives in a hidden container, so a mask/clip-path that
					// references one of those ids no longer resolves and the shape
					// renders as a solid block (dsh-context's mono glyph does exactly
					// this). Give the copy its own ids and rewrite every reference.
					renameSvgIds(clone)
					if (clone.tagName === 'svg') {
						if (clone.getAttribute('width') === null) clone.setAttribute('width', '15')
						if (clone.getAttribute('height') === null) clone.setAttribute('height', '15')
					}
					host.appendChild(clone)
					setFound(true)
					return true
				}
				if (!attempt()) {
					for (const delay of [60, 180, 420, 900, 1600]) timers.push(setTimeout(attempt, delay))
				}
				return () => {
					for (const timer of timers) clearTimeout(timer)
					if (clone !== null) {
						try {
							host.removeChild(clone)
						} catch {
							/* already detached */
						}
					}
				}
			}, [props.label])
			return h(
				'span',
				{ className: 'dsc-glyph' },
				h('span', { className: 'dsc-glyph-clone', ref: hostRef, 'aria-hidden': 'true' }),
				found ? null : h(Icon, { name: props.fallback || 'plug', size: 13 })
			)
		}

		/**
		 * The plugin's own icon, asked from the panel list it registered into.
		 * `renderSlot` answers with the entry's element; when this build cannot
		 * render it the row keeps the generic glyph instead of a blank cell.
		 */
		function EntryIcon(props) {
			const [node, setNode] = React.useState(undefined)
			React.useEffect(() => {
				let value = null
				try {
					const slots = ctxRef && ctxRef.slots
					if (slots && typeof slots.renderSlot === 'function') {
						value = slots.renderSlot(props.slot || 'sidebar.panellist', { size: 15, active: false }, { only: props.id })
					}
				} catch {
					value = null
				}
				setNode(value === undefined || value === null ? null : value)
			}, [props.id])
			if (node) return h('span', { className: 'dsc-glyph' }, node)
			return h(
				'span',
				{ className: 'dsc-glyph' + (node === null ? ' dsc-glyph-fallback' : '') },
				node === null ? h(Icon, { name: 'plug', size: 13 }) : null
			)
		}

		/** Render one foreign slot entry (an icon, a settings page, a shortcut). */
		function SlotNode(props) {
			const [node, setNode] = React.useState(null)
			React.useEffect(() => {
				let value = null
				try {
					const slots = ctxRef && ctxRef.slots
					if (slots && typeof slots.renderSlot === 'function') {
						value = slots.renderSlot(props.slot, props.slotProps || {}, { only: props.id })
					}
				} catch {
					value = null
				}
				setNode(value === undefined ? null : value)
			}, [props.slot, props.id])
			return h('span', { className: props.className || 'dsc-glyph', 'aria-hidden': props.hidden === true }, node)
		}

		/* ------------------------------------------------------- card helpers */

		function CardHeader(props) {
			return h(
				'div',
				{ className: 'dsc-cardhead' },
				h(
					'button',
					{
						type: 'button',
						className: 'dsc-cardtoggle',
						'aria-expanded': props.open,
						onClick: props.onToggle
					},
					h('span', { className: 'dsc-caret' + (props.open ? ' dsc-caret-open' : '') }, h(Icon, { name: 'chevron', size: 12 })),
					h('span', { className: 'dsc-cardtitle' }, props.title),
					props.count === undefined ? null : h('span', { className: 'dsc-headcount' }, String(props.count))
				),
				props.open ? h('span', { className: 'dsc-cardacts' }, props.children) : null
			)
		}

		function CountBadge(props) {
			if (!props.count) return null
			return h('span', { className: 'dsc-countcell' }, String(props.count))
		}

		/**
		 * The resize handle between two stacked cards. It reports the pointer
		 * movement since the gesture began; the layout decides what that movement
		 * means, so a handle never has to know how tall anything is.
		 */
		function Splitter(props) {
			const onPointerDown = (event) => {
				if (event.button !== 0) return
				event.preventDefault()
				const startY = event.clientY
				if (props.onStart) props.onStart()
				const move = (moveEvent) => {
					props.onDrag(moveEvent.clientY - startY)
				}
				const stop = () => {
					window.removeEventListener('pointermove', move)
					window.removeEventListener('pointerup', stop)
					window.removeEventListener('pointercancel', stop)
					document.body.style.cursor = ''
					document.body.style.userSelect = ''
					if (props.onEnd) props.onEnd()
				}
				window.addEventListener('pointermove', move)
				window.addEventListener('pointerup', stop)
				window.addEventListener('pointercancel', stop)
				document.body.style.cursor = 'row-resize'
				document.body.style.userSelect = 'none'
			}
			return h('div', {
				className: 'dsc-splitter' + (props.hidden === true ? ' dsc-splitter-hidden' : ''),
				role: 'separator',
				'aria-orientation': 'horizontal',
				tabIndex: -1,
				onPointerDown: props.hidden === true ? undefined : onPointerDown,
				onDoubleClick: props.hidden === true ? undefined : () => props.onReset()
			})
		}

		/* -------------------------------------------------------- plugin card */

		function PluginCard(props) {
			const stateNow = useStateTick()
			const entries = useStoreSnapshot(props.pluginEntriesStore)
			const panels = entries && Array.isArray(entries.panels) ? entries.panels : []
			const [menu, setMenu] = React.useState(null)
			const [dialog, setDialog] = React.useState(null)
			const [dragKey, setDragKey] = React.useState(null)
			const [overGroup, setOverGroup] = React.useState(null)

			// Foot shortcuts are handled by FooterProxies (their components own the
			// only renderable form), so the managed list is the panel family only.
			const all = React.useMemo(
				() => panels.map((panel) => ({ key: 'p:' + panel.id, kind: 'panel', id: panel.id, label: panel.label })),
				[panels]
			)

			const hidden = new Set(stateNow.pluginHidden)
			const assign = stateNow.pluginAssign
			const groups = stateNow.pluginGroups
			const known = new Set(groups.map((group) => group.id))

			const showHidden = stateNow.pluginShowHidden === true
			const visibleRows = all.filter((row) => showHidden || !hidden.has(row.key))

			const buckets = new Map(groups.map((group) => [group.id, []]))
			const ungrouped = []
			for (const row of visibleRows) {
				const target = assign[row.key]
				if (target !== undefined && known.has(target)) buckets.get(target).push(row)
				else ungrouped.push(row)
			}

			const setPlugin = (patch) => setState(patch)

			const assignTo = (key, groupId) => {
				const next = Object.assign({}, assign)
				if (groupId === UNGROUPED) delete next[key]
				else next[key] = groupId
				setPlugin({ pluginAssign: next })
			}

			const toggleHidden = (key) => {
				const list = new Set(stateNow.pluginHidden)
				if (list.has(key)) list.delete(key)
				else list.add(key)
				setPlugin({ pluginHidden: Array.from(list) })
			}

			/**
			 * The shipped "Create your plugin" action: a blank Session on the
			 * Creator preset whose draft already asks for a sidebar plugin. The
			 * draft is never sent.
			 */
			/** The shipped "Browse other plugins" action (the plugin list page). */
			const browsePlugins = () => {
				const navigation = safeService('pluginNavigation')
				if (!navigation || typeof navigation.openList !== 'function') return false
				try {
					navigation.openList()
					return true
				} catch {
					return false
				}
			}

			const createPlugin = () => {
				const uiWorkspace = safeService('uiWorkspace')
				if (!uiWorkspace || typeof uiWorkspace.startSession !== 'function') return
				try {
					uiWorkspace.startSession(undefined, {
						agentPreset: 'cordis',
						prompt: t('plugins.createPrompt'),
						whenDraftExists: 'append'
					})
				} catch (error) {
					console.warn('[dsh-sidebar-cards] could not start the Creator session', error)
				}
			}

			const newGroup = () => {
				setDialog({
					title: t('plugins.newGroup'),
					placeholder: t('plugins.groupNamePlaceholder'),
					onSubmit: (name) => {
						setDialog(null)
						if (name === '') return
						setPlugin({ pluginGroups: groups.concat([{ id: idOf('pg_'), name, collapsed: false }]) })
					}
				})
			}

			const openRow = (row) => {
				const layout = safeService('layout')
				if (layout && typeof layout.selectPanel === 'function') layout.selectPanel(row.id)
			}

			const activePanelId = props.activePanelId

			const renderRow = (row) =>
				h(
					'div',
					{
						key: row.key,
						className:
							'dsc-row dsc-plugin-row' +
							(hidden.has(row.key) ? ' dsc-hidden-row' : '') +
							(row.id === activePanelId ? ' dsc-selected' : ''),
						draggable: true,
						onDragStart: (event) => {
							event.dataTransfer.setData('text/plain', 'pl:' + row.key)
							event.dataTransfer.effectAllowed = 'move'
							setDragKey(row.key)
						},
						onDragEnd: () => setDragKey(null)
					},
					h('span', { className: 'dsc-grip', title: t('plugins.dragHint') }, h(Icon, { name: 'grip', size: 12 })),
					h(
						'button',
						{
							type: 'button',
							className: 'dsc-rowmain',
							onClick: () => openRow(row)
						},
						h(ClonedIcon, { label: row.label }),
						h('span', { className: 'dsc-rowlabel dsc-strong' }, row.label)
					),
					h(
						'span',
						{ className: 'dsc-rowacts' },
						h(IconButton, {
							name: hidden.has(row.key) ? 'eye' : 'eyeOff',
							label: hidden.has(row.key) ? t('plugins.restore') : t('plugins.hide'),
							onClick: () => toggleHidden(row.key)
						})
					)
				)

			const renderGroup = (group) =>
				h(
					'div',
					{
						key: group.id,
						className: 'dsc-group' + (overGroup === group.id ? ' dsc-drop' : ''),
						onDragOver: (event) => {
							if (dragKey === null) return
							event.preventDefault()
							setOverGroup(group.id)
						},
						onDragLeave: () => setOverGroup((current) => (current === group.id ? null : current)),
						onDrop: (event) => {
							event.preventDefault()
							const raw = event.dataTransfer.getData('text/plain')
							setOverGroup(null)
							setDragKey(null)
							if (raw.startsWith('pl:')) assignTo(raw.slice(3), group.id)
						}
					},
					h(
						'div',
						{ className: 'dsc-row dsc-cat-row' },
						h(
							'button',
							{
								type: 'button',
								className: 'dsc-rowmain',
								onClick: () => {
									const next = groups.map((entry) =>
										entry.id === group.id ? Object.assign({}, entry, { collapsed: !entry.collapsed }) : entry
									)
									setPlugin({ pluginGroups: next })
								}
							},
							h(
								'span',
								{ className: 'dsc-caret' + (group.collapsed ? '' : ' dsc-caret-open') },
								h(Icon, { name: 'chevron', size: 12 })
							),
							h('span', { className: 'dsc-rowlabel dsc-catlabel' }, group.name || t('plugins.untitledGroup'))
						),
						h(CountBadge, { count: (buckets.get(group.id) || []).length }),
						h(
							'span',
							{ className: 'dsc-rowacts' },
							h(IconButton, {
								name: 'pencil',
								label: t('plugins.renameGroup'),
								onClick: () =>
									setDialog({
										title: t('plugins.renameGroup'),
										initialValue: group.name,
										onSubmit: (name) => {
											setDialog(null)
											if (name === '') return
											setPlugin({
												pluginGroups: groups.map((entry) =>
													entry.id === group.id ? Object.assign({}, entry, { name }) : entry
												)
											})
										}
									})
							}),
							h(IconButton, {
								name: 'trash',
								label: t('plugins.deleteGroup'),
								onClick: () => {
									const nextAssign = Object.assign({}, assign)
									for (const key of Object.keys(nextAssign)) {
										if (nextAssign[key] === group.id) delete nextAssign[key]
									}
									setPlugin({
										pluginGroups: groups.filter((entry) => entry.id !== group.id),
										pluginAssign: nextAssign
									})
								}
							})
						)
					),
					group.collapsed ? null : h('div', { className: 'dsc-group-body' }, (buckets.get(group.id) || []).map(renderRow))
				)

			const open = stateNow.pluginCollapsed !== true
			const totalVisible = visibleRows.length

			return h(
				'div',
				{
					'data-card': 'plugins',
					className: 'dsc-card dsc-plugincard',
					style: open && typeof props.size === 'number' ? { height: String(props.size) + 'px' } : undefined
				},
				h(
					CardHeader,
					{
						title: t('card.plugins'),
						open,
						count: totalVisible,
						onToggle: () => setPlugin({ pluginCollapsed: open })
					},
					h(IconButton, {
						name: 'sliders',
						label: t('options.title'),
						onClick: (event) => {
							const rect = event.currentTarget.getBoundingClientRect()
							const hiddenCount = all.filter((row) => hidden.has(row.key)).length
							setMenu({
								x: rect.right - 200,
								y: rect.bottom + 4,
								items: [
									{
										label: hiddenCount > 0 ? tf('plugins.showHiddenCount', { n: hiddenCount }) : t('plugins.showHidden'),
										trailing: showHidden ? '✓' : '',
										onSelect: () => setPlugin({ pluginShowHidden: !showHidden })
									},
									{ separator: true },
									{
										label: t('action.expandAll'),
										onSelect: () => setPlugin({ pluginGroups: groups.map((group) => Object.assign({}, group, { collapsed: false })) })
									},
									{
										label: t('action.collapseAll'),
										onSelect: () => setPlugin({ pluginGroups: groups.map((group) => Object.assign({}, group, { collapsed: true })) })
									},
									{ separator: true },
									// Discovery only exists while the plugin navigation service
									// is mounted, exactly like the shipped More menu.
									...(safeService('pluginNavigation') && typeof safeService('pluginNavigation').openList === 'function'
										? [{ label: t('plugins.browsePlugins'), icon: 'pinwheel', onSelect: () => browsePlugins() }]
										: []),
									{ label: t('plugins.createPlugin'), icon: 'plus', onSelect: () => createPlugin() }
								]
							})
						}
					}),
					h(IconButton, { name: 'plus', label: t('plugins.newGroup'), onClick: newGroup })
				),
				open
					? h(
							'div',
							{ className: 'dsc-cardbody dsc-pluginbody', 'data-card-body': true },
							groups.map(renderGroup),
							ungrouped.length > 0
								? h(
										'div',
										{
											className: 'dsc-group' + (overGroup === UNGROUPED ? ' dsc-drop' : ''),
											onDragOver: (event) => {
												if (dragKey === null) return
												event.preventDefault()
												setOverGroup(UNGROUPED)
											},
											onDragLeave: () => setOverGroup((current) => (current === UNGROUPED ? null : current)),
											onDrop: (event) => {
												event.preventDefault()
												const raw = event.dataTransfer.getData('text/plain')
												setOverGroup(null)
												setDragKey(null)
												if (raw.startsWith('pl:')) assignTo(raw.slice(3), UNGROUPED)
											}
										},
										h(
											'div',
											{ className: 'dsc-row dsc-cat-row dsc-group-ghost' },
											h(
												'span',
												{ className: 'dsc-rowmain' },
												h('span', { className: 'dsc-rowlabel dsc-catlabel' }, t('card.ungrouped'))
											),
											h(CountBadge, { count: ungrouped.length })
										),
										ungrouped.map(renderRow)
									)
								: null,
							groups.length === 0 && ungrouped.length === 0
								? h('div', { className: 'dsc-empty' }, t('plugins.empty'))
								: null,
							h(FooterProxies, null)
						)
					: null,
				menu ? h(Popover, { x: menu.x, y: menu.y, items: menu.items, onClose: () => setMenu(null) }) : null,
				dialog
					? h(Dialog, {
							title: dialog.title,
							placeholder: dialog.placeholder,
							initialValue: dialog.initialValue,
							message: dialog.message,
							confirmOnly: dialog.confirmOnly,
							danger: dialog.danger,
							confirmLabel: dialog.confirmLabel,
							onCancel: () => setDialog(null),
							onSubmit: dialog.onSubmit
						})
					: null
			)
		}

		/**
		 * The foot's other entries (Lark, the market's "More", …) can only be
		 * rendered by the plugin that owns them, so the card keeps a proxy row
		 * per entry: it reads the label from the live DOM and forwards a click to
		 * the original element, which stays mounted (hidden by CSS) in the foot.
		 */
		function FooterProxies() {
			const [rows, setRows] = React.useState([])
			React.useEffect(() => {
				let observer = null
				let timer = null
				const collect = () => {
					const foot = document.querySelector('[class*="footerActions"]')
					if (!foot) {
						setRows([])
						return
					}
					const next = []
					for (const child of Array.from(foot.children)) {
						if (child.querySelector('.dsc-modeswitch')) continue
						const label = (child.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24)
						if (label === '') continue
						next.push({ node: child, label })
					}
					setRows(next)
				}
				collect()
				timer = setTimeout(collect, 800)
				const foot = document.querySelector('[class*="footerActions"]')
				if (foot && typeof MutationObserver === 'function') {
					observer = new MutationObserver(() => collect())
					observer.observe(foot, { childList: true, subtree: true })
				}
				return () => {
					if (observer) observer.disconnect()
					if (timer !== null) clearTimeout(timer)
				}
			}, [])
			if (rows.length === 0) return null
			return h(
				'div',
				{ className: 'dsc-proxies' },
				rows.map((row, index) =>
					h(
						'div',
						{ key: index, className: 'dsc-row dsc-plugin-row' },
						h(
							'button',
							{
								type: 'button',
								className: 'dsc-rowmain',
								onClick: () => {
									try {
										row.node.click()
									} catch {
										/* the entry is gone */
									}
								}
							},
							h(ClonedIcon, { label: row.label, fallback: 'layers' }),
							h('span', { className: 'dsc-rowlabel' }, row.label)
						)
					)
				)
			)
		}

		/* ------------------------------------------------------ file glyphs */

		/**
		 * A small file-icon set: one soft colour per family and a shape that says
		 * what the family is (code, data, image, text, document). Drawn here so the
		 * plugin carries no third-party icon artwork.
		 */
		const FILE_FAMILIES = [
			{ kind: 'code', tone: '#e0b341', exts: ['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'go', 'rs', 'java', 'rb', 'php', 'c', 'h', 'cpp', 'cs', 'swift', 'kt', 'sh', 'bash', 'zsh', 'lua', 'sql'] },
			{ kind: 'data', tone: '#7f8cf0', exts: ['json', 'jsonc', 'yaml', 'yml', 'toml', 'xml', 'ini', 'conf', 'env', 'lock', 'csv', 'tsv'] },
			{ kind: 'image', tone: '#b07fe0', exts: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp', 'avif'] },
			{ kind: 'markup', tone: '#79a9f5', exts: ['md', 'mdx', 'markdown', 'rst', 'txt', 'log'] },
			{ kind: 'web', tone: '#e08a5a', exts: ['html', 'htm', 'css', 'scss', 'sass', 'less', 'vue', 'svelte'] },
			{ kind: 'doc', tone: '#c8b06a', exts: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'license'] }
		]

		function fileFamily(name) {
			const base = String(name || '').toLowerCase()
			const dot = base.lastIndexOf('.')
			const ext = dot === -1 ? base : base.slice(dot + 1)
			if (base === 'license' || base === 'licence' || base.startsWith('license.')) {
				return { kind: 'doc', tone: '#c8b06a' }
			}
			for (const family of FILE_FAMILIES) {
				if (family.exts.indexOf(ext) !== -1) return family
			}
			return { kind: 'file', tone: 'var(--dsw-alias-label-tertiary)' }
		}

		/** One file row's glyph: the shape says the family, the colour tells families apart. */
		function FileGlyph(props) {
			const size = props.size === undefined ? 13 : props.size
			const family = fileFamily(props.name)
			const stroke = family.tone
			const sheet = h('path', {
				d: 'M4.2 2.2h4.6l2.9 2.9v8.7H4.2z M8.8 2.4v2.9h2.9',
				fill: 'none',
				stroke,
				'stroke-width': 1.15,
				'stroke-linejoin': 'round'
			})
			let mark = null
			if (family.kind === 'code') {
				mark = h('path', { d: 'M6.4 8.1l-1.3 1.4 1.3 1.4M9.6 8.1l1.3 1.4-1.3 1.4', fill: 'none', stroke, 'stroke-width': 1.1, 'stroke-linecap': 'round' })
			} else if (family.kind === 'data') {
				mark = h('path', { d: 'M6.2 8.6h3.6M6.2 10.4h3.6M6.2 12.2h2.2', fill: 'none', stroke, 'stroke-width': 1.05, 'stroke-linecap': 'round' })
			} else if (family.kind === 'markup') {
				mark = h('path', { d: 'M6.2 8.6h3.6M6.2 10.4h3.6M6.2 12.2h2.4', fill: 'none', stroke, 'stroke-width': 1.05, 'stroke-linecap': 'round' })
			} else if (family.kind === 'image') {
				mark = h('path', { d: 'M6.1 12.4l1.7-2 .9 1 .8-.9 1.4 1.9z', fill: 'none', stroke, 'stroke-width': 1.05 })
			} else if (family.kind === 'web') {
				mark = h('path', { d: 'M6.4 8.2l-1.4 1.5 1.4 1.5M9.6 8.2l1.4 1.5-1.4 1.5M8.6 7.9l-.9 4', fill: 'none', stroke, 'stroke-width': 1.05, 'stroke-linecap': 'round' })
			} else if (family.kind === 'doc') {
				mark = h('path', { d: 'M6.2 8.7h3.6M6.2 10.6h3.6', fill: 'none', stroke, 'stroke-width': 1.05, 'stroke-linecap': 'round' })
			}
			return h(
				'svg',
				{
					className: 'dsc-svg',
					width: size,
					height: size,
					viewBox: '0 0 16 16',
					'aria-hidden': 'true',
					focusable: 'false'
				},
				sheet,
				mark
			)
		}

		/* --------------------------------------------------------- files card */

		/**
		 * The current project's files, one directory at a time over the wire.
		 *
		 * The listing is the same Remote the shipped Files panel uses
		 * (`remote.workspaceFiles.list(sessionId, path)`), scoped to the Session
		 * the main view is showing, so the panel always means "the project I am
		 * looking at". A file row opens through the resource registry, exactly like
		 * a file link in the conversation does.
		 */
		function FilesCard(props) {
			const stateNow = useStateTick()
			const wsSnap = useStoreSnapshot(props.workspacesStore) || {}
			const sSnap = useStoreSnapshot(props.sessionsStore) || {}
			const [dirs, setDirs] = React.useState({})
			const [expanded, setExpanded] = React.useState([])
			const [tick, setTick] = React.useState(0)
			const [failure, setFailure] = React.useState(null)
			const [selection, setSelection] = React.useState([])
			const [anchor, setAnchor] = React.useState(null)
			const [menu, setMenu] = React.useState(null)
			const [notice, setNotice] = React.useState(null)
			const [defaultApp, setDefaultApp] = React.useState(null)
			const [revealIcon, setRevealIcon] = React.useState(null)

			const activeSessionId = React.useMemo(() => {
				const byId = sSnap.byId || {}
				for (const id of sSnap.ids || []) {
					const summary = byId[id]
					if (summary && summary.retainedBy && summary.retainedBy.mainView > 0) return id
				}
				return undefined
			}, [sSnap])

			/**
			 * Which project the tree shows: the open Session's Workspace when there is
			 * one, otherwise the most recently used Workspace — the same fallback the
			 * shell uses for a blank New Session.
			 */
			const workspacePath = React.useMemo(() => {
				const items = Array.isArray(wsSnap.items) ? wsSnap.items : []
				const usable = (workspace) => {
					const path = String(workspace.path || '').replace(/[\\/]+$/, '')
					return path === '' ? undefined : path
				}
				if (activeSessionId !== undefined) {
					for (const workspace of items) {
						if ((workspace.sessionIds || []).indexOf(activeSessionId) !== -1) {
							const path = usable(workspace)
							if (path !== undefined) return path
						}
					}
				}
				const byId = sSnap.byId || {}
				let best
				let bestAt = -1
				for (const workspace of items) {
					const path = usable(workspace)
					if (path === undefined) continue
					let at = 0
					for (const id of workspace.sessionIds || []) {
						const summary = byId[id]
						if (summary === undefined) continue
						const stamp = timeOf(summary.updatedAt)
						if (stamp > at) at = stamp
					}
					if (at > bestAt) {
						bestAt = at
						best = path
					}
				}
				return best
			}, [activeSessionId, wsSnap, sSnap])

			const listDir = React.useCallback(
				(path) => {
					if (activeSessionId === undefined) return Promise.resolve()
					setDirs((current) => Object.assign({}, current, { [path]: { status: 'loading', entries: [] } }))
					let call
					try {
						const remote = safeService('remote') || (ctxRef && ctxRef.remote)
						call = remote && remote.workspaceFiles && typeof remote.workspaceFiles.list === 'function'
							? remote.workspaceFiles.list(activeSessionId, path, new AbortController().signal)
							: Promise.resolve({ ok: false, error: { message: 'workspaceFiles is unavailable' } })
					} catch (error) {
						call = Promise.reject(error)
					}
					return Promise.resolve(call)
						.then((result) => {
							if (!result || result.ok !== true) {
								const message = result && result.error && result.error.message ? result.error.message : 'read failed'
								setDirs((current) => Object.assign({}, current, { [path]: { status: 'error', entries: [], message } }))
								return []
							}
							const value = result.value || {}
							setDirs((current) =>
								Object.assign({}, current, {
									[path]: { status: 'ready', entries: value.entries || [], truncated: value.truncated === true }
								})
							)
							return value.entries || []
						})
						.catch((error) => {
							setDirs((current) => Object.assign({}, current, { [path]: { status: 'error', entries: [], message: describe(error) } }))
							return []
						})
				},
				[activeSessionId]
			)

			React.useEffect(() => {
				setDirs({})
				setExpanded([])
				setSelection([])
				setAnchor(null)
				setFailure(null)
				if (activeSessionId !== undefined && workspacePath !== undefined) listDir(workspacePath)
			}, [activeSessionId, workspacePath, tick, listDir])

			const toggleDir = (path) => {
				if (expanded.indexOf(path) !== -1) {
					setExpanded(expanded.filter((entry) => entry !== path))
					return
				}
				if (dirs[path] === undefined || dirs[path].status !== 'ready') listDir(path)
				setExpanded(expanded.concat([path]))
			}

			/**
			 * One click on a file selects it: plain replaces the selection,
			 * Cmd/Ctrl toggles, Shift extends from the last anchor. Double-click
			 * opens the preview through the resource registry.
			 */
			const selectFile = (event, relativePath, order) => {
				if (event.shiftKey && anchor !== null) {
					const from = order.indexOf(anchor)
					const to = order.indexOf(relativePath)
					if (from !== -1 && to !== -1) {
						const [low, high] = from < to ? [from, to] : [to, from]
						setSelection(order.slice(low, high + 1))
						return
					}
				}
				if (event.metaKey || event.ctrlKey) {
					setSelection((current) =>
						current.indexOf(relativePath) === -1 ? current.concat([relativePath]) : current.filter((entry) => entry !== relativePath)
					)
					setAnchor(relativePath)
					return
				}
				setSelection([relativePath])
				setAnchor(relativePath)
			}

			const openFile = (relativePath) => {
				if (activeSessionId === undefined) return
				const relative = relativePath
					.split('/')
					.map((segment) => encodeURIComponent(segment))
					.join('/')
				const address = `dsh-resource://file/session/${encodeURIComponent(activeSessionId)}/${relative}`
				try {
					const sidebarRight = safeService('sidebarRight')
					if (sidebarRight && typeof sidebarRight.openResource === 'function') sidebarRight.openResource(address)
				} catch (error) {
					setFailure(describe(error))
				}
			}

			const writeClipboard = (value) => {
				try {
					Promise.resolve(navigator.clipboard.writeText(value)).then(
						() => setNotice(t('files.copyDone')),
						(error) => setFailure(describe(error))
					)
				} catch (error) {
					setFailure(describe(error))
				}
			}

			/** Copy the selected files' paths (one per line), or say nothing was selected. */
			const copySelection = () => {
				if (workspacePath === undefined) return
				if (selection.length === 0) {
					setNotice(t('files.noSelection'))
					return
				}
				writeClipboard(selection.map((relative) => workspacePath + '/' + relative).join('\n'))
			}

			/** Copy just the basenames of the selected files. */
			const copyNames = () => {
				if (selection.length === 0) {
					setNotice(t('files.noSelection'))
					return
				}
				const names = selection.map((relative) => relative.split('/').pop() || relative).join('\n')
				writeClipboard(names)
			}

			const copyFolder = () => {
				if (workspacePath === undefined) return
				writeClipboard(workspacePath)
			}

			/**
			 * The operating system's default application for what the menu acts on:
			 * the selected file, or the project folder when nothing is selected. The
			 * Host reports the display name and icon, so the row can wear them; a
			 * failed read leaves just the generic label.
			 */
			const targetPath = () =>
				workspacePath === undefined ? undefined : selection.length > 0 ? workspacePath + '/' + selection[0] : workspacePath

			React.useEffect(() => {
				const remote = safeService('remote')
				const path = targetPath()
				if (!remote || !remote.session || typeof remote.session.workspacePathApplications !== 'function' || path === undefined) {
					setDefaultApp(null)
					return undefined
				}
				let cancelled = false
				Promise.resolve(remote.session.workspacePathApplications({ path }))
					.then((result) => {
						if (cancelled) return
						const apps = result && result.ok === true && Array.isArray(result.value) ? result.value : []
						const chosen = apps.find((entry) => entry && entry.default === true) || apps[0] || null
						setDefaultApp(chosen === null ? null : { name: chosen.name, icon: typeof chosen.icon === 'string' ? chosen.icon : null })
					})
					.catch(() => {
						if (!cancelled) setDefaultApp(null)
					})
				return () => {
					cancelled = true
				}
			}, [selection, workspacePath])

			/** Which file manager this platform ships, and how the platform names it. */
			const platformKind = () => {
				const ua = String((typeof navigator === 'object' && navigator && navigator.userAgent) || '')
				if (/Mac|iPhone|iPad/.test(ua)) return 'finder'
				if (/Win/.test(ua)) return 'explorer'
				return 'generic'
			}

			// The file manager's own icon comes from the shipped application-icon
			// route; a missing icon simply leaves the generic folder glyph.
			React.useEffect(() => {
				const kind = platformKind()
				if (kind === 'generic' || typeof Image !== 'function') {
					setRevealIcon(null)
					return undefined
				}
				const url = 'open-in-app/icon/' + kind
				let cancelled = false
				const probe = new Image()
				probe.onload = () => {
					if (!cancelled) setRevealIcon(url)
				}
				probe.onerror = () => {
					if (!cancelled) setRevealIcon(null)
				}
				probe.src = url
				return () => {
					cancelled = true
					probe.onload = null
					probe.onerror = null
				}
			}, [])

			const revealLabel = () =>
				platformKind() === 'finder' ? t('files.revealFinder') : platformKind() === 'explorer' ? t('files.revealExplorer') : t('files.revealGeneric')

			/**
			 * Hand the path to the platform's file manager so it shows the item in
			 * place, through the same two Host routes the shipped "Open In…" controls
			 * use (catalog read, then launch).
			 */
			const revealPath = () => {
				const path = targetPath()
				if (path === undefined) return
				const preferred = platformKind() === 'finder' ? ['finder'] : platformKind() === 'explorer' ? ['explorer'] : ['filemanager', 'finder', 'explorer']
				Promise.resolve()
					.then(() => fetch('open-in-app/apps', { headers: { accept: 'application/json' } }))
					.then((response) => (response.ok ? response.json() : null))
					.then((payload) => {
						const apps = payload && Array.isArray(payload.apps) ? payload.apps : []
						const manager = preferred.find((id) => apps.indexOf(id) !== -1) || ['finder', 'explorer', 'filemanager'].find((id) => apps.indexOf(id) !== -1)
						if (manager === undefined) throw new Error(t('files.revealGeneric'))
						return fetch('open-in-app/open', {
							method: 'POST',
							headers: { 'content-type': 'application/json' },
							body: JSON.stringify({ app: manager, path })
						})
					})
					.then((response) => {
						if (!response.ok) throw new Error('HTTP ' + String(response.status))
					})
					.catch((error) => setFailure(describe(error)))
			}

			const openDefaultApp = () => {
				const remote = safeService('remote')
				const path = targetPath()
				if (!remote || !remote.session || typeof remote.session.openWorkspacePath !== 'function' || path === undefined) {
					setFailure(t('files.noPath'))
					return
				}
				Promise.resolve(remote.session.openWorkspacePath({ path }))
					.then((result) => {
						if (!result || result.ok !== true) {
							throw new Error(result && result.error && result.error.message ? result.error.message : 'open failed')
						}
					})
					.catch((error) => setFailure(describe(error)))
			}

			/**
			 * Expand the tree breadth-first: every directory within a bounded depth
			 * and count, so a huge project cannot open thousands of folders at once.
			 */
			const expandAll = () => {
				if (workspacePath === undefined) return Promise.resolve()
				const MAX_DIRS = 80
				const MAX_DEPTH = 4
				const found = []
				const queue = [{ path: workspacePath, depth: 0 }]
				let limited = false
				const step = () => {
					if (queue.length === 0) return Promise.resolve()
					if (found.length >= MAX_DIRS) {
						limited = true
						queue.length = 0
						return Promise.resolve()
					}
					const item = queue.shift()
					const known = dirs[item.path]
					const loading = known !== undefined && known.status === 'ready' ? Promise.resolve(known.entries) : listDir(item.path)
					return loading.then((entries) => {
						for (const entry of entries) {
							if (entry.type !== 'directory') continue
							const childPath = item.path + '/' + entry.name
							found.push(childPath)
							if (item.depth + 1 < MAX_DEPTH) queue.push({ path: childPath, depth: item.depth + 1 })
							if (found.length >= MAX_DIRS) {
								limited = true
								break
							}
						}
						return step()
					})
				}
				return step().then(() => {
					setExpanded(found)
					setNotice(limited ? t('files.expandLimited') : null)
				})
			}

			const rows = []
			// Visible files in display order, so Shift can select a range.
			const visibleOrder = []
			const walk = (path, depth, relative) => {
				const node = dirs[path]
				if (node === undefined) {
					rows.push(h('div', { className: 'dsc-empty', key: 'pending:' + path }, t('files.loading')))
					return
				}
				if (node.status === 'loading') {
					rows.push(h('div', { className: 'dsc-empty', key: 'loading:' + path }, t('files.loading')))
					return
				}
				if (node.status === 'error') {
					rows.push(
						h(
							'div',
							{ className: 'dsc-empty', key: 'error:' + path },
							node.message ? t('files.error') + ' — ' + node.message : t('files.error')
						)
					)
					return
				}
				if (node.entries.length === 0) {
					rows.push(h('div', { className: 'dsc-empty', key: 'empty:' + path }, t('files.empty')))
					return
				}
				// Directories first, then files, each in natural name order — the
				// ordering every file tree uses, regardless of the backend's order.
				const ordered = node.entries.slice().sort((left, right) => {
					const leftDir = left.type === 'directory' ? 0 : 1
					const rightDir = right.type === 'directory' ? 0 : 1
					if (leftDir !== rightDir) return leftDir - rightDir
					return String(left.name).localeCompare(String(right.name), undefined, { numeric: true, sensitivity: 'base' })
				})
				for (const entry of ordered) {
					const childPath = path + '/' + entry.name
					const childRelative = relative === '' ? entry.name : relative + '/' + entry.name
					const isDir = entry.type === 'directory'
					const open = isDir && expanded.indexOf(childPath) !== -1
					const picked = isDir ? false : selection.indexOf(childRelative) !== -1
					if (!isDir) visibleOrder.push(childRelative)
					rows.push(
						h(
							'div',
							{
								key: childPath,
								className: 'dsc-row dsc-file-row' + (picked ? ' dsc-selected' : ''),
								style: { '--dsc-depth': String(depth * 10) + 'px' }
							},
							h(
								'button',
								{
									type: 'button',
									className: 'dsc-rowmain',
									onClick: (event) => {
										if (isDir) {
											toggleDir(childPath)
											return
										}
										selectFile(event, childRelative, visibleOrder)
										// A plain click selects and opens; a modifier click only
										// adjusts the selection.
										if (!event.metaKey && !event.ctrlKey && !event.shiftKey) openFile(childRelative)
									}
								},
								isDir
									? h('span', { className: 'dsc-caret' + (open ? ' dsc-caret-open' : '') }, h(Icon, { name: 'chevron', size: 11 }))
									: h('span', { className: 'dsc-filepad' }),
								h(
									'span',
									{ className: 'dsc-folder' + (isDir ? ' dsc-dir' : '') },
									isDir
										? h(Icon, { name: open ? 'folderOpen' : 'folder', size: 13 })
										: h(FileGlyph, { name: entry.name, size: 13 })
								),
								h('span', { className: 'dsc-rowlabel' }, entry.name)
							)
						)
					)
					if (isDir && open) walk(childPath, depth + 1, childRelative)
				}
				if (node.truncated === true) {
					rows.push(h('div', { className: 'dsc-empty', key: 'trunc:' + path }, t('files.truncated')))
				}
			}

			const rootReady = workspacePath !== undefined && dirs[workspacePath] !== undefined && dirs[workspacePath].status === 'ready'
			if (activeSessionId !== undefined && workspacePath !== undefined) walk(workspacePath, 0, '')

			const open = stateNow.filesCollapsed !== true
			return h(
				'div',
				{
					'data-card': 'files',
					className: 'dsc-card dsc-filescard',
					style: open && typeof props.size === 'number' ? { height: String(props.size) + 'px' } : undefined
				},
				h(
					CardHeader,
					{
						title: t('card.files'),
						open,
						count: rootReady ? dirs[workspacePath].entries.length : undefined,
						onToggle: () => setState({ filesCollapsed: open })
					},
					h(IconButton, { name: 'copy', label: t('files.copyFile'), onClick: () => copySelection() }),
					h(IconButton, {
						name: 'more',
						label: t('files.options'),
						onClick: (event) => {
							const rect = event.currentTarget.getBoundingClientRect()
							setNotice(null)
							setMenu({
								x: rect.right - 220,
								y: rect.bottom + 4,
								items: [
									{ label: revealLabel(), iconSrc: revealIcon || undefined, icon: 'folder', onSelect: () => revealPath() },
									// A folder's default application IS this platform's file
									// manager, which the row above already does for that path.
									...(selection.length === 0 && platformKind() !== 'generic'
										? []
										: [
												{
													label: defaultApp ? tf('files.openWithApp', { app: defaultApp.name }) : t('files.openDefault'),
													iconSrc: defaultApp ? defaultApp.icon || undefined : undefined,
													icon: 'openIn',
													onSelect: () => openDefaultApp()
												}
											]),
									{ separator: true },
									{
										label: t('files.copyFiles'),
										icon: 'copy',
										trailing: selection.length > 0 ? String(selection.length) : '',
										onSelect: () => copySelection()
									},
									{ label: t('files.copyPath'), icon: 'folder', onSelect: () => copyFolder() },
									{ separator: true },
									{ label: t('action.expandAll'), icon: 'chevronDown', onSelect: () => expandAll() },
									{ label: t('action.collapseAll'), icon: 'chevronUp', onSelect: () => setExpanded([]) }
								]
							})
						}
					}),
					h(IconButton, { name: 'reload', label: t('files.reload'), onClick: () => setTick((value) => value + 1) })
				),
				open
					? h(
							'div',
							{ className: 'dsc-cardbody dsc-filesbody', 'data-card-body': true },
							activeSessionId === undefined || workspacePath === undefined
								? h('div', { className: 'dsc-empty dsc-empty-block' }, t('files.noSession'))
								: failure !== null
									? h('div', { className: 'dsc-empty dsc-empty-block' }, failure)
									: rows.length > 0
										? rows
										: h('div', { className: 'dsc-empty dsc-empty-block' }, t('files.empty')),
							notice !== null ? h('div', { className: 'dsc-hintline' }, notice) : null
						)
					: null,
				menu ? h(Popover, { x: menu.x, y: menu.y, items: menu.items, onClose: () => setMenu(null) }) : null
			)
		}

		/* ----------------------------------------------------- workspace card */

		function WorkspaceCard(props) {
			const stateNow = useStateTick()
			const wsSnap = useStoreSnapshot(props.workspacesStore) || {}
			const sSnap = useStoreSnapshot(props.sessionsStore) || {}
			const [needle, setNeedle] = React.useState('')
			const [expandHits, setExpandHits] = React.useState(false)
			const [menu, setMenu] = React.useState(null)
			const [dialog, setDialog] = React.useState(null)
			const [error, setError] = React.useState(null)
			const [dragWs, setDragWs] = React.useState(null)
			const [overCat, setOverCat] = React.useState(null)

			const actions = props.actions || {}
			const workspaces = Array.isArray(wsSnap.items) ? wsSnap.items : []
			const lower = needle.trim().toLowerCase()

			/**
			 * The Session the main view is showing. `retainedBy.mainView` is the
			 * same fact the shipped browser uses to mark its open row, so the
			 * highlight follows the real navigation instead of a local guess.
			 */
			const activeSessionId = React.useMemo(() => {
				const byId = sSnap.byId || {}
				for (const id of sSnap.ids || []) {
					const summary = byId[id]
					if (summary && summary.retainedBy && summary.retainedBy.mainView > 0) return id
				}
				return undefined
			}, [sSnap])

			const activeWorkspaceId = React.useMemo(() => {
				if (activeSessionId === undefined) return undefined
				for (const workspace of workspaces) {
					if ((workspace.sessionIds || []).indexOf(activeSessionId) !== -1) return workspace.workspaceId
				}
				return undefined
			}, [activeSessionId, wsSnap])

			const categories = stateNow.categories
			const known = new Set(categories.map((category) => category.id))
			// Filtering is a two-part match, like the shipped browser: a Workspace
			// stays when its own title/path matches, and also when one of its
			// Sessions matches even though the Workspace itself does not.
			const sessionCache = new Map()
			for (const workspace of workspaces) {
				sessionCache.set(workspace.workspaceId, sessionsOf(workspace, wsSnap, sSnap, lower, stateNow.archived))
			}

			const workspaceLabel = (workspace) => workspace.title || baseName(workspace.path) || workspace.workspaceId
			const latestSessionOf = (workspace) => {
				let latest = 0
				const byId = sSnap.byId || {}
				for (const id of workspace.sessionIds || []) {
					const summary = byId[id]
					if (summary === undefined) continue
					const at = timeOf(summary.updatedAt)
					if (at > latest) latest = at
				}
				return latest
			}
			const orderWorkspaces = (list) => {
				const descending = stateNow.workspaceSortDir === 'desc'
				if (stateNow.workspaceSort === 'name') {
					const rows = list
						.slice()
						.sort((left, right) => workspaceLabel(left).localeCompare(workspaceLabel(right), 'zh-Hans-CN', { numeric: true }))
					return descending ? rows.reverse() : rows
				}
				if (stateNow.workspaceSort === 'time') {
					const rows = list.slice().sort((left, right) => latestSessionOf(right) - latestSessionOf(left))
					// Ascending means oldest first, so the default (newest first) is
					// the reversed order.
					return descending ? rows : rows.reverse()
				}
				return list
			}

			const buckets = new Map(categories.map((category) => [category.id, []]))
			const unassigned = []
			for (const workspace of workspaces) {
				if (lower !== '') {
					const ownMatch = matchesWorkspace(workspace, lower)
					const sessionMatch = (sessionCache.get(workspace.workspaceId) || []).length > 0
					if (!ownMatch && !sessionMatch) continue
				}
				const target = stateNow.assign[workspace.workspaceId]
				if (target !== undefined && known.has(target)) buckets.get(target).push(workspace)
				else unassigned.push(workspace)
			}
			for (const [categoryId, list] of buckets) buckets.set(categoryId, orderWorkspaces(list))
			const orderedUnassigned = orderWorkspaces(unassigned)

			// A new query starts folded again; the switch only affects this search.
			React.useEffect(() => {
				setExpandHits(false)
			}, [needle])

			const fail = (reason) => setError(describe(reason))
			const clearError = () => setError(null)

			const assignWorkspace = (workspaceId, categoryId) => {
				const next = Object.assign({}, stateNow.assign)
				if (categoryId === UNASSIGNED) delete next[workspaceId]
				else next[workspaceId] = categoryId
				setState({ assign: next })
			}

			const toggleWorkspace = (workspaceId) => {
				const expanded = Object.assign({}, stateNow.expanded)
				expanded[workspaceId] = !expanded[workspaceId]
				setState({ expanded })
			}

			const expandAll = () => {
				const expanded = {}
				for (const workspace of workspaces) expanded[workspace.workspaceId] = true
				setState({ expanded })
			}

			const showMore = (workspaceId) => {
				const visible = Object.assign({}, stateNow.visible)
				visible[workspaceId] = (visible[workspaceId] === undefined ? SESSION_DEFAULT : visible[workspaceId]) + SESSION_STEP
				setState({ visible })
			}

			const showLess = (workspaceId) => {
				const visible = Object.assign({}, stateNow.visible)
				visible[workspaceId] = SESSION_DEFAULT
				setState({ visible })
			}

			const newCategory = () => {
				setDialog({
					title: t('category.new'),
					placeholder: t('category.namePlaceholder'),
					onSubmit: (name) => {
						setDialog(null)
						if (name === '') return
						setState({ categories: categories.concat([{ id: idOf('cat_'), name, collapsed: false }]) })
					}
				})
			}

			const createWorkspaceFor = (categoryId) => {
				Promise.resolve(actions.createWorkspace ? actions.createWorkspace() : null)
					.then((workspace) => {
						if (!workspace) return
						if (categoryId && categoryId !== UNASSIGNED) assignWorkspace(workspace.workspaceId, categoryId)
					})
					.catch(fail)
			}

			const archive = (sessionId) => {
				Promise.resolve(actions.archiveSession(sessionId))
					.catch((reason) => {
						if (isActiveRefusal(reason)) {
							setDialog({
								title: t('session.runningTitle'),
								message: t('session.runningMessage'),
								confirmOnly: true,
								confirmLabel: t('session.stopArchive'),
								danger: true,
								onSubmit: () => {
									setDialog(null)
									Promise.resolve(actions.archiveSession(sessionId, { stopActivity: true })).catch(fail)
								}
							})
						} else {
							fail(reason)
						}
					})
			}

			const unarchive = (sessionId) => {
				Promise.resolve(actions.unarchiveSession(sessionId)).catch(fail)
			}

			const copy = (text) => {
				try {
					Promise.resolve(navigator.clipboard.writeText(text)).catch(fail)
				} catch (reason) {
					fail(reason)
				}
			}

			/** Ask the shared context menu to open the native Workspace menu. */
			const nativeWorkspaceMenu = (event, workspace, mode) => {
				const rect = event.currentTarget ? event.currentTarget.getBoundingClientRect() : null
				const point =
					event.clientX !== undefined && event.type === 'contextmenu'
						? { x: event.clientX, y: event.clientY }
						: { x: rect ? rect.left : 0, y: rect ? rect.bottom + 2 : 0 }
				const opened = actions.openWorkspaceMenu
					? actions.openWorkspaceMenu(workspace, point, mode)
					: false
				return opened === true
			}

			const workspaceMenu = (event, workspace, mode) => {
				if (nativeWorkspaceMenu(event, workspace, mode)) return
				const rect = event.currentTarget.getBoundingClientRect()
				const items = [
					{
						label: t('workspace.newSession'),
						icon: 'plus',
						onSelect: () => {
							if (actions.startSession) actions.startSession(workspace.workspaceId)
						}
					},
					{
						label: t('workspace.rename'),
						icon: 'pencil',
						onSelect: () =>
							setDialog({
								title: t('workspace.rename'),
								initialValue: workspaceLabel(workspace),
								onSubmit: (name) => {
									setDialog(null)
									if (name === '') return
									Promise.resolve(actions.renameWorkspace(workspace.workspaceId, name)).catch(fail)
								}
							})
					},
					{ label: t('workspace.copyPath'), onSelect: () => copy(workspace.path) },
					{ separator: true }
				]
				if (categories.length > 0) {
					items.push({ header: true, label: t('workspace.moveTo') })
					for (const category of categories) {
						items.push({
							label: (stateNow.assign[workspace.workspaceId] === category.id ? '✓ ' : '') + (category.name || t('category.untitled')),
							onSelect: () => assignWorkspace(workspace.workspaceId, category.id)
						})
					}
					if (stateNow.assign[workspace.workspaceId] !== undefined) {
						items.push({ label: t('workspace.moveOut'), onSelect: () => assignWorkspace(workspace.workspaceId, UNASSIGNED) })
					}
					items.push({ separator: true })
				}
				items.push({
					label: t('workspace.delete'),
					danger: true,
					icon: 'trash',
					onSelect: () =>
						setDialog({
							title: t('workspace.delete'),
							message: t('workspace.deleteMessage'),
							confirmOnly: true,
							danger: true,
							confirmLabel: t('action.delete'),
							onSubmit: () => {
								setDialog(null)
								Promise.resolve(actions.deleteWorkspace(workspace.workspaceId)).catch(fail)
							}
						})
				})
				setMenu({ x: rect.right - 180, y: rect.bottom + 4, items })
			}

			const nativeSessionMenu = (event, session, mode) => {
				const rect = event.currentTarget ? event.currentTarget.getBoundingClientRect() : null
				const point =
					event.clientX !== undefined && event.type === 'contextmenu'
						? { x: event.clientX, y: event.clientY }
						: { x: rect ? rect.left : 0, y: rect ? rect.bottom + 2 : 0 }
				const opened = actions.openSessionMenu
					? actions.openSessionMenu(session.id, session.displayTitle || session.title || t('session.untitled'), point, mode)
					: false
				return opened === true
			}

			const sessionMenu = (event, session, mode) => {
				if (nativeSessionMenu(event, session, mode)) return
				const rect = event.currentTarget.getBoundingClientRect()
				const pinned = (wsSnap.pinnedSessionIds || []).indexOf(session.id) !== -1
				const items = [
					{
						label: t('session.rename'),
						icon: 'pencil',
						onSelect: () =>
							setDialog({
								title: t('session.rename'),
								initialValue: session.displayTitle || session.title || '',
								onSubmit: (name) => {
									setDialog(null)
									if (name === '') return
									Promise.resolve(actions.renameSession(session.id, name)).catch(fail)
								}
							})
					},
					{
						label: pinned ? t('session.unpin') : t('session.pin'),
						icon: 'pin',
						onSelect: () => {
							const call = pinned ? actions.unpinSession : actions.pinSession
							if (!call) return
							Promise.resolve(call(session.id)).catch(fail)
						}
					},
					{
						label: t('session.fork'),
						icon: 'branch',
						onSelect: () => {
							try {
								Promise.resolve(actions.forkSession ? actions.forkSession(session.id) : null).catch(fail)
							} catch (reason) {
								fail(reason)
							}
						}
					},
					{ label: t('session.copyId'), onSelect: () => copy(session.id) },
					{ separator: true }
				]
				if (session.archived) {
					items.push({ label: t('session.unarchive'), icon: 'unarchive', onSelect: () => unarchive(session.id) })
				} else {
					items.push({ label: t('session.archive'), icon: 'archive', onSelect: () => archive(session.id) })
				}
				setMenu({ x: rect.right - 180, y: rect.bottom + 4, items })
			}

			/** running / warning / done for one row, or undefined when idle. */
			const statusOf = (session) => {
				const status = props.statuses && typeof props.statuses.get === 'function' ? props.statuses.get(session.id) : undefined
				if (status) {
					if (status.pendingInteraction !== undefined) return 'warning'
					if (status.running === true) return 'ongoing'
					if (status.completionUnread === true) return 'done'
					return undefined
				}
				return session.running === true ? 'ongoing' : undefined
			}

			const renderSession = (workspace, session) => {
				const statusDot = statusOf(session)
				return h(
					'div',
					{
						key: session.id,
						className:
							'dsc-row dsc-session-row' +
							(session.archived ? ' dsc-archived' : '') +
							(session.id === activeSessionId ? ' dsc-selected' : ''),
						'data-status': statusOf(session) || '',
						onContextMenu: (event) => {
							event.preventDefault()
							sessionMenu(event, session, 'open')
						}
					},
					h(
						'button',
						{
							type: 'button',
							className: 'dsc-rowmain',
							onClick: () => {
								if (actions.openSession) actions.openSession(session.id)
							}
						},
						statusDot ? (StateDot ? h(StateDot, { state: statusDot }) : h('span', { className: 'dsc-dot dsc-dot-' + statusDot })) : null,
						h('span', { className: 'dsc-rowlabel' }, session.displayTitle || session.title || t('session.untitled'))
					),
					h(
						'span',
						{ className: 'dsc-rowacts' },
						h(IconButton, { name: 'more', label: t('session.more'), onClick: (event) => sessionMenu(event, session, 'toggle') })
					)
				)
			}

			const renderWorkspace = (workspace, indent) => {
				const searching = lower !== ''
				const sessions = sessionCache.get(workspace.workspaceId) || []
				// Filtering never rearranges the tree on its own: the user's fold
				// state stays as it was unless the "expand all hits" switch is on.
				const expanded = stateNow.expanded[workspace.workspaceId] === true || (searching && expandHits)
				const limit = searching
					? sessions.length
					: stateNow.visible[workspace.workspaceId] === undefined
						? SESSION_DEFAULT
						: stateNow.visible[workspace.workspaceId]
				const shown = sessions.slice(0, limit)
				return h(
					'div',
					{ className: 'dsc-group', key: workspace.workspaceId },
					h(
						'div',
						{
							className: 'dsc-row dsc-ws-row' + (workspace.workspaceId === activeWorkspaceId ? ' dsc-ws-active' : ''),
							style: { '--dsc-indent': indent + 'px' },
							draggable: true,
							onDragStart: (event) => {
								event.dataTransfer.setData('text/plain', 'ws:' + workspace.workspaceId)
								event.dataTransfer.effectAllowed = 'move'
								setDragWs(workspace.workspaceId)
							},
							onDragEnd: () => setDragWs(null),
							onDoubleClick: () => {
								if (actions.startSession) actions.startSession(workspace.workspaceId)
							},
							onContextMenu: (event) => {
								event.preventDefault()
								workspaceMenu(event, workspace, 'open')
							}
						},
						h(
							'button',
							{
								type: 'button',
								className: 'dsc-rowmain',
								onClick: () => toggleWorkspace(workspace.workspaceId)
							},
							h('span', { className: 'dsc-caret' + (expanded ? ' dsc-caret-open' : '') }, h(Icon, { name: 'chevron', size: 12 })),
							h('span', { className: 'dsc-folder' }, h(Icon, { name: expanded ? 'folderOpen' : 'folder', size: 13 })),
							h('span', { className: 'dsc-rowlabel dsc-strong' }, workspaceLabel(workspace))
						),
						h(CountBadge, {
							count: lower !== '' ? (sessionCache.get(workspace.workspaceId) || []).length : (workspace.sessionIds || []).length
						}),
						h(
							'span',
							{ className: 'dsc-rowacts' },
							h(IconButton, {
								name: 'plus',
								label: t('workspace.newSession'),
								onClick: () => {
									if (actions.startSession) actions.startSession(workspace.workspaceId)
								}
							}),
							h(IconButton, { name: 'more', label: t('workspace.more'), onClick: (event) => workspaceMenu(event, workspace, 'toggle') })
						)
					),
					expanded
						? h(
								'div',
								{ className: 'dsc-group-body' },
								shown.map((session) => renderSession(workspace, session)),
								sessions.length === 0 ? h('div', { className: 'dsc-empty' }, lower === '' ? t('session.empty') : t('session.noMatch')) : null,
								sessions.length > limit
									? h(
											'button',
											{ type: 'button', className: 'dsc-morebtn', onClick: () => showMore(workspace.workspaceId) },
											h(Icon, { name: 'chevronDown', size: 12 }),
											h('span', null, t('session.showMore'))
										)
									: limit > SESSION_DEFAULT && sessions.length > 0
										? h(
												'button',
												{ type: 'button', className: 'dsc-morebtn', onClick: () => showLess(workspace.workspaceId) },
												h(Icon, { name: 'chevronUp', size: 12 }),
												h('span', null, t('session.showLess'))
											)
										: null
							)
						: null
				)
			}

			const renderCategory = (category) =>
				h(
					'div',
					{
						className: 'dsc-group' + (overCat === category.id ? ' dsc-drop' : ''),
						key: category.id,
						onDragOver: (event) => {
							if (dragWs === null) return
							event.preventDefault()
							setOverCat(category.id)
						},
						onDragLeave: () => setOverCat((current) => (current === category.id ? null : current)),
						onDrop: (event) => {
							event.preventDefault()
							const raw = event.dataTransfer.getData('text/plain')
							setOverCat(null)
							setDragWs(null)
							if (raw.startsWith('ws:')) assignWorkspace(raw.slice(3), category.id)
						}
					},
					h(
						'div',
						{ className: 'dsc-row dsc-cat-row' },
						h(
							'button',
							{
								type: 'button',
								className: 'dsc-rowmain',
								onClick: () => {
									const next = categories.map((entry) =>
										entry.id === category.id ? Object.assign({}, entry, { collapsed: !entry.collapsed }) : entry
									)
									setState({ categories: next })
								}
							},
							h(
								'span',
								{ className: 'dsc-caret' + (category.collapsed && !(lower !== '' && expandHits) ? '' : ' dsc-caret-open') },
								h(Icon, { name: 'chevron', size: 12 })
							),
							h('span', { className: 'dsc-rowlabel dsc-catlabel' }, category.name || t('category.untitled'))
						),
						h(CountBadge, { count: (buckets.get(category.id) || []).length }),
						h(
							'span',
							{ className: 'dsc-rowacts' },
							h(IconButton, { name: 'plus', label: t('category.newWorkspace'), onClick: () => createWorkspaceFor(category.id) }),
							h(IconButton, {
								name: 'pencil',
								label: t('category.rename'),
								onClick: () =>
									setDialog({
										title: t('category.rename'),
										initialValue: category.name,
										onSubmit: (name) => {
											setDialog(null)
											if (name === '') return
											setState({
												categories: categories.map((entry) =>
													entry.id === category.id ? Object.assign({}, entry, { name }) : entry
												)
											})
										}
									})
							}),
							h(IconButton, {
								name: 'trash',
								label: t('category.delete'),
								onClick: () =>
									setDialog({
										title: t('category.delete'),
										message: t('category.deleteMessage'),
										confirmOnly: true,
										danger: true,
										confirmLabel: t('category.delete'),
										onSubmit: () => {
											setDialog(null)
											const nextAssign = Object.assign({}, stateNow.assign)
											for (const key of Object.keys(nextAssign)) {
												if (nextAssign[key] === category.id) delete nextAssign[key]
											}
											setState({
												categories: categories.filter((entry) => entry.id !== category.id),
												assign: nextAssign
											})
										}
									})
							})
						)
					),
					category.collapsed && !(lower !== '' && expandHits)
						? null
						: h(
								'div',
								{ className: 'dsc-group-body' },
								(buckets.get(category.id) || []).map((workspace) => renderWorkspace(workspace, 12)),
								(buckets.get(category.id) || []).length === 0
									? h('div', { className: 'dsc-empty' }, t('workspace.dropHint'))
									: null
							)
				)

			const open = stateNow.workspaceCollapsed !== true

			return h(
				'div',
				{
					'data-card': 'workspace',
					className: 'dsc-card dsc-wscard' + (open ? '' : ' dsc-wscard-collapsed'),
					style: open && typeof props.size === 'number' ? { height: String(props.size) + 'px' } : undefined
				},
				h(
					CardHeader,
					{
						title: t('card.workspaces'),
						open,
						count: workspaces.length,
						onToggle: () => setState({ workspaceCollapsed: open })
					},
					h(IconButton, {
						name: 'sliders',
						label: t('options.title'),
						onClick: (event) => {
							const rect = event.currentTarget.getBoundingClientRect()
							const check = (key) => (stateNow.archived === key ? '✓' : '')
							setMenu({
								x: rect.right - 190,
								y: rect.bottom + 4,
								items: [
									{ header: true, label: t('options.archivedHeader') },
									{ label: t('options.archivedDefault'), trailing: check('default'), onSelect: () => setState({ archived: 'default' }) },
									{ label: t('options.archivedShow'), trailing: check('show'), onSelect: () => setState({ archived: 'show' }) },
									{ label: t('options.archivedOnly'), trailing: check('only'), onSelect: () => setState({ archived: 'only' }) },
									{ separator: true },
									{ header: true, label: t('options.sortHeader') },
									{
										label: t('options.sortManual'),
										trailing: stateNow.workspaceSort === 'manual' ? '✓' : '',
										onSelect: () => setState({ workspaceSort: 'manual' })
									},
									{
										// Re-clicking the active mode flips its direction: one row
										// per mode, not a second set of direction rows.
										label: t('options.sortName'),
										trailing:
											stateNow.workspaceSort !== 'name'
												? ''
												: stateNow.workspaceSortDir === 'desc'
													? '↓'
													: '↑',
										onSelect: () =>
											setState(
												stateNow.workspaceSort === 'name'
													? { workspaceSortDir: stateNow.workspaceSortDir === 'desc' ? 'asc' : 'desc' }
													: { workspaceSort: 'name', workspaceSortDir: 'asc' }
											)
									},
									{
										label: t('options.sortTime'),
										trailing:
											stateNow.workspaceSort !== 'time'
												? ''
												: stateNow.workspaceSortDir === 'asc'
													? '↑'
													: '↓',
										onSelect: () =>
											setState(
												stateNow.workspaceSort === 'time'
													? { workspaceSortDir: stateNow.workspaceSortDir === 'desc' ? 'asc' : 'desc' }
													: { workspaceSort: 'time', workspaceSortDir: 'desc' }
											)
									},
									{ separator: true },
									{ label: t('action.expandAll'), onSelect: () => expandAll() },
									{ label: t('action.collapseAll'), onSelect: () => setState({ expanded: {} }) },
									{ separator: true },
									{
										label: t('options.language'),
										trailing: currentLangLabel(),
										submenu: [
											{
												label: t('options.langAuto'),
												trailing: LANGS.some((entry) => entry.code === stateNow.lang) ? '' : '✓',
												onSelect: () => setState({ lang: 'auto' })
											},
											...LANGS.map((entry) => ({
												key: entry.code,
												label: entry.label,
												trailing: stateNow.lang === entry.code ? '✓' : '',
												onSelect: () => setState({ lang: entry.code })
											}))
										]
									}
								]
							})
						}
					}),
					h(IconButton, {
						name: 'plus',
						label: t('options.newHeader'),
						onClick: (event) => {
							const rect = event.currentTarget.getBoundingClientRect()
							setMenu({
								x: rect.right - 168,
								y: rect.bottom + 4,
								items: [
									{ label: t('options.newGroup'), icon: 'layers', onSelect: newCategory },
									{ label: t('options.newWorkspace'), icon: 'folder', onSelect: () => createWorkspaceFor(null) }
								]
							})
						}
					})
				),
				open
					? h(
							'div',
							{ className: 'dsc-cardbody' },
							h(
								'div',
								{ className: 'dsc-search' },
								h(Icon, { name: 'search', size: 12 }),
								h('input', {
									className: 'dsc-searchinput',
									value: needle,
									placeholder: t('search.placeholder'),
									onChange: (event) => setNeedle(event.target.value)
								}),
								needle.trim() === ''
									? null
									: h(IconButton, {
											name: 'expand',
											label: expandHits ? t('search.collapseHits') : t('search.expandHits'),
											active: expandHits,
											onClick: () => setExpandHits(!expandHits)
										})
							),
							error
								? h(
										'div',
										{ className: 'dsc-error' },
										h('span', null, error),
										h(IconButton, { name: 'close', label: t('action.close'), onClick: clearError })
									)
								: null,
							categories.map(renderCategory),
							unassigned.length > 0 || categories.length === 0
								? h(
								'div',
								{
									className: 'dsc-group' + (overCat === UNASSIGNED ? ' dsc-drop' : ''),
									onDragOver: (event) => {
										if (dragWs === null) return
										event.preventDefault()
										setOverCat(UNASSIGNED)
									},
									onDragLeave: () => setOverCat((current) => (current === UNASSIGNED ? null : current)),
									onDrop: (event) => {
										event.preventDefault()
										const raw = event.dataTransfer.getData('text/plain')
										setOverCat(null)
										setDragWs(null)
										if (raw.startsWith('ws:')) assignWorkspace(raw.slice(3), UNASSIGNED)
									}
								},
								h(
									'div',
									{ className: 'dsc-row dsc-cat-row dsc-group-ghost' },
									h(
										'span',
										{ className: 'dsc-rowmain' },
										h('span', { className: 'dsc-rowlabel dsc-catlabel' }, t('card.unassigned'))
									),
									h(CountBadge, { count: orderedUnassigned.length })
								),
								h('div', { className: 'dsc-group-body' }, orderedUnassigned.map((workspace) => renderWorkspace(workspace, 0)))
							)
								: null,
							workspaces.length === 0
								? h('div', { className: 'dsc-empty dsc-empty-block' }, t('workspace.empty'))
								: null
						)
					: null,
				menu ? h(Popover, { x: menu.x, y: menu.y, items: menu.items, onClose: () => setMenu(null) }) : null,
				dialog
					? h(Dialog, {
							title: dialog.title,
							placeholder: dialog.placeholder,
							initialValue: dialog.initialValue,
							message: dialog.message,
							confirmOnly: dialog.confirmOnly,
							danger: dialog.danger,
							confirmLabel: dialog.confirmLabel,
							onCancel: () => setDialog(null),
							onSubmit: dialog.onSubmit
						})
					: null
			)
		}

		/* ------------------------------------------------------------- derive */

		function sessionsOf(workspace, wsSnap, sSnap, needle, archivedMode) {
			const archived = new Set(wsSnap.archivedSessionIds || [])
			const pinned = new Set(wsSnap.pinnedSessionIds || [])
			const byId = sSnap.byId || {}
			const rows = []
			for (const id of workspace.sessionIds || []) {
				const summary = byId[id]
				if (summary === undefined) continue
				const isArchived = archived.has(id)
				if (archivedMode === 'default' && isArchived) continue
				if (archivedMode === 'only' && !isArchived) continue
				if (summary.parentId !== undefined || summary.origin === 'subagent') continue
				if (needle !== '' && !matchesSession(summary, needle)) continue
				rows.push(Object.assign({}, summary, { archived: isArchived }))
			}
			rows.sort((left, right) => {
				const pl = pinned.has(left.id) ? 0 : 1
				const pr = pinned.has(right.id) ? 0 : 1
				if (pl !== pr) return pl - pr
				return timeOf(right.updatedAt) - timeOf(left.updatedAt)
			})
			return rows
		}

		function matchesSession(summary, needle) {
			const haystack = [summary.displayTitle, summary.title, summary.cwd, summary.id]
				.filter((value) => typeof value === 'string')
				.join('\u0000')
				.toLowerCase()
			return haystack.includes(needle)
		}

		function matchesWorkspace(workspace, needle) {
			const haystack = [workspace.title, workspace.path, workspace.workspaceId]
				.filter((value) => typeof value === 'string')
				.join('\u0000')
				.toLowerCase()
			return haystack.includes(needle)
		}

		/* --------------------------------------------------------------- root */

		function safeService(name) {
			try {
				return ctxRef && typeof ctxRef.get === 'function' ? ctxRef.get(name) : undefined
			} catch {
				return undefined
			}
		}

		/* ---------------------------------------------------------- layout */

		const CARD_ORDER = ['workspaces', 'plugins', 'files']
		const CARD_MIN = { workspaces: 120, plugins: 72, files: 96 }
		const CARD_HEADER_PX = 28
		const SPLITTER_PX = 8
		const MAX_EXPAND_PX = 200

		function Root(props) {
			const stateNow = useStateTick()
			const wide = props.wide !== false
			const activePanelId =
				typeof props.usePanelInfo === 'function'
					? props.usePanelInfo((info) => (info ? info.activePanelId : undefined))
					: undefined
			const statuses = typeof props.useSessionStatus === 'function' ? props.useSessionStatus((map) => map) : undefined

			React.useEffect(() => {
				const root = document.documentElement
				if (stateNow.mode === 'cards' && wide) root.classList.add(HTML_CLASS)
				else root.classList.remove(HTML_CLASS)
				return () => root.classList.remove(HTML_CLASS)
			}, [stateNow.mode, wide])

			const rootRef = React.useRef(null)
			const [columnHeight, setColumnHeight] = React.useState(0)
			React.useEffect(() => {
				const element = rootRef.current
				if (element === null) return undefined
				const measure = () => setColumnHeight(element.clientHeight)
				measure()
				const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
				if (observer !== null) observer.observe(element)
				window.addEventListener('resize', measure)
				return () => {
					if (observer !== null) observer.disconnect()
					window.removeEventListener('resize', measure)
				}
			}, [])

			// What each expanded card needs to show its rows: measured after every
			// render, capped at 200px. This is a FLOOR, never a target.
			const [contentMins, setContentMins] = React.useState({
				workspaces: CARD_MIN.workspaces,
				plugins: CARD_MIN.plugins,
				files: CARD_MIN.files
			})
			React.useEffect(() => {
				const root = rootRef.current
				if (root === null) return
				const next = Object.assign({}, contentMins)
				let changed = false
				for (const key of CARD_ORDER) {
					const body = root.querySelector('[data-card="' + key + '"] [data-card-body]')
					// Sum the children instead of reading scrollHeight: a card dragged
					// taller than its content reports scrollHeight = clientHeight, which
					// would ratchet the floor up to the cap and stop the card shrinking.
					let content = 0
					if (body !== null) {
						for (const child of Array.from(body.children)) content += child.getBoundingClientRect().height
						content += 4
					}
					const wanted =
						body === null ? CARD_MIN[key] : Math.max(CARD_MIN[key], Math.min(MAX_EXPAND_PX, CARD_HEADER_PX + content))
					if (Math.abs(wanted - (contentMins[key] || 0)) > 1) {
						next[key] = wanted
						changed = true
					}
				}
				if (changed) setContentMins(next)
			})

			const floorOf = (key) => Math.max(CARD_MIN[key], contentMins[key] === undefined ? CARD_MIN[key] : contentMins[key])

			const collapsed = {
				workspaces: stateNow.workspaceCollapsed === true,
				plugins: stateNow.pluginCollapsed === true,
				files: stateNow.filesCollapsed === true
			}
			const expanded = CARD_ORDER.filter((key) => !collapsed[key])
			const splitterShown = (index) => !(collapsed[CARD_ORDER[index]] && collapsed[CARD_ORDER[index + 1]])
			const splitters = CARD_ORDER.slice(0, 2).filter((_key, index) => splitterShown(index)).length
			const collapsedCount = CARD_ORDER.length - expanded.length
			const measured = columnHeight > 0
			const available = Math.max(0, columnHeight - 4 - collapsedCount * CARD_HEADER_PX - splitters * SPLITTER_PX)

			/**
			 * Heights come from the user's own numbers (`panelPins`) over the measured
			 * floors. A card with no number is "automatic": the Workspaces card takes
			 * the rest of the column, the others take exactly their floor. Nothing is
			 * normalized, so a panel the user sized stays that size.
			 */
			const sizes = {}
			if (measured) {
				let used = 0
				for (const key of expanded) {
					const stored = stateNow.panelPins[key]
					if (typeof stored === 'number' && stored > 0) {
						sizes[key] = Math.max(floorOf(key), Math.round(stored))
						used += sizes[key]
					}
				}
				for (const key of expanded) {
					if (sizes[key] !== undefined) continue
					if (key === 'workspaces') continue
					sizes[key] = floorOf(key)
					used += sizes[key]
				}
				if (expanded.indexOf('workspaces') !== -1 && sizes.workspaces === undefined) {
					sizes.workspaces = Math.max(floorOf('workspaces'), available - used)
					used += sizes.workspaces
				}
				// Spare height goes to the LAST expanded card that the user has not
				// pinned, so the column never ends in dead space and that card can grow
				// all the way down. A pinned layout keeps the user's numbers as-is.
				let spare = available - used
				if (spare > 0.5) {
					// Prefer the last card the user has not pinned; if every card is
					// pinned, the last one still takes the remainder, so the column can
					// never end in locked empty space.
					let target
					for (let index = expanded.length - 1; index >= 0; index -= 1) {
						const key = expanded[index]
						const pinned = typeof stateNow.panelPins[key] === 'number' && stateNow.panelPins[key] > 0
						if (!pinned) {
							target = key
							break
						}
					}
					if (target === undefined && expanded.length > 0) target = expanded[expanded.length - 1]
					if (target !== undefined) {
						sizes[target] = (sizes[target] === undefined ? floorOf(target) : sizes[target]) + spare
						spare = 0
					}
				}
				// Too much demanded for this column: trim the largest first.
				let excess = used - available
				if (excess > 0.5) {
					for (let pass = 0; pass < 6 && excess > 0.5; pass += 1) {
						const order = CARD_ORDER.filter((key) => sizes[key] !== undefined).sort((left, right) => sizes[right] - sizes[left])
						let progressed = false
						for (const key of order) {
							const room = sizes[key] - CARD_MIN[key]
							if (room <= 0.5) continue
							const cut = Math.min(room, excess)
							sizes[key] -= cut
							excess -= cut
							progressed = true
							if (excess <= 0.5) break
						}
						if (!progressed) break
					}
				}
			}
			const sizesRef = React.useRef(sizes)
			sizesRef.current = sizes

			const cardHeight = (key) => (collapsed[key] || !measured || sizes[key] === undefined ? undefined : sizes[key])

			const setOne = (key, value) => {
				const next = Object.assign({}, getState().panelPins)
				next[key] = value
				setState({ panelPins: next })
			}

			const dragStartRef = React.useRef(null)

			/** Move the divider at `index` by `delta`: the two cards share the change. */
			const dragSplitter = (index, delta) => {
				const above = CARD_ORDER[index]
				const below = CARD_ORDER[index + 1]
				const aboveOpen = !collapsed[above]
				const belowOpen = !collapsed[below]
				if (!aboveOpen && !belowOpen) return
				// Drag from the sizes captured when the gesture started: pointer moves
				// arrive faster than React re-renders, and a per-move delta would be
				// measured against a stale height.
				if (dragStartRef.current === null || dragStartRef.current.index !== index) {
					dragStartRef.current = { index, sizes: Object.assign({}, sizesRef.current) }
				}
				const current = dragStartRef.current.sizes
				const aboveNow = current[above] || 0
				const belowNow = current[below] || 0
				const next = Object.assign({}, getState().panelPins)
				if (aboveOpen && belowOpen) {
					const total = aboveNow + belowNow
					const top = Math.min(total - floorOf(below), Math.max(floorOf(above), aboveNow + delta))
					if (Math.abs(top - aboveNow) < 0.5) return
					next[above] = Math.round(top)
					next[below] = Math.round(total - top)
				} else if (aboveOpen) {
					const top = Math.max(floorOf(above), aboveNow + delta)
					if (Math.abs(top - aboveNow) < 0.5) return
					next[above] = Math.round(top)
				} else {
					const bottom = Math.max(floorOf(below), belowNow - delta)
					if (Math.abs(bottom - belowNow) < 0.5) return
					next[below] = Math.round(bottom)
				}
				setState({ panelPins: next })
			}

			/** Double click on a divider: every card goes back to automatic. */
			const resetSizes = () => setState({ panelPins: { workspaces: null, plugins: null, files: null } })

			const cards = h(
				'div',
				{ className: 'dsc-root', 'data-sidebar-cards': 'cards', ref: rootRef },
				h(WorkspaceCard, {
					workspacesStore: props.workspacesStore,
					sessionsStore: props.sessionsStore,
					statuses,
					actions: props.actions,
					size: cardHeight('workspaces')
				}),
				h(Splitter, {
					hidden: !splitterShown(0),
					onStart: () => {
						dragStartRef.current = null
					},
					onDrag: (delta) => dragSplitter(0, delta),
					onEnd: () => {
						dragStartRef.current = null
					},
					onReset: resetSizes
				}),
				h(PluginCard, {
					pluginEntriesStore: props.pluginEntriesStore,
					activePanelId,
					size: cardHeight('plugins')
				}),
				h(Splitter, {
					hidden: !splitterShown(1),
					onStart: () => {
						dragStartRef.current = null
					},
					onDrag: (delta) => dragSplitter(1, delta),
					onEnd: () => {
						dragStartRef.current = null
					},
					onReset: resetSizes
				}),
				h(FilesCard, {
					workspacesStore: props.workspacesStore,
					sessionsStore: props.sessionsStore,
					size: cardHeight('files')
				})
			)
			return cards
		}

		/* -------------------------------------------------------- plugin body */

		/** Entry list published to the card, refreshed from the live slots. */
		function createPluginEntriesStore() {
			let snapshot = { panels: [], footers: [], rev: 0 }
			const listeners = new Set()
			return {
				getSnapshot() {
					return snapshot
				},
				subscribe(listener) {
					listeners.add(listener)
					return () => listeners.delete(listener)
				},
				set(next) {
					snapshot = next
					for (const listener of listeners) {
						try {
							listener()
						} catch {
							/* ignore */
						}
					}
				}
			}
		}

		function readSlotEntries(slot) {
			const slots = ctxRef && ctxRef.slots
			if (!slots || typeof slots.entriesOfSlot !== 'function') return []
			let raw = []
			try {
				raw = slots.entriesOfSlot(slot) || []
			} catch {
				return []
			}
			const rows = raw
				.map((entry, index) => {
					const options = (entry && entry.options) || {}
					const id = typeof options.id === 'string' ? options.id : ''
					if (id === '') return null
					return {
						id,
						index,
						order: typeof options.order === 'number' ? options.order : 0,
						label: labelOf(options, shortName(options.name || id))
					}
				})
				.filter((row) => row !== null)
			rows.sort((left, right) => left.order - right.order || left.index - right.index)
			return rows.map((row) => ({ id: row.id, label: row.label }))
		}

		/* --------------------------------------------------------------- css */

		const CSS = `
/* A sectioned sidebar, not an app shell: no card boxes, no fills, no handles.
   Rows are the shipped row grammar (24px, 13px label, 6% hover tint); the only
   chrome is a hairline between the two sections. */
.dsc-root{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;height:100%;overflow:hidden;padding:0 0 4px;color:var(--dsw-alias-label-primary)}
.dsc-root *{box-sizing:border-box}
.dsc-card{display:grid;grid-template-rows:28px minmax(0,1fr);min-height:0;flex:none}
.dsc-wscard{flex:0 0 auto;min-height:0;overflow:hidden}
.dsc-plugincard{flex:0 0 auto;min-height:0;overflow:hidden}
.dsc-filescard{flex:0 0 auto;min-height:0;overflow:hidden}
.dsc-wscard.dsc-wscard-collapsed{flex:0 0 auto}
.dsc-cardhead{display:flex;align-items:center;gap:2px;height:28px;padding:0 6px;flex:none;position:relative;background:color-mix(in srgb,var(--dsw-alias-label-primary) 3%,var(--dsw-specific-sidebar-fill,var(--dsw-alias-bg-base)))}
.dsc-cardtoggle{display:flex;align-items:center;gap:5px;flex:1 1 auto;min-width:0;height:26px;padding:0 4px;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:11.5px;font-weight:600;cursor:pointer}
/* Hover brightens the label and deepens the whole band. The toggle never
   paints its own rounded fill — that made one header look like a different
   component from the other two. */
.dsc-cardtoggle:hover{color:var(--dsw-alias-label-secondary)}
.dsc-cardhead:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 5%,var(--dsw-specific-sidebar-fill,var(--dsw-alias-bg-base)))}
.dsc-cardtitle{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left}
.dsc-headcount{flex:none;min-width:16px;text-align:right;font-size:11px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;padding-right:2px;transition:opacity .1s ease}
/* Same grammar as a content row: the count while idle, the actions on hover. */
.dsc-cardacts{position:absolute;right:6px;top:50%;transform:translateY(-50%);display:flex;align-items:center;gap:1px;opacity:0;pointer-events:none;transition:opacity .12s ease;border-radius:5px;padding-left:4px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 5%,var(--dsw-specific-sidebar-fill,var(--dsw-alias-bg-base)))}
.dsc-cardhead:hover .dsc-cardacts,.dsc-cardhead:focus-within .dsc-cardacts{opacity:1;pointer-events:auto}
.dsc-cardhead:hover .dsc-headcount,.dsc-cardhead:focus-within .dsc-headcount{opacity:0}
.dsc-cardbody{display:flex;flex-direction:column;min-height:0;overflow:auto;padding:0 4px 4px}
/* Row 1 is the header, row 2 the body: the body always fills exactly what the
   card's height leaves, pinned or automatic. */
/* Row-resize handle between cards: invisible until pointed at. */
.dsc-splitter{flex:none;height:8px;margin:0;position:relative;z-index:3;cursor:row-resize;touch-action:none}
.dsc-splitter::after{content:'';position:absolute;left:10px;right:10px;top:3px;height:1px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent);transition:background .12s ease}
.dsc-splitter:hover::after,.dsc-splitter:focus-visible::after{background:color-mix(in srgb,var(--dsw-alias-label-primary) 26%,transparent)}
.dsc-splitter-hidden{display:none}
.dsc-filesbody{flex:1 1 auto;min-height:0;overflow-x:hidden}
/* With the Workspaces card folded, the empty column belongs to the file tree
   rather than to a dead gap under the cards. */

.dsc-hintline{padding:2px 10px 4px;font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:left;min-width:0}
.dsc-file-row .dsc-rowmain{padding-left:var(--dsc-depth,0px)}
.dsc-file-row .dsc-rowlabel{font-size:12.5px;color:var(--dsw-alias-label-secondary)}
/* Folders carry a warm tone in both themes, so a tree reads as folders + files
   instead of one grey column. */
.dsc-file-row .dsc-folder.dsc-dir{color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 78%,var(--dsw-alias-label-tertiary))}
.dsc-filepad{display:inline-block;width:14px;flex:none}
.dsc-pluginbody{flex:1 1 auto;min-height:0}
.dsc-row{display:flex;align-items:center;gap:2px;min-height:26px;border-radius:5px;padding:0 6px;position:relative}
.dsc-row:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent)}
.dsc-rowmain{display:flex;align-items:center;gap:5px;flex:1 1 auto;min-width:0;height:26px;padding:0;border:0;background:transparent;color:inherit;font:inherit;font-size:13px;text-align:left;cursor:pointer}
.dsc-rowmain-static{cursor:default}
.dsc-rowlabel{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;color:var(--dsw-alias-label-secondary)}
.dsc-strong{color:var(--dsw-alias-label-primary)}
.dsc-catlabel{font-size:12px;font-weight:600}
.dsc-caret{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;flex:none;color:var(--dsw-alias-label-tertiary);transition:transform .12s ease}
.dsc-caret-open{transform:rotate(90deg)}
.dsc-countcell{flex:none;min-width:20px;text-align:right;font-size:11px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;transition:opacity .1s ease}
.dsc-row:hover .dsc-countcell,.dsc-row:focus-within .dsc-countcell{opacity:0}
.dsc-folder{display:inline-flex;align-items:center;color:var(--dsw-alias-label-tertiary);flex:none}
.dsc-rowacts{position:absolute;right:3px;top:50%;transform:translateY(-50%);display:flex;align-items:center;gap:1px;opacity:0;pointer-events:none;transition:opacity .12s ease;border-radius:5px;padding-left:4px}
.dsc-row:hover .dsc-rowacts,.dsc-row:focus-within .dsc-rowacts{opacity:1;pointer-events:auto}
.dsc-iconbtn{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;flex:none}
.dsc-iconbtn:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 10%,transparent);color:var(--dsw-alias-label-primary)}
/* Open-with reads as the shipped split button: the action plus its menu arrow. */
.dsc-splitbtn{display:inline-flex;align-items:center;gap:0;height:22px;padding:0 3px;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;flex:none}
.dsc-splitbtn:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 10%,transparent);color:var(--dsw-alias-label-primary)}
.dsc-iconbtn-active{color:var(--dsw-alias-brand-primary)}
.dsc-svg{display:block}
.dsc-group{display:flex;flex-direction:column}
.dsc-group + .dsc-group{margin-top:1px}
.dsc-group-body > .dsc-row + .dsc-row{margin-top:1px}
.dsc-group-body{display:flex;flex-direction:column;margin-left:9px;padding-left:2px;border-left:1px solid color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent)}
.dsc-group-ghost{opacity:1}
.dsc-drop{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent);border-radius:5px}
.dsc-ws-row .dsc-rowmain{padding-left:var(--dsc-indent,0px)}
.dsc-session-row .dsc-rowmain{padding-left:calc(var(--dsc-indent,0px) + 18px)}
.dsc-session-row .dsc-rowlabel{font-size:12.5px;color:var(--dsw-alias-label-tertiary)}
/* Plugin entries are list items, not section titles: one step smaller than the
   workspace titles, the same step the session rows use. */
.dsc-plugin-row .dsc-rowlabel{font-size:12.5px;color:var(--dsw-alias-label-primary)}
.dsc-session-row:hover .dsc-rowlabel{color:var(--dsw-alias-label-secondary)}
.dsc-dot{width:7px;height:7px;border-radius:50%;flex:none}
.dsc-dot-ongoing{background:var(--dsw-alias-state-success-primary);animation:dsc-pulse 1.6s ease-in-out infinite}
.dsc-dot-warning{background:var(--dsw-alias-state-warn-primary)}
.dsc-dot-done{background:var(--dsw-alias-state-success-primary)}
@keyframes dsc-pulse{0%,100%{opacity:1}50%{opacity:.35}}
.dsc-archived .dsc-rowlabel{font-style:italic;opacity:.7}
/* One fixed row for both states: the field never changes height or baseline
   between the placeholder and a typed value. */
.dsc-search{flex:0 0 auto;display:flex;align-items:center;gap:5px;margin:2px 2px 2px;padding:0 6px;height:28px;min-height:28px;box-sizing:border-box;color:var(--dsw-alias-label-tertiary)}
.dsc-searchinput{flex:1 1 auto;min-width:0;height:26px;line-height:26px;padding:0;margin:0;border:0;background:transparent;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:12.5px;outline:none}
.dsc-searchinput::placeholder{color:var(--dsw-alias-label-tertiary);opacity:1}
.dsc-morebtn{display:inline-flex;align-items:center;gap:3px;align-self:flex-start;margin:1px 0 2px 20px;border:0;background:transparent;color:var(--dsw-alias-label-caption,var(--dsw-alias-label-tertiary));font-size:11.5px;line-height:16px;cursor:pointer;padding:1px 4px;border-radius:4px;opacity:.9}
.dsc-morebtn:hover{color:var(--dsw-alias-label-secondary);background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent);opacity:1}
.dsc-empty{padding:2px 6px 4px;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.dsc-empty-block{padding:10px 6px}
.dsc-error{display:flex;align-items:center;gap:6px;margin:2px 4px 4px;padding:5px 7px;border-radius:5px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent);color:var(--dsw-alias-state-error-primary);font-size:12px}
.dsc-error span{flex:1 1 auto;min-width:0}
.dsc-hidden-row .dsc-rowlabel{opacity:.55;font-style:italic}
/* Selection is a ring, not a fill, so the hover tint keeps exactly one meaning
   (the pointer is here). The open Session, the Workspace that holds it and the
   open panel all use it. */
.dsc-selected{box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent);background:color-mix(in srgb,var(--dsw-alias-label-primary) 1%,transparent)}
.dsc-selected .dsc-rowlabel{color:var(--dsw-alias-label-primary)}
.dsc-ws-active .dsc-rowlabel{color:var(--dsw-alias-label-primary)}
.dsc-ws-active .dsc-folder{color:var(--dsw-alias-brand-primary)}
.dsc-glyph-fallback{opacity:.6}
.dsc-grip{display:none}
.dsc-proxies{display:flex;flex-direction:column;margin-top:2px;padding-top:2px;border-top:1px solid color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent)}
.dsc-glyph{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;flex:none;color:var(--dsw-alias-label-tertiary)}
.dsc-glyph-clone{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px}
.dsc-glyph-clone:empty{display:none}
.dsc-glyph-clone svg{display:block}
.dsc-menu{min-width:180px;max-width:260px;max-height:calc(100vh - 16px);overflow-y:auto;padding:4px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-overlay);box-shadow:0 8px 24px rgba(0,0,0,.18);display:flex;flex-direction:column;gap:1px}
.dsc-menu-item{display:flex;align-items:center;gap:6px;height:26px;padding:0 8px;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-primary);font-size:12px;cursor:pointer;text-align:left}
.dsc-menu-item:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 5%,transparent)}
.dsc-menu-danger{color:var(--dsw-alias-state-error-primary)}
.dsc-menu-sep{height:1px;margin:3px 4px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 5%,transparent)}
.dsc-menu-head{padding:4px 8px 2px;font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.dsc-menu-label{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsc-menu-caret{margin-left:auto;flex:none;display:inline-flex;align-items:center;color:var(--dsw-alias-label-tertiary)}
.dsc-menu-item-open{background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent)}
.dsc-menu-appicon{flex:none;border-radius:3px;object-fit:contain}
.dsc-menu-trailing{margin-left:auto;flex:none;display:inline-flex;align-items:center;gap:4px;color:var(--dsw-alias-label-tertiary);font-size:11px}
.dsc-scrim{position:fixed;inset:0;z-index:4100;background:rgba(0,0,0,.28);display:flex;align-items:center;justify-content:center;padding:24px}
.dsc-dialog{width:min(360px,100%);border-radius:12px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-overlay);padding:14px;display:flex;flex-direction:column;gap:10px;box-shadow:0 16px 40px rgba(0,0,0,.24)}
.dsc-dialog-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dsc-dialog-message{font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.5}
.dsc-input{height:30px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);padding:0 8px;font-size:13px;outline:none}
.dsc-input:focus{border-color:var(--dsw-alias-brand-primary)}
.dsc-dialog-actions{display:flex;justify-content:flex-end;gap:8px}
.dsc-btn{height:28px;padding:0 12px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);font-size:12px;cursor:pointer}
.dsc-btn:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent)}
.dsc-btn-primary{border-color:transparent;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base)}
.dsc-btn-danger{background:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-bg-base)}
/* The foot keeps nothing but the view switch: every other entry (Lark, the
   market's "More", …) is listed in the plugin card instead. */
[class*="footerActions"] > :not(:has(.dsc-modeswitch)){display:none!important}
/* The switch shares the foot's last line instead of taking a line of its own:
   the account launcher ("More" / the avatar) owns that row, and the switch sits
   at its right edge. */
[class*="footArea"]{position:relative}
[class*="footerActions"] > :has(.dsc-modeswitch){position:absolute;right:var(--dsh-sidebar-inline-padding,8px);bottom:4px;z-index:3;display:flex !important;align-items:center;justify-content:flex-end;flex:none;width:auto;min-width:0;height:32px}
.dsc-modeswitch-row{display:flex;align-items:center;justify-content:flex-end;width:auto;height:32px;padding:0}
.dsc-modeswitch{display:inline-flex;align-items:center;gap:6px;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:12px;cursor:pointer;padding:3px 6px;border-radius:6px}
.dsc-modeswitch:hover{color:var(--dsw-alias-label-primary);background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent)}
.dsc-modeswitch-label{white-space:nowrap}
.dsc-switch{position:relative;flex:none;width:26px;height:15px;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 20%,transparent);transition:background .15s ease}
.dsc-switch-on{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 55%,transparent)}
.dsc-switch-knob{position:absolute;top:2px;left:2px;width:11px;height:11px;border-radius:50%;background:var(--dsw-alias-bg-base);transition:transform .15s ease}
.dsc-switch-on .dsc-switch-knob{transform:translateX(11px)}
/* While the cards own the column, the shell's own panel strip would duplicate
   the plugin card. It is drawn by ui-sidebar, which no slot can rearrange. */
html.dsc-on [class*="panelList"]{display:none!important}
`

		function ensureStyles() {
			if (document.getElementById(STYLE_ID) !== null) return
			const element = document.createElement('style')
			element.id = STYLE_ID
			element.textContent = CSS
			document.head.appendChild(element)
		}

		/* --------------------------------------------------------------- apply */

		const inject = ['slots', 'remote', 'remote.workspaceFiles', 'remote.session']

		function apply(ctx) {
			ctxRef = ctx
			ensureStyles()
			// The state route may not be reachable in the first frames; retry a few
			// times while the English fallback keeps the cards readable.
			const tryStrings = (attempt) => {
				loadStrings().then((loaded) => {
					if (!loaded && attempt < 6) setTimeout(() => tryStrings(attempt + 1), 300 + attempt * 400)
				})
			}
			tryStrings(0)

			const pluginEntriesStore = createPluginEntriesStore()

			const refreshEntries = () => {
				const panels = readSlotEntries('sidebar.panellist')
				const footers = readSlotEntries('sidebar.footer.action')
				const previous = pluginEntriesStore.getSnapshot()
				const same =
					previous.panels.length === panels.length &&
					previous.footers.length === footers.length &&
					previous.panels.every((row, index) => row.id === panels[index].id && row.label === panels[index].label) &&
					previous.footers.every((row, index) => row.id === footers[index].id && row.label === footers[index].label)
				if (same) return
				pluginEntriesStore.set({ panels, footers, rev: previous.rev + 1 })
			}

			const contextMenuService = () => {
				try {
					if (ctx.contextMenus) return ctx.contextMenus
				} catch {
					/* the service name is not on this context */
				}
				return safeService('contextMenus') || null
			}

			const activeMenuTarget = () => {
				const menus = contextMenuService()
				try {
					if (menus && menus.active && typeof menus.active.getSnapshot === 'function') return menus.active.getSnapshot()
				} catch {
					/* a closed popup has no target */
				}
				return null
			}

			/** Assign one workspace to a category (null removes the assignment). */
			const assignWorkspaceTo = (workspaceId, categoryId) => {
				const next = Object.assign({}, getState().assign)
				if (categoryId === null || categoryId === undefined || categoryId === UNASSIGNED) delete next[workspaceId]
				else next[workspaceId] = categoryId
				setState({ assign: next })
			}

			const actions = {
				/** Open the shared (native) Workspace menu; false when it is unavailable. */
				openWorkspaceMenu(workspace, point, mode) {
					const menus = contextMenuService()
					if (!menus || typeof menus.open !== 'function') return false
					try {
						const active = activeMenuTarget()
						if (
							mode === 'toggle' &&
							active &&
							active.kind === 'workspace' &&
							active.value &&
							active.value.workspaceId === workspace.workspaceId
						) {
							menus.close()
							return true
						}
						menus.open(
							{
								kind: 'workspace',
								value: {
									workspaceId: workspace.workspaceId,
									path: workspace.path,
									displayTitle: workspaceLabel(workspace)
								}
							},
							point
						)
						return true
					} catch {
						return false
					}
				},
				/** Open the shared (native) Session menu; false when it is unavailable. */
				openSessionMenu(sessionId, displayTitle, point, mode) {
					const menus = contextMenuService()
					if (!menus || typeof menus.open !== 'function') return false
					try {
						const active = activeMenuTarget()
						if (mode === 'toggle' && active && active.kind === 'session' && active.value && active.value.sessionId === sessionId) {
							menus.close()
							return true
						}
						menus.open({ kind: 'session', value: { sessionId, displayTitle } }, point)
						return true
					} catch {
						return false
					}
				},
				openSession(sessionId) {
					const uiWorkspace = safeService('uiWorkspace')
					if (uiWorkspace && typeof uiWorkspace.openSession === 'function') {
						uiWorkspace.openSession(sessionId)
						return
					}
					const layout = safeService('layout')
					if (layout && typeof layout.selectPanel === 'function') layout.selectPanel(null)
				},
				startSession(workspaceId) {
					const uiWorkspace = safeService('uiWorkspace')
					if (uiWorkspace && typeof uiWorkspace.startSession === 'function') {
						uiWorkspace.startSession(workspaceId)
					}
				},
				createWorkspace() {
					const desktop = globalThis.__DSH_DIRECTORY_PICKER__
					const picking =
						desktop !== undefined && desktop !== null && typeof desktop.pick === 'function'
							? Promise.resolve(desktop.pick())
							: safeService('uiWorkspace') && typeof safeService('uiWorkspace').pickDirectory === 'function'
								? Promise.resolve(safeService('uiWorkspace').pickDirectory())
								: Promise.reject(new Error(t('error.noDirectoryPicker')))
					return picking.then((path) => {
						if (path === null || path === undefined || path === '') return null
						const workspaces = safeService('workspaces')
						if (!workspaces || typeof workspaces.create !== 'function') throw new Error(t('error.workspacesUnavailable'))
						return workspaces.create({ path })
					})
				},
				renameWorkspace(workspaceId, title) {
					const workspaces = safeService('workspaces')
					if (!workspaces || typeof workspaces.rename !== 'function') return Promise.reject(new Error(t('error.workspacesUnavailable')))
					return workspaces.rename(workspaceId, title)
				},
				deleteWorkspace(workspaceId) {
					const workspaces = safeService('workspaces')
					if (!workspaces || typeof workspaces.delete !== 'function') return Promise.reject(new Error(t('error.workspacesUnavailable')))
					return workspaces.delete(workspaceId)
				},
				archiveSession(sessionId, options) {
					const workspaces = safeService('workspaces')
					if (!workspaces || typeof workspaces.archiveSession !== 'function') throw new Error(t('error.workspacesUnavailable'))
					return workspaces.archiveSession(sessionId, options)
				},
				unarchiveSession(sessionId) {
					const workspaces = safeService('workspaces')
					if (!workspaces || typeof workspaces.unarchiveSession !== 'function') throw new Error(t('error.workspacesUnavailable'))
					return workspaces.unarchiveSession(sessionId)
				},
				pinSession(sessionId) {
					const workspaces = safeService('workspaces')
					if (!workspaces || typeof workspaces.pinSession !== 'function') return Promise.reject(new Error(t('error.pinUnavailable')))
					return workspaces.pinSession(sessionId)
				},
				unpinSession(sessionId) {
					const workspaces = safeService('workspaces')
					if (!workspaces || typeof workspaces.unpinSession !== 'function') return Promise.reject(new Error(t('error.unpinUnavailable')))
					return workspaces.unpinSession(sessionId)
				},
				forkSession(sessionId) {
					const uiWorkspace = safeService('uiWorkspace')
					if (!uiWorkspace || typeof uiWorkspace.forkSession !== 'function') return Promise.reject(new Error(t('error.forkUnavailable')))
					return uiWorkspace.forkSession(sessionId)
				},
				renameSession(sessionId, title) {
					const sessions = safeService('sessions')
					if (!sessions || typeof sessions.using !== 'function') return Promise.reject(new Error(t('error.sessionsUnavailable')))
					return Promise.resolve(sessions.using(sessionId, { source: 'workspaceOperation' }, (reference) => reference.binding.session.rename(title))).then(
						(result) => {
							if (result && result.ok === false) throw new Error((result.error && result.error.message) || t('error.renameFailed'))
							return result
						}
					)
				}
			}

			/**
			 * Our one addition to the native Workspace menu: filing it into a
			 * category. Everything else (rename, delete, reveal, …) stays the
			 * contribution set the rest of the app already publishes.
			 */
			try {
				const menus = contextMenuService()
				if (menus && typeof menus.register === 'function') {
					ctx.effect(
						() =>
							menus.register({
								id: 'sidebar-cards/categories',
								target: 'workspace',
								order: 120,
								resolve: ({ workspaceId }) => {
									const stateNow = getState()
									const categories = stateNow.categories
									if (categories.length === 0) return []
									const current = stateNow.assign[workspaceId]
									const rows = [
										{
											id: 'move-to-category',
											label: t('workspace.moveTo'),
											children: categories.map((category) => ({
												id: 'move-to:' + category.id,
												label: (current === category.id ? '✓ ' : '') + (category.name || t('category.untitled')),
												run: () => assignWorkspaceTo(workspaceId, category.id)
											}))
										}
									]
									if (current !== undefined) {
										rows.push({
											id: 'remove-from-category',
											label: t('workspace.moveOut'),
											run: () => assignWorkspaceTo(workspaceId, UNASSIGNED)
										})
									}
									return rows
								}
							}),
						`${PACKAGE}: workspace category menu`
					)
				}
			} catch (error) {
				console.warn('[dsh-sidebar-cards] could not contribute the category menu', error)
			}

			const injectedProps = () => ({
				workspacesStore: safeService('workspaces') && safeService('workspaces').list,
				sessionsStore: safeService('sessions') && safeService('sessions').list,
				pluginEntriesStore,
				actions
			})

			// `sidebar.workspaces` is a single slot: our -200 entry shadows both
			// ui-workspace's 0 browser and dsh-workspace-categories' -100 tree.
			// Disposing it restores whichever one is still installed.
			ctx.slots.inject('sidebar.workspaces', () => {
				let disposeRegistration

				const sync = () => {
					const wanted = getState().mode === 'cards'
					if (wanted && disposeRegistration === undefined) {
						disposeRegistration = ctx.slots.register(
							{
								name: 'sidebar.workspaces',
								priority: -200,
								registrant: PACKAGE,
								inject: injectedProps
							},
							Root
						)
					} else if (!wanted && disposeRegistration !== undefined) {
						disposeRegistration()
						disposeRegistration = undefined
					}
				}

				const unsubscribe = subscribeState(sync)
				sync()

				return () => {
					unsubscribe()
					if (disposeRegistration !== undefined) {
						disposeRegistration()
						disposeRegistration = undefined
					}
				}
			})

			/**
			 * The one view switch. It lives in the shell foot, last in order and
			 * right-aligned, so it sits in the same corner in both modes: in card
			 * mode the foot's other entries are hidden (they moved into the plugin
			 * card) and only this switch remains; in native mode every entry shows
			 * and the switch stays at the end of the row.
			 */
			ctx.slots.inject('sidebar.footer.action', () => {
				let disposeRegistration = ctx.slots.register(
					{
						name: 'sidebar.footer.action',
						id: 'sidebar-cards-toggle',
						order: 9999,
						// Fixed at registration: the slot label is metadata, while the
						// visible switch text re-renders from t() inside ViewSwitch.
						label: t('mode.title'),
						registrant: PACKAGE
					},
					function ViewSwitch(props) {
						const stateNow = useStateTick()
						const cards = stateNow.mode === 'cards'
						const label = cards ? t('mode.native') : t('mode.cards')
						const wide = props.wide !== false
						const node = h(
							'button',
							{
								type: 'button',
								className: 'dsc-modeswitch',
								'aria-pressed': cards,
								'aria-label': cards ? t('mode.toNative') : t('mode.toCards'),
								title: cards ? t('mode.toNative') : t('mode.toCards'),
								onClick: () => setState({ mode: cards ? 'native' : 'cards' })
							},
							h(Icon, { name: 'layers', size: 13 }),
							wide ? h('span', { className: 'dsc-modeswitch-label' }, label) : null,
							h('span', { className: 'dsc-switch' + (cards ? ' dsc-switch-on' : '') }, h('span', { className: 'dsc-switch-knob' }))
						)
						return h('div', { className: 'dsc-modeswitch-row' }, node)
					}
				)
				return () => {
					if (disposeRegistration !== undefined) {
						disposeRegistration()
						disposeRegistration = undefined
					}
				}
			})

			// Entry discovery: the list is populated while plugins register, so
			// scan now, on every slot change, and a few more times during boot.
			refreshEntries()
			try {
				const slots = ctx.slots
				if (typeof slots.subscribe === 'function') {
					ctx.effect(() => {
						const offPanels = slots.subscribe('sidebar.panellist', refreshEntries)
						const offFooters = slots.subscribe('sidebar.footer.action', refreshEntries)
						return () => {
							if (typeof offPanels === 'function') offPanels()
							if (typeof offFooters === 'function') offFooters()
						}
					}, `${PACKAGE}: entry changes`)
				}
			} catch {
				/* without a subscription the boot retries below still fill it */
			}
			for (const delay of [200, 600, 1400, 3000, 6000, 12000]) {
				setTimeout(refreshEntries, delay)
			}

			// Host copy first, then the local mirror keeps the page usable when
			// the state route is unavailable.
			hydrate()
		}

		exports.inject = inject
		exports.apply = apply
		return module.exports
}

try {
	window.__ModuleLoader__.load({
		id: 'dsh-sidebar-cards',
		factory(require) {
			try {
				return build(require)
			} catch (error) {
				console.error('[dsh-sidebar-cards] failed to build the client half', error)
				return { inject: [], apply() {} }
			}
		}
	})
} catch (error) {
	// A second evaluation of the same bundle registers a factory that already
	// exists; the loader throws for it and the first factory stays in place. A
	// disable/enable cycle removed the factory first, so this same call is how
	// the plugin comes back.
	console.warn('[dsh-sidebar-cards] bundle evaluated with its registration already present; keeping the first one', error)
}
