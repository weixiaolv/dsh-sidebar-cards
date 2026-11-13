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
		const STRINGS = {
			// One row per message, the text in every language this build carries.
			"card.workspaces": {
				"en": "Workspaces",
				"zh-Hans": "工作区",
				"zh-Hant": "工作區",
				"ja": "ワークスペース",
				"fr": "Espaces de travail",
				"de": "Arbeitsbereiche",
				"es": "Espacios de trabajo",
				"pt": "Espaços de trabalho",
				"ru": "Рабочие области",
			},
			"card.plugins": {
				"en": "Plugins",
				"zh-Hans": "插件",
				"zh-Hant": "外掛",
				"ja": "プラグイン",
				"fr": "Plugins",
				"de": "Plugins",
				"es": "Plugins",
				"pt": "Plugins",
				"ru": "Плагины",
			},
			"card.unassigned": {
				"en": "Uncategorized",
				"zh-Hans": "未分类",
				"zh-Hant": "未分類",
				"ja": "未分類",
				"fr": "Sans catégorie",
				"de": "Nicht zugeordnet",
				"es": "Sin categoría",
				"pt": "Sem categoria",
				"ru": "Без категории",
			},
			"card.ungrouped": {
				"en": "Ungrouped",
				"zh-Hans": "未分组",
				"zh-Hant": "未分組",
				"ja": "グループなし",
				"fr": "Sans groupe",
				"de": "Ohne Gruppe",
				"es": "Sin grupo",
				"pt": "Sem grupo",
				"ru": "Без группы",
			},
			"action.cancel": {
				"en": "Cancel",
				"zh-Hans": "取消",
				"zh-Hant": "取消",
				"ja": "キャンセル",
				"fr": "Annuler",
				"de": "Abbrechen",
				"es": "Cancelar",
				"pt": "Cancelar",
				"ru": "Отмена",
			},
			"action.confirm": {
				"en": "OK",
				"zh-Hans": "确定",
				"zh-Hant": "確定",
				"ja": "OK",
				"fr": "OK",
				"de": "OK",
				"es": "Aceptar",
				"pt": "OK",
				"ru": "ОК",
			},
			"action.delete": {
				"en": "Delete",
				"zh-Hans": "删除",
				"zh-Hant": "刪除",
				"ja": "削除",
				"fr": "Supprimer",
				"de": "Löschen",
				"es": "Eliminar",
				"pt": "Excluir",
				"ru": "Удалить",
			},
			"action.close": {
				"en": "Close",
				"zh-Hans": "关闭",
				"zh-Hant": "關閉",
				"ja": "閉じる",
				"fr": "Fermer",
				"de": "Schließen",
				"es": "Cerrar",
				"pt": "Fechar",
				"ru": "Закрыть",
			},
			"action.expandAll": {
				"en": "Expand all",
				"zh-Hans": "全部展开",
				"zh-Hant": "全部展開",
				"ja": "すべて展開",
				"fr": "Tout déplier",
				"de": "Alle ausklappen",
				"es": "Expandir todo",
				"pt": "Expandir tudo",
				"ru": "Развернуть все",
			},
			"action.collapseAll": {
				"en": "Collapse all",
				"zh-Hans": "全部折叠",
				"zh-Hant": "全部收合",
				"ja": "すべて折りたたむ",
				"fr": "Tout replier",
				"de": "Alle einklappen",
				"es": "Contraer todo",
				"pt": "Recolher tudo",
				"ru": "Свернуть все",
			},
			"category.new": {
				"en": "New category",
				"zh-Hans": "新建分类",
				"zh-Hant": "新增分類",
				"ja": "新しいカテゴリ",
				"fr": "Nouvelle catégorie",
				"de": "Neue Kategorie",
				"es": "Nueva categoría",
				"pt": "Nova categoria",
				"ru": "Новая категория",
			},
			"category.newWorkspace": {
				"en": "New workspace in this category",
				"zh-Hans": "在此分类下新建工作区",
				"zh-Hant": "在此分類新增工作區",
				"ja": "このカテゴリにワークスペースを追加",
				"fr": "Nouvel espace de travail dans cette catégorie",
				"de": "Neuer Arbeitsbereich in dieser Kategorie",
				"es": "Nuevo espacio de trabajo en esta categoría",
				"pt": "Novo espaço de trabalho nesta categoria",
				"ru": "Новая рабочая область в этой категории",
			},
			"category.rename": {
				"en": "Rename category",
				"zh-Hans": "重命名分类",
				"zh-Hant": "重新命名分類",
				"ja": "カテゴリ名を変更",
				"fr": "Renommer la catégorie",
				"de": "Kategorie umbenennen",
				"es": "Cambiar nombre de la categoría",
				"pt": "Renomear categoria",
				"ru": "Переименовать категорию",
			},
			"category.delete": {
				"en": "Delete category",
				"zh-Hans": "删除分类",
				"zh-Hant": "刪除分類",
				"ja": "カテゴリを削除",
				"fr": "Supprimer la catégorie",
				"de": "Kategorie löschen",
				"es": "Eliminar la categoría",
				"pt": "Excluir a categoria",
				"ru": "Удалить категорию",
			},
			"category.deleteMessage": {
				"en": "Workspaces in this category move to Uncategorized; no workspace is deleted.",
				"zh-Hans": "分类里的工作区会回到「未分类」，不会删除工作区。",
				"zh-Hant": "分類中的工作區會回到「未分類」，不會刪除工作區。",
				"ja": "このカテゴリのワークスペースは「未分類」に戻ります。ワークスペースは削除されません。",
				"fr": "Les espaces de travail de cette catégorie passent dans « Sans catégorie » ; aucun espace de travail n’est supprimé.",
				"de": "Die Arbeitsbereiche dieser Kategorie wandern nach „Nicht zugeordnet“; kein Arbeitsbereich wird gelöscht.",
				"es": "Los espacios de trabajo de esta categoría pasan a «Sin categoría»; no se elimina ningún espacio de trabajo.",
				"pt": "Os espaços de trabalho desta categoria passam para «Sem categoria»; nenhum espaço de trabalho é excluído.",
				"ru": "Рабочие области этой категории перейдут в «Без категории»; сами рабочие области не удаляются.",
			},
			"category.namePlaceholder": {
				"en": "Category name, for example Org management / Projects",
				"zh-Hans": "分类名称，例如 组织管理 / 项目管理",
				"zh-Hant": "分類名稱，例如 組織管理 / 專案管理",
				"ja": "カテゴリ名（例: 組織管理 / プロジェクト管理）",
				"fr": "Nom de la catégorie, par exemple Organisation / Projets",
				"de": "Kategoriename, z. B. Organisation / Projekte",
				"es": "Nombre de la categoría, por ejemplo Organización / Proyectos",
				"pt": "Nome da categoria, por exemplo Organização / Projetos",
				"ru": "Название категории, например Организация / Проекты",
			},
			"category.untitled": {
				"en": "Untitled category",
				"zh-Hans": "未命名分类",
				"zh-Hant": "未命名分類",
				"ja": "無題のカテゴリ",
				"fr": "Catégorie sans titre",
				"de": "Kategorie ohne Titel",
				"es": "Categoría sin título",
				"pt": "Categoria sem título",
				"ru": "Категория без названия",
			},
			"plugins.newGroup": {
				"en": "New plugin group",
				"zh-Hans": "新建插件分组",
				"zh-Hant": "新增外掛群組",
				"ja": "新しいプラグイングループ",
				"fr": "Nouveau groupe de plugins",
				"de": "Neue Plugin-Gruppe",
				"es": "Nuevo grupo de plugins",
				"pt": "Novo grupo de plugins",
				"ru": "Новая группа плагинов",
			},
			"plugins.renameGroup": {
				"en": "Rename group",
				"zh-Hans": "重命名分组",
				"zh-Hant": "重新命名群組",
				"ja": "グループ名を変更",
				"fr": "Renommer le groupe",
				"de": "Gruppe umbenennen",
				"es": "Cambiar nombre del grupo",
				"pt": "Renomear grupo",
				"ru": "Переименовать группу",
			},
			"plugins.deleteGroup": {
				"en": "Delete group",
				"zh-Hans": "删除分组",
				"zh-Hant": "刪除群組",
				"ja": "グループを削除",
				"fr": "Supprimer le groupe",
				"de": "Gruppe löschen",
				"es": "Eliminar el grupo",
				"pt": "Excluir o grupo",
				"ru": "Удалить группу",
			},
			"plugins.groupNamePlaceholder": {
				"en": "Group name, for example Tools / Data / Connectors",
				"zh-Hans": "分组名称，例如 工具 / 数据 / 连接",
				"zh-Hant": "群組名稱，例如 工具 / 資料 / 連線",
				"ja": "グループ名（例: ツール / データ / 接続）",
				"fr": "Nom du groupe, par exemple Outils / Données / Connecteurs",
				"de": "Gruppenname, z. B. Werkzeuge / Daten / Verbindungen",
				"es": "Nombre del grupo, por ejemplo Herramientas / Datos / Conexiones",
				"pt": "Nome do grupo, por exemplo Ferramentas / Dados / Conexões",
				"ru": "Название группы, например Инструменты / Данные / Подключения",
			},
			"plugins.dragHint": {
				"en": "Drag into a group",
				"zh-Hans": "拖到分组归类",
				"zh-Hant": "拖曳到群組分類",
				"ja": "グループにドラッグ",
				"fr": "Glisser dans un groupe",
				"de": "In eine Gruppe ziehen",
				"es": "Arrastrar a un grupo",
				"pt": "Arrastar para um grupo",
				"ru": "Перетащите в группу",
			},
			"plugins.restore": {
				"en": "Show again",
				"zh-Hans": "恢复显示",
				"zh-Hant": "恢復顯示",
				"ja": "再表示",
				"fr": "Réafficher",
				"de": "Wieder einblenden",
				"es": "Volver a mostrar",
				"pt": "Mostrar novamente",
				"ru": "Показать снова",
			},
			"plugins.hide": {
				"en": "Hide entry",
				"zh-Hans": "隐藏入口",
				"zh-Hant": "隱藏項目",
				"ja": "エントリを非表示",
				"fr": "Masquer l’entrée",
				"de": "Eintrag ausblenden",
				"es": "Ocultar entrada",
				"pt": "Ocultar entrada",
				"ru": "Скрыть элемент",
			},
			"plugins.empty": {
				"en": "No plugin entries to manage",
				"zh-Hans": "暂无可管理的插件入口",
				"zh-Hant": "尚無可管理的外掛項目",
				"ja": "管理できるプラグインエントリはありません",
				"fr": "Aucune entrée de plugin à gérer",
				"de": "Keine Plugin-Einträge zu verwalten",
				"es": "No hay entradas de plugins que gestionar",
				"pt": "Não há entradas de plugins para gerenciar",
				"ru": "Нет элементов плагинов для управления",
			},
			"plugins.showHidden": {
				"en": "Show hidden entries",
				"zh-Hans": "显示已隐藏入口",
				"zh-Hant": "顯示已隱藏項目",
				"ja": "非表示のエントリを表示",
				"fr": "Afficher les entrées masquées",
				"de": "Ausgeblendete Einträge anzeigen",
				"es": "Mostrar entradas ocultas",
				"pt": "Mostrar entradas ocultas",
				"ru": "Показать скрытые элементы",
			},
			"plugins.showHiddenCount": {
				"en": "Show hidden entries ({n})",
				"zh-Hans": "显示已隐藏入口（{n}）",
				"zh-Hant": "顯示已隱藏項目（{n}）",
				"ja": "非表示のエントリを表示（{n}）",
				"fr": "Afficher les entrées masquées ({n})",
				"de": "Ausgeblendete Einträge anzeigen ({n})",
				"es": "Mostrar entradas ocultas ({n})",
				"pt": "Mostrar entradas ocultas ({n})",
				"ru": "Показать скрытые элементы ({n})",
			},
			"plugins.browsePlugins": {
				"en": "Browse other plugins",
				"zh-Hans": "浏览更多插件",
				"zh-Hant": "瀏覽更多外掛",
				"ja": "他のプラグインを探す",
				"fr": "Parcourir d’autres plugins",
				"de": "Weitere Plugins durchsuchen",
				"es": "Explorar otros plugins",
				"pt": "Explorar outros plugins",
				"ru": "Просмотреть другие плагины",
			},
			"plugins.createPlugin": {
				"en": "Create your plugin",
				"zh-Hans": "创建你的插件",
				"zh-Hant": "建立你的外掛",
				"ja": "プラグインを作成",
				"fr": "Créez votre plugin",
				"de": "Eigenes Plugin erstellen",
				"es": "Crear tu plugin",
				"pt": "Criar seu plugin",
				"ru": "Создать свой плагин",
			},
			"plugins.createPrompt": {
				"en": "Create a DSH plugin with a left sidebar entry.",
				"zh-Hans": "创建一个带左侧栏入口的 DSH 插件。",
				"zh-Hant": "建立一個帶左側欄入口的 DSH 外掛。",
				"ja": "左サイドバーにエントリを持つ DSH プラグインを作成します。",
				"fr": "Créez un plugin DSH avec une entrée dans la barre latérale gauche.",
				"de": "Erstelle ein DSH-Plugin mit einem Eintrag in der linken Seitenleiste.",
				"es": "Crea un plugin de DSH con una entrada en la barra lateral izquierda.",
				"pt": "Crie um plugin do DSH com uma entrada na barra lateral esquerda.",
				"ru": "Создайте плагин DSH с элементом на левой боковой панели.",
			},
			"plugins.untitledGroup": {
				"en": "Untitled group",
				"zh-Hans": "未命名分组",
				"zh-Hant": "未命名群組",
				"ja": "無題のグループ",
				"fr": "Groupe sans titre",
				"de": "Gruppe ohne Titel",
				"es": "Grupo sin título",
				"pt": "Grupo sem título",
				"ru": "Группа без названия",
			},
			"session.rename": {
				"en": "Rename session",
				"zh-Hans": "重命名会话",
				"zh-Hant": "重新命名會話",
				"ja": "セッション名を変更",
				"fr": "Renommer la session",
				"de": "Sitzung umbenennen",
				"es": "Cambiar nombre de la sesión",
				"pt": "Renomear sessão",
				"ru": "Переименовать сеанс",
			},
			"session.pin": {
				"en": "Pin",
				"zh-Hans": "置顶",
				"zh-Hant": "釘選",
				"ja": "ピン留め",
				"fr": "Épingler",
				"de": "Anheften",
				"es": "Fijar",
				"pt": "Fixar",
				"ru": "Закрепить",
			},
			"session.unpin": {
				"en": "Unpin",
				"zh-Hans": "取消置顶",
				"zh-Hant": "取消釘選",
				"ja": "ピン留めを解除",
				"fr": "Ne plus épingler",
				"de": "Anheftung aufheben",
				"es": "Dejar de fijar",
				"pt": "Desafixar",
				"ru": "Открепить",
			},
			"session.fork": {
				"en": "Fork session",
				"zh-Hans": "分叉会话",
				"zh-Hant": "分支會話",
				"ja": "セッションを分岐",
				"fr": "Créer une branche de la session",
				"de": "Sitzung verzweigen",
				"es": "Bifurcar la sesión",
				"pt": "Criar ramificação da sessão",
				"ru": "Создать ответвление сеанса",
			},
			"session.copyId": {
				"en": "Copy session ID",
				"zh-Hans": "复制会话 ID",
				"zh-Hant": "複製會話 ID",
				"ja": "セッション ID をコピー",
				"fr": "Copier l’ID de session",
				"de": "Sitzungs-ID kopieren",
				"es": "Copiar el ID de sesión",
				"pt": "Copiar ID da sessão",
				"ru": "Копировать ID сеанса",
			},
			"session.archive": {
				"en": "Archive",
				"zh-Hans": "归档",
				"zh-Hant": "封存",
				"ja": "アーカイブ",
				"fr": "Archiver",
				"de": "Archivieren",
				"es": "Archivar",
				"pt": "Arquivar",
				"ru": "Архивировать",
			},
			"session.unarchive": {
				"en": "Unarchive",
				"zh-Hans": "取消归档",
				"zh-Hant": "取消封存",
				"ja": "アーカイブを解除",
				"fr": "Désarchiver",
				"de": "Aus dem Archiv holen",
				"es": "Desarchivar",
				"pt": "Desarquivar",
				"ru": "Вернуть из архива",
			},
			"session.more": {
				"en": "More actions",
				"zh-Hans": "更多操作",
				"zh-Hant": "更多操作",
				"ja": "その他の操作",
				"fr": "Plus d’actions",
				"de": "Weitere Aktionen",
				"es": "Más acciones",
				"pt": "Mais ações",
				"ru": "Другие действия",
			},
			"session.untitled": {
				"en": "Untitled",
				"zh-Hans": "未命名",
				"zh-Hant": "未命名",
				"ja": "無題",
				"fr": "Sans titre",
				"de": "Ohne Titel",
				"es": "Sin título",
				"pt": "Sem título",
				"ru": "Без названия",
			},
			"session.empty": {
				"en": "No sessions yet",
				"zh-Hans": "还没有会话",
				"zh-Hant": "尚無會話",
				"ja": "セッションはまだありません",
				"fr": "Aucune session pour l’instant",
				"de": "Noch keine Sitzungen",
				"es": "Aún no hay sesiones",
				"pt": "Ainda não há sessões",
				"ru": "Сеансов пока нет",
			},
			"session.noMatch": {
				"en": "No matching sessions",
				"zh-Hans": "没有匹配的会话",
				"zh-Hant": "沒有符合的會話",
				"ja": "一致するセッションはありません",
				"fr": "Aucune session correspondante",
				"de": "Keine passenden Sitzungen",
				"es": "No hay sesiones coincidentes",
				"pt": "Nenhuma sessão correspondente",
				"ru": "Нет подходящих сеансов",
			},
			"session.showMore": {
				"en": "Show more",
				"zh-Hans": "显示更多",
				"zh-Hant": "顯示更多",
				"ja": "さらに表示",
				"fr": "Afficher plus",
				"de": "Mehr anzeigen",
				"es": "Mostrar más",
				"pt": "Mostrar mais",
				"ru": "Показать ещё",
			},
			"session.showLess": {
				"en": "Show less",
				"zh-Hans": "显示更少",
				"zh-Hant": "顯示較少",
				"ja": "表示を減らす",
				"fr": "Afficher moins",
				"de": "Weniger anzeigen",
				"es": "Mostrar menos",
				"pt": "Mostrar menos",
				"ru": "Показать меньше",
			},
			"session.runningTitle": {
				"en": "This session is still running",
				"zh-Hans": "该会话仍在运行",
				"zh-Hant": "此會話仍在執行",
				"ja": "このセッションはまだ実行中です",
				"fr": "Cette session est toujours en cours",
				"de": "Diese Sitzung läuft noch",
				"es": "Esta sesión sigue en ejecución",
				"pt": "Esta sessão ainda está em execução",
				"ru": "Этот сеанс всё ещё выполняется",
			},
			"session.runningMessage": {
				"en": "Stop it and archive?",
				"zh-Hans": "停止它并归档？",
				"zh-Hant": "停止並封存？",
				"ja": "停止してアーカイブしますか？",
				"fr": "L’arrêter et l’archiver ?",
				"de": "Anhalten und archivieren?",
				"es": "¿Detenerla y archivarla?",
				"pt": "Parar e arquivar?",
				"ru": "Остановить и архивировать?",
			},
			"session.stopArchive": {
				"en": "Stop and archive",
				"zh-Hans": "停止并归档",
				"zh-Hant": "停止並封存",
				"ja": "停止してアーカイブ",
				"fr": "Arrêter et archiver",
				"de": "Anhalten und archivieren",
				"es": "Detener y archivar",
				"pt": "Parar e arquivar",
				"ru": "Остановить и архивировать",
			},
			"workspace.newSession": {
				"en": "New session",
				"zh-Hans": "新建会话",
				"zh-Hant": "新增會話",
				"ja": "新しいセッション",
				"fr": "Nouvelle session",
				"de": "Neue Sitzung",
				"es": "Nueva sesión",
				"pt": "Nova sessão",
				"ru": "Новый сеанс",
			},
			"workspace.rename": {
				"en": "Rename workspace",
				"zh-Hans": "重命名工作区",
				"zh-Hant": "重新命名工作區",
				"ja": "ワークスペース名を変更",
				"fr": "Renommer l’espace de travail",
				"de": "Arbeitsbereich umbenennen",
				"es": "Cambiar nombre del espacio de trabajo",
				"pt": "Renomear espaço de trabalho",
				"ru": "Переименовать рабочую область",
			},
			"workspace.copyPath": {
				"en": "Copy path",
				"zh-Hans": "复制路径",
				"zh-Hant": "複製路徑",
				"ja": "パスをコピー",
				"fr": "Copier le chemin",
				"de": "Pfad kopieren",
				"es": "Copiar la ruta",
				"pt": "Copiar caminho",
				"ru": "Копировать путь",
			},
			"workspace.moveTo": {
				"en": "Move to category",
				"zh-Hans": "移入分类",
				"zh-Hant": "移至分類",
				"ja": "カテゴリへ移動",
				"fr": "Déplacer vers une catégorie",
				"de": "In Kategorie verschieben",
				"es": "Mover a una categoría",
				"pt": "Mover para uma categoria",
				"ru": "Переместить в категорию",
			},
			"workspace.moveOut": {
				"en": "Remove from category",
				"zh-Hans": "移出分类",
				"zh-Hant": "移出分類",
				"ja": "カテゴリから外す",
				"fr": "Retirer de la catégorie",
				"de": "Aus Kategorie entfernen",
				"es": "Quitar de la categoría",
				"pt": "Remover da categoria",
				"ru": "Убрать из категории",
			},
			"workspace.delete": {
				"en": "Delete workspace",
				"zh-Hans": "删除工作区",
				"zh-Hant": "刪除工作區",
				"ja": "ワークスペースを削除",
				"fr": "Supprimer l’espace de travail",
				"de": "Arbeitsbereich löschen",
				"es": "Eliminar el espacio de trabajo",
				"pt": "Excluir espaço de trabalho",
				"ru": "Удалить рабочую область",
			},
			"workspace.deleteMessage": {
				"en": "Removes it from this list only; the folder on disk is untouched.",
				"zh-Hans": "仅从列表移除，不会删除磁盘上的目录。",
				"zh-Hant": "僅從清單移除，不會刪除磁碟上的目錄。",
				"ja": "一覧から外すだけで、ディスク上のフォルダーは削除されません。",
				"fr": "Retiré de cette liste uniquement ; le dossier sur le disque n’est pas touché.",
				"de": "Wird nur aus dieser Liste entfernt; der Ordner auf der Festplatte bleibt.",
				"es": "Solo lo quita de esta lista; la carpeta del disco no se toca.",
				"pt": "Remove apenas desta lista; a pasta no disco não é alterada.",
				"ru": "Убирается только из списка; папка на диске остаётся.",
			},
			"workspace.more": {
				"en": "Workspace actions",
				"zh-Hans": "工作区操作",
				"zh-Hant": "工作區操作",
				"ja": "ワークスペースの操作",
				"fr": "Actions de l’espace de travail",
				"de": "Arbeitsbereich-Aktionen",
				"es": "Acciones del espacio de trabajo",
				"pt": "Ações do espaço de trabalho",
				"ru": "Действия с рабочей областью",
			},
			"workspace.dropHint": {
				"en": "Drop a workspace here, or click + to create one",
				"zh-Hans": "把工作区拖到这里，或点 + 新建",
				"zh-Hant": "將工作區拖曳到這裡，或按 + 新增",
				"ja": "ここにワークスペースをドラッグするか、+ で新規作成します",
				"fr": "Déposez un espace de travail ici, ou cliquez sur + pour en créer un",
				"de": "Arbeitsbereich hierher ziehen oder + zum Anlegen nutzen",
				"es": "Suelte un espacio de trabajo aquí o pulse + para crear uno",
				"pt": "Solte um espaço de trabalho aqui ou clique em + para criar um",
				"ru": "Перетащите рабочую область сюда или нажмите +, чтобы создать",
			},
			"workspace.empty": {
				"en": "No workspaces yet — click + above to add a folder",
				"zh-Hans": "还没有工作区，点上方 + 添加一个目录",
				"zh-Hant": "尚無工作區，請按上方 + 新增目錄",
				"ja": "ワークスペースがありません。上の + からフォルダーを追加してください",
				"fr": "Aucun espace de travail — cliquez sur + ci-dessus pour ajouter un dossier",
				"de": "Noch keine Arbeitsbereiche — über + oben einen Ordner hinzufügen",
				"es": "Aún no hay espacios de trabajo: pulse + arriba para añadir una carpeta",
				"pt": "Ainda não há espaços de trabalho — clique em + acima para adicionar uma pasta",
				"ru": "Рабочих областей пока нет — нажмите + выше, чтобы добавить папку",
			},
			"options.title": {
				"en": "View options",
				"zh-Hans": "视图选项",
				"zh-Hant": "檢視選項",
				"ja": "表示オプション",
				"fr": "Options d’affichage",
				"de": "Ansichtsoptionen",
				"es": "Opciones de vista",
				"pt": "Opções de exibição",
				"ru": "Параметры вида",
			},
			"options.archivedHeader": {
				"en": "Archived sessions",
				"zh-Hans": "已归档会话",
				"zh-Hant": "已封存會話",
				"ja": "アーカイブ済みセッション",
				"fr": "Sessions archivées",
				"de": "Archivierte Sitzungen",
				"es": "Sesiones archivadas",
				"pt": "Sessões arquivadas",
				"ru": "Архивные сеансы",
			},
			"options.archivedDefault": {
				"en": "Hide archived",
				"zh-Hans": "隐藏已归档",
				"zh-Hant": "隱藏已封存",
				"ja": "アーカイブを非表示",
				"fr": "Masquer les archivées",
				"de": "Archivierte ausblenden",
				"es": "Ocultar archivadas",
				"pt": "Ocultar arquivadas",
				"ru": "Скрыть архивные",
			},
			"options.archivedShow": {
				"en": "All conversations (show archived)",
				"zh-Hans": "全部对话（显示已归档）",
				"zh-Hant": "全部對話（顯示已封存）",
				"ja": "すべての会話（アーカイブを含む）",
				"fr": "Toutes les conversations (archives incluses)",
				"de": "Alle Unterhaltungen (archivierte anzeigen)",
				"es": "Todas las conversaciones (mostrar archivadas)",
				"pt": "Todas as conversas (mostrar arquivadas)",
				"ru": "Все беседы (показывать архивные)",
			},
			"options.archivedOnly": {
				"en": "Archived only",
				"zh-Hans": "仅显示已归档",
				"zh-Hant": "僅顯示已封存",
				"ja": "アーカイブのみ",
				"fr": "Archivées uniquement",
				"de": "Nur archivierte",
				"es": "Solo archivadas",
				"pt": "Somente arquivadas",
				"ru": "Только архивные",
			},
			"options.sortHeader": {
				"en": "Workspace order",
				"zh-Hans": "工作区排序",
				"zh-Hant": "工作區排序",
				"ja": "ワークスペースの並び順",
				"fr": "Ordre des espaces de travail",
				"de": "Reihenfolge der Arbeitsbereiche",
				"es": "Orden de los espacios de trabajo",
				"pt": "Ordem dos espaços de trabalho",
				"ru": "Порядок рабочих областей",
			},
			"options.sortManual": {
				"en": "Manual order",
				"zh-Hans": "不自动排序",
				"zh-Hant": "不自動排序",
				"ja": "手動",
				"fr": "Ordre manuel",
				"de": "Manuelle Reihenfolge",
				"es": "Orden manual",
				"pt": "Ordem manual",
				"ru": "Вручную",
			},
			"options.sortName": {
				"en": "By name",
				"zh-Hans": "按名称排序",
				"zh-Hant": "依名稱排序",
				"ja": "名前順",
				"fr": "Par nom",
				"de": "Nach Name",
				"es": "Por nombre",
				"pt": "Por nome",
				"ru": "По имени",
			},
			"options.sortTime": {
				"en": "By latest session",
				"zh-Hans": "按最近会话排序",
				"zh-Hant": "依最近會話排序",
				"ja": "最新セッション順",
				"fr": "Par session la plus récente",
				"de": "Nach letzter Sitzung",
				"es": "Por sesión más reciente",
				"pt": "Por sessão mais recente",
				"ru": "По последнему сеансу",
			},
			"options.newHeader": {
				"en": "New group or workspace",
				"zh-Hans": "新建分组或工作区",
				"zh-Hant": "新增群組或工作區",
				"ja": "新規カテゴリ / ワークスペース",
				"fr": "Nouveau groupe ou espace de travail",
				"de": "Neue Gruppe oder neuer Arbeitsbereich",
				"es": "Nuevo grupo o espacio de trabajo",
				"pt": "Novo grupo ou espaço de trabalho",
				"ru": "Новая группа или рабочая область",
			},
			"options.newGroup": {
				"en": "New category",
				"zh-Hans": "新建分组",
				"zh-Hant": "新增分類",
				"ja": "新しいカテゴリ",
				"fr": "Nouvelle catégorie",
				"de": "Neue Kategorie",
				"es": "Nueva categoría",
				"pt": "Nova categoria",
				"ru": "Новая категория",
			},
			"options.newWorkspace": {
				"en": "New workspace",
				"zh-Hans": "新建工作区",
				"zh-Hant": "新增工作區",
				"ja": "新しいワークスペース",
				"fr": "Nouvel espace de travail",
				"de": "Neuer Arbeitsbereich",
				"es": "Nuevo espacio de trabajo",
				"pt": "Novo espaço de trabalho",
				"ru": "Новая рабочая область",
			},
			"options.language": {
				"en": "Language",
				"zh-Hans": "界面语言",
				"zh-Hant": "介面語言",
				"ja": "言語",
				"fr": "Langue",
				"de": "Sprache",
				"es": "Idioma",
				"pt": "Idioma",
				"ru": "Язык",
			},
			"options.langAuto": {
				"en": "Follow browser",
				"zh-Hans": "跟随浏览器",
				"zh-Hant": "跟隨瀏覽器",
				"ja": "ブラウザに合わせる",
				"fr": "Suivre le navigateur",
				"de": "Browser folgen",
				"es": "Seguir el navegador",
				"pt": "Seguir o navegador",
				"ru": "Как в браузере",
			},
			"search.placeholder": {
				"en": "Filter workspaces and sessions…",
				"zh-Hans": "筛选工作区与会话…",
				"zh-Hant": "篩選工作區與會話…",
				"ja": "ワークスペースとセッションを絞り込む…",
				"fr": "Filtrer les espaces de travail et les sessions…",
				"de": "Arbeitsbereiche und Sitzungen filtern…",
				"es": "Filtrar espacios de trabajo y sesiones…",
				"pt": "Filtrar espaços de trabalho e sessões…",
				"ru": "Фильтр рабочих областей и сеансов…",
			},
			"search.expandHits": {
				"en": "Expand all hits",
				"zh-Hans": "展开全部命中",
				"zh-Hant": "展開全部符合項目",
				"ja": "一致する項目をすべて展開",
				"fr": "Déplier tous les résultats",
				"de": "Alle Treffer ausklappen",
				"es": "Expandir todos los resultados",
				"pt": "Expandir todos os resultados",
				"ru": "Развернуть все совпадения",
			},
			"search.collapseHits": {
				"en": "Collapse hits",
				"zh-Hans": "收起命中",
				"zh-Hant": "收合符合項目",
				"ja": "一致する項目を折りたたむ",
				"fr": "Replier les résultats",
				"de": "Treffer einklappen",
				"es": "Contraer los resultados",
				"pt": "Recolher os resultados",
				"ru": "Свернуть совпадения",
			},
			"mode.title": {
				"en": "View",
				"zh-Hans": "视图切换",
				"zh-Hant": "檢視切換",
				"ja": "表示",
				"fr": "Affichage",
				"de": "Ansicht",
				"es": "Vista",
				"pt": "Visualização",
				"ru": "Вид",
			},
			"mode.native": {
				"en": "Native list",
				"zh-Hans": "原生列表",
				"zh-Hant": "原生清單",
				"ja": "標準リスト",
				"fr": "Liste native",
				"de": "Native Liste",
				"es": "Lista nativa",
				"pt": "Lista nativa",
				"ru": "Встроенный список",
			},
			"mode.cards": {
				"en": "Card sidebar",
				"zh-Hans": "卡片侧栏",
				"zh-Hant": "卡片側欄",
				"ja": "カード表示",
				"fr": "Barre latérale en cartes",
				"de": "Karten-Seitenleiste",
				"es": "Barra lateral de tarjetas",
				"pt": "Barra lateral de cartões",
				"ru": "Боковая панель с карточками",
			},
			"mode.toNative": {
				"en": "Switch to the native workspace list",
				"zh-Hans": "切换为原生工作区列表",
				"zh-Hant": "切換為原生工作區清單",
				"ja": "標準のワークスペース一覧に切り替える",
				"fr": "Passer à la liste native des espaces de travail",
				"de": "Zur nativen Arbeitsbereichsliste wechseln",
				"es": "Cambiar a la lista nativa de espacios de trabajo",
				"pt": "Mudar para a lista nativa de espaços de trabalho",
				"ru": "Переключиться на встроенный список рабочих областей",
			},
			"mode.toCards": {
				"en": "Switch to the card sidebar",
				"zh-Hans": "切换为卡片侧栏",
				"zh-Hant": "切換為卡片側欄",
				"ja": "カード表示に切り替える",
				"fr": "Passer à la barre latérale en cartes",
				"de": "Zur Karten-Seitenleiste wechseln",
				"es": "Cambiar a la barra lateral de tarjetas",
				"pt": "Mudar para a barra lateral de cartões",
				"ru": "Переключиться на боковую панель с карточками",
			},
			"error.noDirectoryPicker": {
				"en": "No directory picker is available",
				"zh-Hans": "没有可用的目录选择器",
				"zh-Hant": "沒有可用的目錄選擇器",
				"ja": "ディレクトリ選択を利用できません",
				"fr": "Aucun sélecteur de dossier disponible",
				"de": "Keine Ordnerauswahl verfügbar",
				"es": "No hay selector de carpetas disponible",
				"pt": "Nenhum seletor de pasta disponível",
				"ru": "Нет средства выбора папки",
			},
			"error.workspacesUnavailable": {
				"en": "The workspaces service is unavailable",
				"zh-Hans": "workspaces 服务不可用",
				"zh-Hant": "workspaces 服務無法使用",
				"ja": "workspaces サービスを利用できません",
				"fr": "Le service workspaces est indisponible",
				"de": "Der Dienst workspaces ist nicht verfügbar",
				"es": "El servicio workspaces no está disponible",
				"pt": "O serviço workspaces não está disponível",
				"ru": "Служба workspaces недоступна",
			},
			"error.sessionsUnavailable": {
				"en": "The sessions service is unavailable",
				"zh-Hans": "sessions 服务不可用",
				"zh-Hant": "sessions 服務無法使用",
				"ja": "sessions サービスを利用できません",
				"fr": "Le service sessions est indisponible",
				"de": "Der Dienst sessions ist nicht verfügbar",
				"es": "El servicio sessions no está disponible",
				"pt": "O serviço sessions não está disponível",
				"ru": "Служба sessions недоступна",
			},
			"error.pinUnavailable": {
				"en": "Pin is unavailable",
				"zh-Hans": "置顶不可用",
				"zh-Hant": "釘選無法使用",
				"ja": "ピン留めを利用できません",
				"fr": "L’épinglage est indisponible",
				"de": "Anheften ist nicht verfügbar",
				"es": "Fijar no está disponible",
				"pt": "Fixar não está disponível",
				"ru": "Закрепление недоступно",
			},
			"error.unpinUnavailable": {
				"en": "Unpin is unavailable",
				"zh-Hans": "取消置顶不可用",
				"zh-Hant": "取消釘選無法使用",
				"ja": "ピン留めの解除を利用できません",
				"fr": "Le retrait de l’épingle est indisponible",
				"de": "Anheftung aufheben ist nicht verfügbar",
				"es": "Dejar de fijar no está disponible",
				"pt": "Desafixar não está disponível",
				"ru": "Открепление недоступно",
			},
			"error.forkUnavailable": {
				"en": "Fork is unavailable",
				"zh-Hans": "分叉不可用",
				"zh-Hant": "分支無法使用",
				"ja": "セッション分岐を利用できません",
				"fr": "La création de branche est indisponible",
				"de": "Verzweigen ist nicht verfügbar",
				"es": "Bifurcar no está disponible",
				"pt": "Criar ramificação não está disponível",
				"ru": "Создание ответвления недоступно",
			},
			"error.renameFailed": {
				"en": "Rename failed",
				"zh-Hans": "重命名失败",
				"zh-Hant": "重新命名失敗",
				"ja": "名前の変更に失敗しました",
				"fr": "Le renommage a échoué",
				"de": "Umbenennen fehlgeschlagen",
				"es": "Error al cambiar el nombre",
				"pt": "Falha ao renomear",
				"ru": "Не удалось переименовать",
			},
		}

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
			const row = STRINGS[key]
			if (row === undefined) return key
			const chain = LANG_FALLBACK[currentLang()] || LANG_FALLBACK.en
			for (const code of chain) {
				const text = row[code]
				if (typeof text === 'string') return text
			}
			return key
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
			workspaceSort: 'manual',
			workspaceSortDir: 'asc',
			lang: 'auto',
			pluginCollapsed: true,
			pluginGroups: [],
			pluginAssign: {},
			pluginHidden: [],
			pluginShowHidden: false
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
				workspaceSort: ['manual', 'name', 'time'].indexOf(merged.workspaceSort) === -1 ? 'manual' : merged.workspaceSort,
				workspaceSortDir: merged.workspaceSortDir === 'desc' ? 'desc' : 'asc',
				lang: sanitizeLang(merged.lang),
				pluginCollapsed: merged.pluginCollapsed !== false,
				pluginGroups,
				pluginAssign: asRecord(merged.pluginAssign),
				pluginHidden: Array.isArray(merged.pluginHidden) ? merged.pluginHidden.filter((v) => typeof v === 'string') : [],
				pluginShowHidden: merged.pluginShowHidden === true
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

			const renderItem = (item, index) =>
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
										// Hover opens the sibling panel, and hovering a plain row
										// closes it again — the usual cascading-menu behaviour.
										if (Array.isArray(item.submenu)) open(item, event.currentTarget)
										else setFlyout(null)
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
								item.icon ? h(Icon, { name: item.icon, size: 13 }) : null,
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
				h('div', { className: 'dsc-menu', style, ref, role: 'menu' }, props.items.map(renderItem)),
				flyout === null
					? null
					: h('div', { className: 'dsc-menu dsc-menu-flyout', style: flyoutStyle, ref: flyoutRef, role: 'menu' }, flyout.items.map(renderItem))
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
				{ className: 'dsc-card dsc-plugincard' },
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
				{ className: 'dsc-card dsc-wscard' },
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
.dsc-menu{min-width:180px;max-width:260px;max-height:calc(100vh - 16px);overflow-y:auto;padding:4px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-overlay);box-shadow:0 8px 24px rgba(0,0,0,.18);display:flex;flex-direction:column;gap:1px}
.dsc-menu-item{display:flex;align-items:center;gap:6px;height:26px;padding:0 8px;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-primary);font-size:12px;cursor:pointer;text-align:left}
.dsc-menu-item:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 10%,transparent)}
.dsc-menu-danger{color:var(--dsw-alias-state-error-primary)}
.dsc-menu-sep{height:1px;margin:3px 4px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 10%,transparent)}
.dsc-menu-head{padding:4px 8px 2px;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.dsc-menu-label{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsc-menu-caret{margin-left:auto;flex:none;display:inline-flex;align-items:center;color:var(--dsw-alias-label-tertiary)}
.dsc-menu-item-open{background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent)}
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
