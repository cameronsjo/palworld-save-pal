# Item and Technology Search UX

## Goal

Make it fast and safe to grant one or many items to a player by name or rarity, and make the technology editor searchable without losing its level-oriented context.

## Chosen approach

Enhance the item-selection feature rather than changing the shared combobox contract. Individual inventory-slot editing will remain a single-item operation. The player inventory will gain a separate bulk **Add items** flow that supports text search, multi-select rarity filters, multiple selected item types, and a quantity for each selected stack. Confirming the flow will place one stack of each selected item into the next available empty slots and will never overwrite an occupied slot.

Item search will match localized item names, internal IDs, descriptions, and rarity names. Rarity filter chips will combine as an inclusive set, so selecting `Rare` and `Epic` shows either rarity while the text query further narrows the result.

The technology page will gain a search field that matches localized technology names, internal IDs, descriptions, unlocked item names, and unlocked structure names. Matching technology cards will remain grouped by level; level rows with no matches will be omitted.

Filtering and inventory-allocation decisions will live in pure, typed helper functions with focused unit tests. UI components will remain thin wrappers around those helpers.

## Alternatives declined

- Generalizing the shared `Combobox` into a multiselect was declined because it would expand regression risk across unrelated editor surfaces and still would not model per-item quantities cleanly.
- Adding rarity words to the existing name-only search without a bulk flow was declined because it would improve discovery but not the core task of granting several different items.
- Replacing the existing destructive **Fill inventory** behavior was declined because changing an established action could unexpectedly overwrite or rearrange player inventories; the new additive action is safer and explicit.

## Checklist

- [x] Add typed item filtering helpers and behavior tests for text and inclusive rarity filters.
- [x] Add a bulk item picker with accessible selection controls and per-item stack quantities.
- [x] Add a player inventory **Add items** action that fills only empty slots and reports capacity limits.
- [x] Preserve the existing single-slot item editor and existing **Fill inventory** action.
- [x] Add typed technology filtering helpers and behavior tests for all searchable fields.
- [x] Add technology search while preserving level grouping and selection state.
- [ ] Run focused unit tests, Svelte diagnostics, lint, and the production UI build.
- [ ] Commit and push the implementation to `main`.
- [ ] Run `build-image.yml`, record the produced editor image digest, and deploy it through the homelab manifest PR.
