import type { Technology } from '$types';
import { describe, expect, it } from 'vitest';
import { filterTechnologyGroups, matchesTechnologyQuery } from './technologySearch';

function technology(
	id: string,
	name: string,
	description: string,
	unlockedItems: string[] = [],
	unlockedBuildings: string[] = [],
	isAncient = false
): Technology {
	return {
		id,
		localized_name: name,
		description,
		details: {
			unlock_build_objects: unlockedBuildings,
			unlock_item_recipes: unlockedItems,
			icon_name: '',
			require_defeat_tower_boss: '',
			require_technology: '',
			require_research_id: '',
			is_boss_technology: isAncient,
			level_cap: 1,
			tier: 1,
			cost: 1,
			icon: ''
		}
	};
}

const technologies: Record<string, Technology> = {
	PrimitiveWorkbench: technology(
		'PrimitiveWorkbench',
		'Primitive Workbench',
		'Build basic equipment',
		[],
		['Workbench']
	),
	MegaSphere: technology('MegaSphere', 'Mega Sphere', 'Unlock capture gear', ['Sphere_Tera']),
	AncientLantern: technology('AncientLantern', 'Hip Lantern', 'Lights the night', [], [], true)
};
const names = {
	items: { sphere_tera: 'Hyper Sphere' },
	buildings: { workbench: 'Primitive Workbench Structure' }
};

describe('matchesTechnologyQuery', (): void => {
	it.each([
		['workbench', 'PrimitiveWorkbench'],
		['primitiveworkbench', 'PrimitiveWorkbench'],
		['basic equipment', 'PrimitiveWorkbench'],
		['hyper sphere', 'MegaSphere'],
		['sphere_tera', 'MegaSphere'],
		['primitive workbench structure', 'PrimitiveWorkbench']
	])('matches %s through the expected searchable field', (query: string, id: string): void => {
		expect(matchesTechnologyQuery(technologies[id], query, names)).toBe(true);
	});
});

describe('filterTechnologyGroups', (): void => {
	const groups = {
		1: { regular: ['PrimitiveWorkbench', 'MegaSphere'], ancient: null },
		2: { regular: [], ancient: 'AncientLantern' }
	};

	it('keeps matching cards in their level groups and removes empty levels', (): void => {
		expect(filterTechnologyGroups(groups, 'sphere', technologies, names)).toEqual({
			1: { regular: ['MegaSphere'], ancient: null }
		});
	});

	it('returns all regular and ancient technologies for an empty query', (): void => {
		expect(filterTechnologyGroups(groups, '  ', technologies, names)).toEqual(groups);
	});
});
