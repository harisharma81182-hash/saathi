# Saathi design system

Saathi should feel like a carefully designed premium product (the "AI Common" feel), not a generic AI dashboard. These rules apply to every screen.

## Principles

1. **One light in the room.** Saathi's golden orb is the only thing that glows. Everything else is calm.
2. **A night sky, not flat black.** Every app screen sits on the same sky as the Orbit landing page: deep navy to ink with soft indigo haze, a faint warm light where Saathi's face is, tiny static stars and a fine grain (`.ambient`, pure CSS, nothing animated).
3. **Hierarchy by space, not by boxes.** The face (big, with a slowly breathing aura), the greeting and the chat get the room. Sections are separated by whitespace and a small label. Panels that hold things (the Today panel, the composer, toasts) are soft glass (`.glass`: translucent, blurred, a faint top highlight, a deep soft shadow), never hard boxes.
4. **Gold is rare.** Gold is for the primary action on a screen, key numbers (countdowns, streaks) and focus. It is never used for decoration or for every link.
5. **Motion only where something changes.** A message arrives, a receipt appears, an item is completed. Use short eases (0.25 to 0.4 s, `cubic-bezier(0.22, 1, 0.36, 1)`), no bouncing springs, no looping motion except the face. Everything respects `prefers-reduced-motion`.
6. **Real product details.** Every control has hover, press (`active:scale-95` or similar) and keyboard focus states. Loading uses skeletons, never spinners. Empty states use friendly Hinglish and say what to do next. Errors say what went wrong and offer the fix (retry, edit).

## Tokens (`src/index.css`)

| Token | Value | Use |
|---|---|---|
| `ink` | `#080B18` (night navy) | Base under the sky gradient |
| `surface`, `surface-2` | cool white at 5% / 9% (glass) | Fields, user bubbles, chips; the sky shows through |
| `line` | cool white at 9% | The few dividers and glass edges |
| `text` / `muted` / `faint` | `#F6EFE4` / `#B7AD9F` / `#918879` | Body, secondary, labels and meta (faint is at least 5:1 on ink) |
| `gold` | `#F2A541` | Primary action, key numbers, focus |
| `leaf` | `#3FAE9F` | Success, done |
| `vermilion` | `#EF6A45` | Errors and overdue only |
| `violet` | `#A77BF3` | Voice mode (listening) only |

The only gradients are the night sky itself (deep navy and indigo, very dark) and Saathi's glow. No bright purple/blue UI gradients. Saathi's face changes colour by mood within its warm family (gold, ember while thinking, dusk when concerned); violet only while listening. Text sitting on glass over moving content (toasts, the "new messages" button) gets a darker glass (`bg-ink/70` to `/80`) so it stays readable.

## Type

- **Baloo 2** for headings, the wordmark and numbers. **Mukta** for everything else. No third font.
- Scale (the only sizes that exist): 12, 14, 16, 18, 22, 28, 36, 44 px (`text-xs` to `text-4xl`).
- Body is 16 px. Labels and meta are 12 to 14 px in `faint`.

## Spacing and shape

- Tailwind's 4 px scale, steps 1, 1.5, 2, 3, 4, 6, 8, 12, 16.
- Page gutters: 16 px on phones, 32 px from `sm` up. Sections: 32 px apart (`mt-8`).
- Radius: 12 px fields, 16 px cards and bubbles, full for buttons and chips.

## Icons

- One set: **lucide-react** (stroke icons, 24 px grid). Sizes 14 to 19 px in UI, stroke 2 unless a check needs more weight.
- No emoji as icons. Emoji can appear only inside text the AI writes.

## Phone

- Same rules at 390 px wide. Chat and Today are two tabs with a bottom bar. Touch targets are at least 44 px. Safe-area insets are respected at the top and bottom.
