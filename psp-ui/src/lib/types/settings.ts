export type SupportedLanguage =
	| 'de'
	| 'en'
	| 'es'
	| 'es-mx'
	| 'fr'
	| 'it'
	| 'id-id'
	| 'ko'
	| 'pl'
	| 'pt-br'
	| 'ru'
	| 'th'
	| 'tr'
	| 'vi'
	| 'zh-hans'
	| 'zh-hant';

export const languages: Record<SupportedLanguage, string> = {
	de: 'Deutsch',
	en: 'English',
	es: 'Español',
	'es-mx': 'Español (México)',
	fr: 'Français',
	'id-id': 'Bahasa Indonesia',
	it: 'Italiano',
	ko: '한국어',
	pl: 'Polski',
	'pt-br': 'Português',
	ru: 'Русский',
	th: 'ไทย',
	tr: 'Türkçe',
	vi: 'Tiếng Việt',
	'zh-hans': '简体中文',
	'zh-hant': '繁體中文'
};

export interface AppSettings {
	language: SupportedLanguage;
	save_dir?: string;
	clone_prefix?: string;
	new_pal_prefix?: string;
	debug_mode?: boolean;
	cheat_mode?: boolean;
	/**
	 * The backend mounts the save it edits, so write-back to disk is available
	 * even though this is not a desktop build. Computed server-side on every
	 * `get_settings` emit — the NavBar echoes this whole object back through
	 * `update_settings`, so the value here is never what the server reads.
	 *
	 * A RENDERING HINT ONLY. Nothing may authorize on it: the write path is
	 * pinned server-side (`pin_write_target_under_root`), which is the actual
	 * control.
	 */
	server_managed?: boolean;
}
