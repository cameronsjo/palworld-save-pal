import { ItemTypeA, ItemTypeB, Rarity, type Item, type ItemContainerSlot } from '$types';
import { describe, expect, it } from 'vitest';
import { appendItemStacksToEmptySlots, filterItems } from './bulkItemPicker';

function item(
	id: string,
	name: string,
	rarity: Rarity,
	description = '',
	maxStackCount = 99
): Item {
	return {
		id,
		info: { localized_name: name, description },
		details: {
			group: 'Common',
			weight: 1,
			type_a: ItemTypeA.Material,
			type_b: ItemTypeB.None,
			price: 1,
			icon: '',
			rank: 1,
			rarity,
			max_stack_count: maxStackCount,
			sort_id: 1
		}
	};
}

const items: Item[] = [
	item('Pal_crystal', 'Paldium Fragment', Rarity.Common, 'A blue crafting material'),
	item('LegendaryOldBow', 'Old Bow Schematic 4', Rarity.Legendary, 'Legendary weapon plans'),
	item('RareSphere', 'Giga Sphere', Rarity.Rare, 'A stronger capture sphere')
];

describe('filterItems', (): void => {
	it('matches localized names, IDs, descriptions, and rarity names', (): void => {
		expect(filterItems(items, 'paldium', new Set()).map((entry: Item): string => entry.id)).toEqual(
			['Pal_crystal']
		);
		expect(filterItems(items, 'oldbow', new Set()).map((entry: Item): string => entry.id)).toEqual([
			'LegendaryOldBow'
		]);
		expect(
			filterItems(items, 'crafting material', new Set()).map((entry: Item): string => entry.id)
		).toEqual(['Pal_crystal']);
		expect(
			filterItems(items, 'legendary', new Set()).map((entry: Item): string => entry.id)
		).toEqual(['LegendaryOldBow']);
	});

	it('combines inclusive rarity filters with the text query', (): void => {
		const rarities = new Set([Rarity.Rare, Rarity.Legendary]);
		expect(filterItems(items, '', rarities).map((entry: Item): string => entry.id)).toEqual([
			'LegendaryOldBow',
			'RareSphere'
		]);
		expect(filterItems(items, 'sphere', rarities).map((entry: Item): string => entry.id)).toEqual([
			'RareSphere'
		]);
	});
});

describe('appendItemStacksToEmptySlots', (): void => {
	it('preserves occupied slots and appends selected stacks in order', (): void => {
		const slots: ItemContainerSlot[] = [
			{ slot_index: 0, static_id: 'Existing', count: 5 },
			{ slot_index: 1, static_id: 'None', count: 0 },
			{ slot_index: 2, static_id: 'None', count: 0 }
		];
		const result = appendItemStacksToEmptySlots(
			slots,
			[
				{ itemId: 'Pal_crystal', count: 30 },
				{ itemId: 'RareSphere', count: 4 }
			],
			items,
			false
		);

		expect(result.addedCount).toBe(2);
		expect(result.skippedCount).toBe(0);
		expect(result.slots).toEqual([
			{ slot_index: 0, static_id: 'Existing', count: 5, dynamic_item: undefined },
			{ slot_index: 1, static_id: 'Pal_crystal', count: 30, dynamic_item: undefined },
			{ slot_index: 2, static_id: 'RareSphere', count: 4, dynamic_item: undefined }
		]);
		expect(slots[1].static_id).toBe('None');
	});

	it('clamps counts and reports selections that do not fit', (): void => {
		const slots: ItemContainerSlot[] = [{ slot_index: 0, static_id: 'None', count: 0 }];
		const result = appendItemStacksToEmptySlots(
			slots,
			[
				{ itemId: 'Pal_crystal', count: 500 },
				{ itemId: 'RareSphere', count: 1 }
			],
			items,
			false
		);

		expect(result.slots[0].count).toBe(99);
		expect(result.addedCount).toBe(1);
		expect(result.skippedCount).toBe(1);
	});
});
