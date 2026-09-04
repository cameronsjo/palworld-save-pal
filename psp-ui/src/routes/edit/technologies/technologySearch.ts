import type { Technology } from '$types';

export interface TechnologyGroup {
	regular: string[];
	ancient: string | null;
}

export interface TechnologySearchNames {
	items: Readonly<Record<string, string>>;
	buildings: Readonly<Record<string, string>>;
}

export function filterTechnologyGroups(
	groups: Readonly<Record<number, TechnologyGroup>>,
	query: string,
	technologies: Readonly<Record<string, Technology>>,
	names: TechnologySearchNames
): Record<number, TechnologyGroup> {
	const normalizedQuery = query.trim().toLocaleLowerCase();
	if (!normalizedQuery) {
		return Object.fromEntries(
			Object.entries(groups).map(([level, group]: [string, TechnologyGroup]) => [
				level,
				{ regular: [...group.regular], ancient: group.ancient }
			])
		);
	}

	return Object.fromEntries(
		Object.entries(groups)
			.map(([level, group]: [string, TechnologyGroup]) => {
				const regular = group.regular.filter((technologyId: string): boolean =>
					matchesTechnologyQuery(technologies[technologyId], normalizedQuery, names)
				);
				let ancient: string | null = null;
				if (
					group.ancient &&
					matchesTechnologyQuery(technologies[group.ancient], normalizedQuery, names)
				) {
					ancient = group.ancient;
				}
				return [level, { regular, ancient }] as const;
			})
			.filter(([, group]: readonly [string, TechnologyGroup]): boolean =>
				Boolean(group.regular.length || group.ancient)
			)
	);
}

export function matchesTechnologyQuery(
	technology: Technology | undefined,
	normalizedQuery: string,
	names: TechnologySearchNames
): boolean {
	if (!technology) return false;

	const unlockedItemNames = technology.details.unlock_item_recipes.map(
		(itemId: string): string => names.items[itemId.toLocaleLowerCase()] ?? itemId
	);
	const unlockedBuildingNames = technology.details.unlock_build_objects.map(
		(buildingId: string): string => names.buildings[buildingId.toLocaleLowerCase()] ?? buildingId
	);
	const searchableText = [
		technology.localized_name,
		technology.id,
		technology.description,
		...technology.details.unlock_item_recipes,
		...unlockedItemNames,
		...technology.details.unlock_build_objects,
		...unlockedBuildingNames
	]
		.join(' ')
		.toLocaleLowerCase();

	return searchableText.includes(normalizedQuery);
}
