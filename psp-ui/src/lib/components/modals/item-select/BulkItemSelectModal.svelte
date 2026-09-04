<script lang="ts">
	import Icon from '$lib/components/ui/icons/Icon.svelte';
	import { Button, Card, Input, Tooltip } from '$components/ui';
	import { itemsData } from '$lib/data';
	import * as m from '$i18n/messages';
	import { Rarity, type Item } from '$types';
	import { cn } from '$theme';
	import { focusModal } from '$utils/modalUtils';
	import SvelteVirtualList from '@humanspeak/svelte-virtual-list';
	import { onMount } from 'svelte';
	import {
		filterItems,
		getMaximumStackCount,
		ITEM_RARITIES,
		type ItemStackSelection
	} from './bulkItemPicker';
	import { getBackgroundColor, getItemIcon, isSelectableItem } from './itemUtils';

	let {
		availableSlots,
		cheatMode,
		closeModal
	}: {
		availableSlots: number;
		cheatMode: boolean;
		closeModal: (value?: ItemStackSelection[]) => void;
	} = $props();

	let modalContainer: HTMLDivElement;
	let query = $state('');
	let selectedRarities: Set<Rarity> = $state(new Set());
	let selectedItemIds: string[] = $state([]);
	let countsByItemId: Record<string, number> = $state({});

	const rarityLabels: Readonly<Record<Rarity, string>> = {
		[Rarity.Common]: m.common(),
		[Rarity.Uncommon]: m.uncommon(),
		[Rarity.Rare]: m.rare(),
		[Rarity.Epic]: m.epic(),
		[Rarity.Legendary]: m.legendary()
	};

	const items: Item[] = $derived.by(() =>
		Object.values(itemsData.items)
			.filter(
				(item: Item): boolean =>
					isSelectableItem(item) &&
					item.details.group !== 'KeyItem' &&
					item.details.dynamic?.type !== 'egg'
			)
			.sort((left: Item, right: Item): number =>
				left.info.localized_name.localeCompare(right.info.localized_name)
			)
	);
	const filteredItems = $derived(filterItems(items, query, selectedRarities));
	const selectedCount = $derived(selectedItemIds.length);

	function toggleRarity(rarity: Rarity): void {
		const nextRarities = new Set(selectedRarities);
		if (nextRarities.has(rarity)) {
			nextRarities.delete(rarity);
		} else {
			nextRarities.add(rarity);
		}
		selectedRarities = nextRarities;
	}

	function toggleItem(item: Item): void {
		if (selectedItemIds.includes(item.id)) {
			selectedItemIds = selectedItemIds.filter((itemId: string): boolean => itemId !== item.id);
			const remainingCounts = { ...countsByItemId };
			delete remainingCounts[item.id];
			countsByItemId = remainingCounts;
			return;
		}
		if (selectedItemIds.length >= availableSlots) return;

		selectedItemIds = [...selectedItemIds, item.id];
		countsByItemId = { ...countsByItemId, [item.id]: 1 };
	}

	function updateCount(item: Item, value: number): void {
		const maximumCount = getMaximumStackCount(item, cheatMode);
		const count = Number.isFinite(value) ? Math.min(maximumCount, Math.max(1, value)) : 1;
		countsByItemId = { ...countsByItemId, [item.id]: count };
	}

	function handleSave(): void {
		const selections = selectedItemIds.map(
			(itemId: string): ItemStackSelection => ({
				itemId,
				count: countsByItemId[itemId] ?? 1
			})
		);
		closeModal(selections);
	}

	function clearSelection(): void {
		selectedItemIds = [];
		countsByItemId = {};
	}

	onMount((): void => focusModal(modalContainer));
</script>

