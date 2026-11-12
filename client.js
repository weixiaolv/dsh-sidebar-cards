/**
 * dsh-sidebar-cards — client half.
 *
 * Takes over the sidebar's `sidebar.workspaces` region and renders two
 * collapsible cards in it:
 *
 *   工作区 —— categories > workspaces > sessions, with the management actions
 *             the native browser offers (rename / delete / archive / pin /
 *             new session / new workspace / search / archived filter).
 *   插件   —— every panel entry (`sidebar.panellist`) and loose shortcut entry
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
		const LEGACY_KEY = 'dsh.workspace-tree.state.v1'
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
			workspaceSort: 'manual',
			workspaceSortDir: 'asc',
			pluginCollapsed: true,
			pluginGroups: [],
			pluginAssign: {},
			pluginHidden: [],
			pluginShowHidden: false,
			migrated: false
		}

		function sanitize(raw) {
			const merged = Object.assign({}, DEFAULTS, raw || {})
			const categories = Array.isArray(merged.categories)
				? merged.categories
						.filter((entry) => entry && typeof entry.id === 'string' && entry.id !== '')
						.map((entry) => ({
							id: entry.id,
							name: typeof entry.name === 'string' && entry.name !== '' ? entry.name : '未命名分类',
							collapsed: entry.collapsed === true
						}))
				: []
			const pluginGroups = Array.isArray(merged.pluginGroups)
				? merged.pluginGroups
						.filter((entry) => entry && typeof entry.id === 'string' && entry.id !== '')
						.map((entry) => ({
							id: entry.id,
							name: typeof entry.name === 'string' && entry.name !== '' ? entry.name : '未命名分组',
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
				workspaceSort: ['manual', 'name', 'time'].indexOf(merged.workspaceSort) === -1 ? 'manual' : merged.workspaceSort,
				workspaceSortDir: merged.workspaceSortDir === 'desc' ? 'desc' : 'asc',
				pluginCollapsed: merged.pluginCollapsed !== false,
				pluginGroups,
				pluginAssign: asRecord(merged.pluginAssign),
				pluginHidden: Array.isArray(merged.pluginHidden) ? merged.pluginHidden.filter((v) => typeof v === 'string') : [],
				pluginShowHidden: merged.pluginShowHidden === true,
				migrated: merged.migrated === true
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
				migrateLegacy()
				return
			}
			hydrated = true
			migrateLegacy()
			save()
		}

		/** Pull the categories dsh-workspace-categories kept in localStorage. */
		function migrateLegacy() {
			if (state.migrated) return
			let legacy = null
			try {
				const raw = window.localStorage.getItem(LEGACY_KEY)
				legacy = raw === null ? null : JSON.parse(raw)
			} catch {
				legacy = null
			}
			if (legacy && Array.isArray(legacy.categories) && legacy.categories.length > 0) {
				const categories = legacy.categories
					.filter((entry) => entry && typeof entry.id === 'string')
					.map((entry) => ({
						id: entry.id,
						name: typeof entry.name === 'string' && entry.name !== '' ? entry.name : '未命名分类',
						collapsed: entry.collapsed === true
					}))
				setState({
					categories,
					assign: asRecord(legacy.assign),
					expanded: asRecord(legacy.expanded),
					visible: asRecord(legacy.visible),
					archived: ARCHIVED_MODES.indexOf(legacy.archivedFilter) === -1 ? 'default' : legacy.archivedFilter,
					migrated: true
				})
				return
			}
			setState({ migrated: true })
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
			arrowLeft: 'M12.5 8H3.5M6.8 4.7 3.5 8l3.3 3.3',
			expand: 'M4.5 6 8 9.5 11.5 6M4.5 10.5 8 14l3.5-3.5',
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
			expand: shipped('IconChevronsUpDownOutlineRegular')
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
			React.useEffect(() => {
				const close = (event) => {
					if (ref.current && ref.current.contains(event.target)) return
					props.onClose()
				}
				const onKey = (event) => {
					if (event.key === 'Escape') props.onClose()
				}
				document.addEventListener('mousedown', close, true)
				document.addEventListener('keydown', onKey)
				return () => {
					document.removeEventListener('mousedown', close, true)
					document.removeEventListener('keydown', onKey)
				}
			}, [])
			const style = {
				position: 'fixed',
				left: Math.max(8, Math.min(props.x, window.innerWidth - 220)),
				top: Math.max(8, Math.min(props.y, window.innerHeight - 40 - (props.items.length + 2) * 28)),
				zIndex: 4000
			}
			return h(
				'div',
				{ className: 'dsc-menu', style, ref, role: 'menu' },
				props.items.map((item, index) =>
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
										className: 'dsc-menu-item' + (item.danger ? ' dsc-menu-danger' : ''),
										onClick: () => {
											props.onClose()
											if (item.onSelect) item.onSelect()
										}
									},
									item.icon ? h(Icon, { name: item.icon, size: 13 }) : null,
									h('span', { className: 'dsc-menu-label' }, item.label),
									item.trailing ? h('span', { className: 'dsc-menu-trailing' }, item.trailing) : null
								)
				)
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
							'取消'
						),
						h(
							'button',
							{
								type: 'button',
								className: 'dsc-btn dsc-btn-primary' + (props.danger ? ' dsc-btn-danger' : ''),
								onClick: submit
							},
							props.confirmLabel || '确定'
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
					// Exact label first: "插件" must not borrow "插件市场"'s glyph.
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

			const newGroup = () => {
				setDialog({
					title: '新建插件分组',
					placeholder: '分组名称，例如 工具 / 数据 / 连接',
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
					h('span', { className: 'dsc-grip', title: '拖到分组归类' }, h(Icon, { name: 'grip', size: 12 })),
					h(
						'button',
						{
							type: 'button',
							className: 'dsc-rowmain',
							onClick: () => openRow(row)
						},
						h(ClonedIcon, { label: row.label }),
						h('span', { className: 'dsc-rowlabel' }, row.label)
					),
					h(
						'span',
						{ className: 'dsc-rowacts' },
						h(IconButton, {
							name: hidden.has(row.key) ? 'eye' : 'eyeOff',
							label: hidden.has(row.key) ? '恢复显示' : '隐藏入口',
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
							h('span', { className: 'dsc-rowlabel dsc-catlabel' }, group.name)
						),
						h(CountBadge, { count: (buckets.get(group.id) || []).length }),
						h(
							'span',
							{ className: 'dsc-rowacts' },
							h(IconButton, {
								name: 'pencil',
								label: '重命名分组',
								onClick: () =>
									setDialog({
										title: '重命名分组',
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
								label: '删除分组',
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
				{ className: 'dsc-card dsc-plugincard' },
				h(
					CardHeader,
					{
						title: '插件',
						open,
						count: totalVisible,
						onToggle: () => setPlugin({ pluginCollapsed: open })
					},
					h(IconButton, {
						name: 'sliders',
						label: '视图选项',
						onClick: (event) => {
							const rect = event.currentTarget.getBoundingClientRect()
							const hiddenCount = all.filter((row) => hidden.has(row.key)).length
							setMenu({
								x: rect.right - 200,
								y: rect.bottom + 4,
								items: [
									{
										label: '显示已隐藏入口' + (hiddenCount > 0 ? '（' + hiddenCount + '）' : ''),
										trailing: showHidden ? '✓' : '',
										onSelect: () => setPlugin({ pluginShowHidden: !showHidden })
									},
									{ separator: true },
									{
										label: '全部展开',
										onSelect: () => setPlugin({ pluginGroups: groups.map((group) => Object.assign({}, group, { collapsed: false })) })
									},
									{
										label: '全部折叠',
										onSelect: () => setPlugin({ pluginGroups: groups.map((group) => Object.assign({}, group, { collapsed: true })) })
									}
								]
							})
						}
					}),
					h(IconButton, { name: 'plus', label: '新建插件分组', onClick: newGroup })
				),
				open
					? h(
							'div',
							{ className: 'dsc-cardbody dsc-pluginbody' },
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
												h('span', { className: 'dsc-rowlabel dsc-catlabel' }, '未分组')
											),
											h(CountBadge, { count: ungrouped.length })
										),
										ungrouped.map(renderRow)
									)
								: null,
							groups.length === 0 && ungrouped.length === 0
								? h('div', { className: 'dsc-empty' }, '暂无可管理的插件入口')
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
		 * The foot's other entries (Lark, the market's "更多", …) can only be
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
					title: '新建分类',
					placeholder: '分类名称，例如 组织管理 / 项目管理',
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
								title: '该会话仍在运行',
								message: '停止它并归档？',
								confirmOnly: true,
								confirmLabel: '停止并归档',
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
						label: '新建会话',
						icon: 'plus',
						onSelect: () => {
							if (actions.startSession) actions.startSession(workspace.workspaceId)
						}
					},
					{
						label: '重命名工作区',
						icon: 'pencil',
						onSelect: () =>
							setDialog({
								title: '重命名工作区',
								initialValue: workspaceLabel(workspace),
								onSubmit: (name) => {
									setDialog(null)
									if (name === '') return
									Promise.resolve(actions.renameWorkspace(workspace.workspaceId, name)).catch(fail)
								}
							})
					},
					{ label: '复制路径', onSelect: () => copy(workspace.path) },
					{ separator: true }
				]
				if (categories.length > 0) {
					items.push({ header: true, label: '移入分类' })
					for (const category of categories) {
						items.push({
							label: (stateNow.assign[workspace.workspaceId] === category.id ? '✓ ' : '') + category.name,
							onSelect: () => assignWorkspace(workspace.workspaceId, category.id)
						})
					}
					if (stateNow.assign[workspace.workspaceId] !== undefined) {
						items.push({ label: '移出分类', onSelect: () => assignWorkspace(workspace.workspaceId, UNASSIGNED) })
					}
					items.push({ separator: true })
				}
				items.push({
					label: '删除工作区',
					danger: true,
					icon: 'trash',
					onSelect: () =>
						setDialog({
							title: '删除工作区',
							message: '仅从列表移除，不会删除磁盘上的目录。',
							confirmOnly: true,
							danger: true,
							confirmLabel: '删除',
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
					? actions.openSessionMenu(session.id, session.displayTitle || session.title || '未命名', point, mode)
					: false
				return opened === true
			}

			const sessionMenu = (event, session, mode) => {
				if (nativeSessionMenu(event, session, mode)) return
				const rect = event.currentTarget.getBoundingClientRect()
				const pinned = (wsSnap.pinnedSessionIds || []).indexOf(session.id) !== -1
				const items = [
					{
						label: '重命名会话',
						icon: 'pencil',
						onSelect: () =>
							setDialog({
								title: '重命名会话',
								initialValue: session.displayTitle || session.title || '',
								onSubmit: (name) => {
									setDialog(null)
									if (name === '') return
									Promise.resolve(actions.renameSession(session.id, name)).catch(fail)
								}
							})
					},
					{
						label: pinned ? '取消置顶' : '置顶',
						icon: 'pin',
						onSelect: () => {
							const call = pinned ? actions.unpinSession : actions.pinSession
							if (!call) return
							Promise.resolve(call(session.id)).catch(fail)
						}
					},
					{
						label: '分叉会话',
						icon: 'branch',
						onSelect: () => {
							try {
								Promise.resolve(actions.forkSession ? actions.forkSession(session.id) : null).catch(fail)
							} catch (reason) {
								fail(reason)
							}
						}
					},
					{ label: '复制会话 ID', onSelect: () => copy(session.id) },
					{ separator: true }
				]
				if (session.archived) {
					items.push({ label: '取消归档', icon: 'unarchive', onSelect: () => unarchive(session.id) })
				} else {
					items.push({ label: '归档', icon: 'archive', onSelect: () => archive(session.id) })
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
						h('span', { className: 'dsc-rowlabel' }, session.displayTitle || session.title || '未命名')
					),
					h(
						'span',
						{ className: 'dsc-rowacts' },
						h(IconButton, { name: 'more', label: '更多操作', onClick: (event) => sessionMenu(event, session, 'toggle') })
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
								label: '新建会话',
								onClick: () => {
									if (actions.startSession) actions.startSession(workspace.workspaceId)
								}
							}),
							h(IconButton, { name: 'more', label: '工作区操作', onClick: (event) => workspaceMenu(event, workspace, 'toggle') })
						)
					),
					expanded
						? h(
								'div',
								{ className: 'dsc-group-body' },
								shown.map((session) => renderSession(workspace, session)),
								sessions.length === 0 ? h('div', { className: 'dsc-empty' }, lower === '' ? '还没有会话' : '没有匹配的会话') : null,
								sessions.length > limit
									? h(
											'button',
											{ type: 'button', className: 'dsc-morebtn', onClick: () => showMore(workspace.workspaceId) },
											'显示更多'
										)
									: limit > SESSION_DEFAULT && sessions.length > 0
										? h('button', { type: 'button', className: 'dsc-morebtn', onClick: () => showLess(workspace.workspaceId) }, '显示更少')
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
							h('span', { className: 'dsc-rowlabel dsc-catlabel' }, category.name)
						),
						h(CountBadge, { count: (buckets.get(category.id) || []).length }),
						h(
							'span',
							{ className: 'dsc-rowacts' },
							h(IconButton, { name: 'plus', label: '在此分类下新建工作区', onClick: () => createWorkspaceFor(category.id) }),
							h(IconButton, {
								name: 'pencil',
								label: '重命名分类',
								onClick: () =>
									setDialog({
										title: '重命名分类',
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
								label: '删除分类',
								onClick: () =>
									setDialog({
										title: '删除分类',
										message: '分类里的工作区会回到「未分类」，不会删除工作区。',
										confirmOnly: true,
										danger: true,
										confirmLabel: '删除分类',
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
									? h('div', { className: 'dsc-empty' }, '把工作区拖到这里，或点 + 新建')
									: null
							)
				)

			const open = stateNow.workspaceCollapsed !== true

			return h(
				'div',
				{ className: 'dsc-card dsc-wscard' },
				h(
					CardHeader,
					{
						title: '工作区',
						open,
						count: workspaces.length,
						onToggle: () => setState({ workspaceCollapsed: open })
					},
					h(IconButton, {
						name: 'sliders',
						label: '视图选项',
						onClick: (event) => {
							const rect = event.currentTarget.getBoundingClientRect()
							const check = (key) => (stateNow.archived === key ? '✓' : '')
							setMenu({
								x: rect.right - 190,
								y: rect.bottom + 4,
								items: [
									{ header: true, label: '已归档会话' },
									{ label: '隐藏已归档', trailing: check('default'), onSelect: () => setState({ archived: 'default' }) },
									{ label: '全部对话（显示已归档）', trailing: check('show'), onSelect: () => setState({ archived: 'show' }) },
									{ label: '仅显示已归档', trailing: check('only'), onSelect: () => setState({ archived: 'only' }) },
									{ separator: true },
									{ header: true, label: '工作区排序' },
									{
										label: '不自动排序',
										trailing: stateNow.workspaceSort === 'manual' ? '✓' : '',
										onSelect: () => setState({ workspaceSort: 'manual' })
									},
									{
										// Re-clicking the active mode flips its direction: one row
										// per mode, not a second set of direction rows.
										label: '按名称排序',
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
										label: '按最近会话排序',
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
									{ label: '全部展开', onSelect: () => expandAll() },
									{ label: '全部折叠', onSelect: () => setState({ expanded: {} }) }
								]
							})
						}
					}),
					h(IconButton, {
						name: 'plus',
						label: '新建分组或工作区',
						onClick: (event) => {
							const rect = event.currentTarget.getBoundingClientRect()
							setMenu({
								x: rect.right - 168,
								y: rect.bottom + 4,
								items: [
									{ label: '新建分组', icon: 'layers', onSelect: newCategory },
									{ label: '新建工作区', icon: 'folder', onSelect: () => createWorkspaceFor(null) }
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
									placeholder: '筛选工作区与会话…',
									onChange: (event) => setNeedle(event.target.value)
								}),
								needle.trim() === ''
									? null
									: h(IconButton, {
											name: 'expand',
											label: expandHits ? '收起命中' : '展开全部命中',
											active: expandHits,
											onClick: () => setExpandHits(!expandHits)
										})
							),
							error
								? h(
										'div',
										{ className: 'dsc-error' },
										h('span', null, error),
										h(IconButton, { name: 'close', label: '关闭', onClick: clearError })
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
										h('span', { className: 'dsc-rowlabel dsc-catlabel' }, '未分类')
									),
									h(CountBadge, { count: orderedUnassigned.length })
								),
								h('div', { className: 'dsc-group-body' }, orderedUnassigned.map((workspace) => renderWorkspace(workspace, 0)))
							)
								: null,
							workspaces.length === 0
								? h('div', { className: 'dsc-empty dsc-empty-block' }, '还没有工作区，点上方 + 添加一个目录')
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

		function Root(props) {
			const stateNow = useStateTick()
			const wide = props.wide !== false
			// The slot hands every region the shipped panel selector; without it
			// (older host) no panel row is marked as open.
			const activePanelId =
				typeof props.usePanelInfo === 'function'
					? props.usePanelInfo((info) => (info ? info.activePanelId : undefined))
					: undefined
			// running / awaiting-interaction / unread-completion, the same facts the
			// shipped browser reads for its row dots.
			const statuses =
				typeof props.useSessionStatus === 'function' ? props.useSessionStatus((map) => map) : undefined

			React.useEffect(() => {
				const root = document.documentElement
				if (stateNow.mode === 'cards' && wide) root.classList.add(HTML_CLASS)
				else root.classList.remove(HTML_CLASS)
				return () => root.classList.remove(HTML_CLASS)
			}, [stateNow.mode, wide])

			const cards = h(
				'div',
				{ className: 'dsc-root', 'data-sidebar-cards': 'cards' },
				h(WorkspaceCard, {
					workspacesStore: props.workspacesStore,
					sessionsStore: props.sessionsStore,
					statuses,
					actions: props.actions
				}),
				h(PluginCard, {
					pluginEntriesStore: props.pluginEntriesStore,
					activePanelId
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
.dsc-card{display:flex;flex-direction:column;min-height:0;flex:0 1 auto}
.dsc-wscard{flex:1 1 auto}
.dsc-plugincard{flex:none;margin-top:2px;padding-top:2px;border-top:1px solid color-mix(in srgb,var(--dsw-alias-label-primary) 7%,transparent)}
.dsc-cardhead{display:flex;align-items:center;gap:2px;height:28px;padding:0 6px;flex:none;position:relative;background:color-mix(in srgb,var(--dsw-alias-label-primary) 1.5%,var(--dsw-specific-sidebar-fill,var(--dsw-alias-bg-base)))}
.dsc-cardtoggle{display:flex;align-items:center;gap:5px;flex:1 1 auto;min-width:0;height:26px;padding:0 4px;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:11.5px;font-weight:600;border-radius:5px;cursor:pointer}
.dsc-cardtoggle:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent);color:var(--dsw-alias-label-secondary)}
.dsc-cardtitle{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left}
.dsc-headcount{flex:none;min-width:16px;text-align:right;font-size:11px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;padding-right:2px;transition:opacity .1s ease}
/* Same grammar as a content row: the count while idle, the actions on hover. */
.dsc-cardacts{position:absolute;right:6px;top:50%;transform:translateY(-50%);display:flex;align-items:center;gap:1px;opacity:0;pointer-events:none;transition:opacity .12s ease;border-radius:5px;padding-left:4px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 1.5%,var(--dsw-specific-sidebar-fill,var(--dsw-alias-bg-base)))}
.dsc-cardhead:hover .dsc-cardacts,.dsc-cardhead:focus-within .dsc-cardacts{opacity:1;pointer-events:auto}
.dsc-cardhead:hover .dsc-headcount,.dsc-cardhead:focus-within .dsc-headcount{opacity:0}
.dsc-cardbody{display:flex;flex-direction:column;min-height:0;flex:1 1 auto;overflow:auto;padding:0 4px 4px}
.dsc-pluginbody{flex:0 1 auto;max-height:42vh}
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
.dsc-plugin-row .dsc-rowlabel{font-size:13px;color:var(--dsw-alias-label-primary)}
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
.dsc-morebtn{align-self:flex-start;margin:1px 0 1px 20px;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:12px;cursor:pointer;padding:1px 4px;border-radius:4px}
.dsc-morebtn:hover{color:var(--dsw-alias-label-primary)}
.dsc-empty{padding:2px 6px 4px;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.dsc-empty-block{padding:10px 6px}
.dsc-error{display:flex;align-items:center;gap:6px;margin:2px 4px 4px;padding:5px 7px;border-radius:5px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent);color:var(--dsw-alias-state-error-primary);font-size:12px}
.dsc-error span{flex:1 1 auto;min-width:0}
.dsc-hidden-row .dsc-rowlabel{opacity:.55;font-style:italic}
/* The open Session, the Workspace that holds it, and the open panel keep the
   shipped "selected" fill so the left column always says where you are. */
.dsc-selected{background:var(--dsw-alias-interactive-bg-hover)}
.dsc-selected:hover{background:var(--dsw-alias-interactive-bg-hover)}
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
.dsc-menu{min-width:180px;max-width:260px;padding:4px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-overlay);box-shadow:0 8px 24px rgba(0,0,0,.18);display:flex;flex-direction:column;gap:1px}
.dsc-menu-item{display:flex;align-items:center;gap:6px;height:26px;padding:0 8px;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-primary);font-size:12px;cursor:pointer;text-align:left}
.dsc-menu-item:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 10%,transparent)}
.dsc-menu-danger{color:var(--dsw-alias-state-error-primary)}
.dsc-menu-sep{height:1px;margin:3px 4px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 10%,transparent)}
.dsc-menu-head{padding:4px 8px 2px;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.dsc-menu-label{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
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
   market's "更多", …) is listed in the plugin card instead. */
[class*="footerActions"] > :not(:has(.dsc-modeswitch)){display:none!important}
[class*="footerActions"] > :has(.dsc-modeswitch){display:flex !important;align-items:center;flex:1 1 auto;min-width:0;justify-content:flex-end}
.dsc-modeswitch-row{display:flex;align-items:center;justify-content:flex-end;width:100%;padding:2px 2px 2px 0}
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

		const inject = ['slots']

		function apply(ctx) {
			ctxRef = ctx
			ensureStyles()

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
								: Promise.reject(new Error('没有可用的目录选择器'))
					return picking.then((path) => {
						if (path === null || path === undefined || path === '') return null
						const workspaces = safeService('workspaces')
						if (!workspaces || typeof workspaces.create !== 'function') throw new Error('workspaces 服务不可用')
						return workspaces.create({ path })
					})
				},
				renameWorkspace(workspaceId, title) {
					const workspaces = safeService('workspaces')
					if (!workspaces || typeof workspaces.rename !== 'function') return Promise.reject(new Error('workspaces 服务不可用'))
					return workspaces.rename(workspaceId, title)
				},
				deleteWorkspace(workspaceId) {
					const workspaces = safeService('workspaces')
					if (!workspaces || typeof workspaces.delete !== 'function') return Promise.reject(new Error('workspaces 服务不可用'))
					return workspaces.delete(workspaceId)
				},
				archiveSession(sessionId, options) {
					const workspaces = safeService('workspaces')
					if (!workspaces || typeof workspaces.archiveSession !== 'function') throw new Error('workspaces 服务不可用')
					return workspaces.archiveSession(sessionId, options)
				},
				unarchiveSession(sessionId) {
					const workspaces = safeService('workspaces')
					if (!workspaces || typeof workspaces.unarchiveSession !== 'function') throw new Error('workspaces 服务不可用')
					return workspaces.unarchiveSession(sessionId)
				},
				pinSession(sessionId) {
					const workspaces = safeService('workspaces')
					if (!workspaces || typeof workspaces.pinSession !== 'function') return Promise.reject(new Error('置顶不可用'))
					return workspaces.pinSession(sessionId)
				},
				unpinSession(sessionId) {
					const workspaces = safeService('workspaces')
					if (!workspaces || typeof workspaces.unpinSession !== 'function') return Promise.reject(new Error('取消置顶不可用'))
					return workspaces.unpinSession(sessionId)
				},
				forkSession(sessionId) {
					const uiWorkspace = safeService('uiWorkspace')
					if (!uiWorkspace || typeof uiWorkspace.forkSession !== 'function') return Promise.reject(new Error('分叉不可用'))
					return uiWorkspace.forkSession(sessionId)
				},
				renameSession(sessionId, title) {
					const sessions = safeService('sessions')
					if (!sessions || typeof sessions.using !== 'function') return Promise.reject(new Error('sessions 服务不可用'))
					return Promise.resolve(sessions.using(sessionId, { source: 'workspaceOperation' }, (reference) => reference.binding.session.rename(title))).then(
						(result) => {
							if (result && result.ok === false) throw new Error((result.error && result.error.message) || '重命名失败')
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
											label: '移入分类',
											children: categories.map((category) => ({
												id: 'move-to:' + category.id,
												label: (current === category.id ? '✓ ' : '') + category.name,
												run: () => assignWorkspaceTo(workspaceId, category.id)
											}))
										}
									]
									if (current !== undefined) {
										rows.push({
											id: 'remove-from-category',
											label: '移出分类',
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
						label: '视图切换',
						registrant: PACKAGE
					},
					function ViewSwitch(props) {
						const stateNow = useStateTick()
						const cards = stateNow.mode === 'cards'
						const label = cards ? '原生列表' : '卡片侧栏'
						const wide = props.wide !== false
						const node = h(
							'button',
							{
								type: 'button',
								className: 'dsc-modeswitch',
								'aria-pressed': cards,
								'aria-label': cards ? '切换为原生工作区列表' : '切换为卡片侧栏',
								title: cards ? '切换为原生工作区列表' : '切换为卡片侧栏',
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
