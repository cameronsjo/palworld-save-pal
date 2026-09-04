import { PalGender, Rarity, type DynamicItem, type Item, type ItemContainerSlot } from '$types';

export const ITEM_RARITIES: readonly Rarity[] = [
	Rarity.Common,
	Rarity.Uncommon,
	Rarity.Rare,
	Rarity.Epic,
	Rarity.Legendary
];

export interface ItemStackSelection {
	itemId: string;
	count: number;
}

export interface AppendItemStacksResult {
	slots: ItemContainerSlot[];
	addedCount: number;
	skippedCount: number;
}

export function filterItems(
	items: readonly Item[],
	query: string,
	selectedRarities: ReadonlySet<Rarity>
): Item[] {
	const normalizedQuery = query.trim().toLocaleLowerCase();

	return items.filter((item: Item): boolean => {
		if (selectedRarities.size > 0 && !selectedRarities.has(item.details.rarity)) {
			return false;
		}
		if (!normalizedQuery) return true;

		const searchableText = [
			item.info.localized_name,
			item.id,
			item.info.description,
			Rarity[item.details.rarity]
		]
			.join(' ')
			.toLocaleLowerCase();
		return searchableText.includes(normalizedQuery);
	});
}

export function appendItemStacksToEmptySlots(
	slots: readonly ItemContainerSlot[],
	selections: readonly ItemStackSelection[],
	items: readonly Item[],
	cheatMode: boolean
): AppendItemStacksResult {
	const itemById = new Map(items.map((item: Item): [string, Item] => [item.id, item]));
	const updatedSlots = slots.map(
		(slot: ItemContainerSlot): ItemContainerSlot => ({
			...slot,
			dynamic_item: slot.dynamic_item ? { ...slot.dynamic_item } : undefined
		})
	);
	const emptySlots = updatedSlots.filter(
		(slot: ItemContainerSlot): boolean => slot.static_id === 'None' || slot.static_id === ''
	);
	let addedCount = 0;

	for (const selection of selections) {
		const targetSlot = emptySlots[addedCount];
		if (!targetSlot) break;

		const item = itemById.get(selection.itemId);
		if (!item) continue;

		const maximumCount = getMaximumStackCount(item, cheatMode);
		const requestedCount = Number.isFinite(selection.count) ? Math.max(1, selection.count) : 1;
		targetSlot.static_id = item.id;
		targetSlot.count = Math.min(requestedCount, maximumCount);
		targetSlot.dynamic_item = createDynamicItem(item);
		addedCount += 1;
	}

	return {
		slots: updatedSlots,
		addedCount,
		skippedCount: Math.max(0, selections.length - addedCount)
	};
}

export function getMaximumStackCount(item: Item, cheatMode: boolean): number {
	const configuredMaximum = Math.max(1, item.details.max_stack_count || 1);
	return configuredMaximum === 9999 && cheatMode ? 999999999 : configuredMaximum;
}

function createDynamicItem(item: Item): DynamicItem | undefined {
	const dynamicDetails = item.details.dynamic;
	if (!dynamicDetails) return undefined;

	return {
		local_id: '00000000-0000-0000-0000-000000000000',
		static_id: item.id,
		durability: dynamicDetails.durability,
		remaining_bullets: dynamicDetails.magazine_size ?? 0,
		type: dynamicDetails.type,
		gender: PalGender.FEMALE,
		talent_hp: 0,
		talent_shot: 0,
		talent_defense: 0,
		learned_skills: [],
		active_skills: [],
		passive_skills: [],
		modified: true
	};
}