<div bind:this={modalContainer}>
	<Card class="w-[min(900px,calc(100vw-2rem))]">
		<div class="mb-4 flex items-start justify-between gap-4">
			<div>
				<h3 class="h3">{m.add_entity({ entity: m.item({ count: 2 }) })}</h3>
				<p class="text-surface-400 text-sm">
					{m.slots_available_in_entity({ count: availableSlots, entity: m.inventory() })}
				</p>
			</div>
			<span class="text-surface-300 text-sm" aria-live="polite">
				{m.selected_of_total({ selected: selectedCount, total: availableSlots })}
			</span>
		</div>

		<Input
			type="search"
			bind:value={query}
			placeholder={m.search_entity({ entity: m.item({ count: 2 }) })}
			aria-label={m.search_entity({ entity: m.item({ count: 2 }) })}
			inputClass="w-full"
		/>

		<div class="mb-3 flex flex-wrap gap-2" role="group" aria-label="Item rarity filters">
			{#each ITEM_RARITIES as rarity}
				<button
					type="button"
					class={cn(
						'border-surface-500 rounded-full border px-3 py-1 text-sm transition-colors',
						selectedRarities.has(rarity) ? 'bg-secondary-500 text-white' : 'hover:bg-surface-700'
					)}
					aria-pressed={selectedRarities.has(rarity)}
					onclick={() => toggleRarity(rarity)}
				>
					{rarityLabels[rarity]}
				</button>
			{/each}
		</div>

		<div class="border-surface-600 h-[55vh] overflow-hidden rounded border">
			{#if filteredItems.length > 0}
				<SvelteVirtualList items={filteredItems}>
					{#snippet renderItem(item)}
						{@const selected = selectedItemIds.includes(item.id)}
						{@const selectionLimitReached = selectedCount >= availableSlots && !selected}
						<div
							class={cn(
								'hover:bg-surface-700 border-surface-700 grid w-full grid-cols-[auto_auto_1fr_auto] items-center gap-3 border-b p-2 text-left',
								selected && 'bg-secondary-500/20',
								selectionLimitReached && 'cursor-not-allowed opacity-50'
							)}
						>
							<input
								type="checkbox"
								checked={selected}
								disabled={selectionLimitReached}
								aria-label={item.info.localized_name}
								onchange={() => toggleItem(item)}
							/>
							<div
								class={cn(
									'flex h-12 w-12 items-center justify-center',
									getBackgroundColor(item.id, items)
								)}
							>
								{#if getItemIcon(item.id)}
									<img src={getItemIcon(item.id)} alt="" class="h-12 w-12 object-contain" />
								{:else}
									<Icon icon="ph:cube" class="h-8 w-8" />
								{/if}
							</div>
							<div class="min-w-0">
								<div class="truncate font-bold">{item.info.localized_name}</div>
								<div class="text-surface-400 truncate text-xs">{item.id}</div>
								<div class="text-surface-400 truncate text-xs">{item.info.description}</div>
							</div>
							<div class="flex items-center gap-3">
								<span class="text-sm">{rarityLabels[item.details.rarity]}</span>
								{#if selected}
									<label class="flex items-center gap-1">
										<span class="sr-only">{m.enter_item_count()}</span>
										<input
											type="number"
											min="1"
											max={getMaximumStackCount(item, cheatMode)}
											value={countsByItemId[item.id] ?? 1}
											class="input w-24 rounded-xs p-2"
											onchange={(event) => updateCount(item, event.currentTarget.valueAsNumber)}
										/>
									</label>
								{/if}
							</div>
						</div>
					{/snippet}
				</SvelteVirtualList>
			{:else}
				<div class="text-surface-400 flex h-full items-center justify-center">
					{m.docs_no_results()}
				</div>
			{/if}
		</div>

		<div class="mt-4 flex items-center justify-end gap-2">
			<Tooltip position="bottom">
				<Button variant="ghost" size="icon" onclick={clearSelection} disabled={selectedCount === 0}>
					<Icon icon="tabler:backspace" />
				</Button>
				{#snippet popup()}<span>{m.clear_selection()}</span>{/snippet}
			</Tooltip>
			<Tooltip position="bottom">
				<Button
					variant="primary"
					size="icon"
					onclick={handleSave}
					disabled={selectedCount === 0 || availableSlots === 0}
					data-modal-primary
				>
					<Icon icon="tabler:plus" />
				</Button>
				{#snippet popup()}<span>{m.add_entity({ entity: m.item({ count: 2 }) })}</span>{/snippet}
			</Tooltip>
			<Tooltip position="bottom">
				<Button variant="ghost" size="icon" onclick={() => closeModal()}>
					<Icon icon="tabler:x" />
				</Button>
				{#snippet popup()}<span>{m.cancel()}</span>{/snippet}
			</Tooltip>
		</div>
	</Card>
</div>
