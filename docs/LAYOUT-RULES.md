# Overlap layout rules

How timed events share a day column. Code: `layoutCol` in `main.js`; tunables are the named constants at its top, tagged with the rule number. Rule numbers are kept stable between versions.

Rules use event properties only (duration, overlap amount), never event names.

| # | Rule | Why |
|---|---|---|
| R1 | Every timed box spans the day's width. Each layer in front adds `STRIP_PX` of left offset, so the event behind keeps a visible side strip and the strips stack. Repeating items of `BACKDROP_MIN`+ minutes (a night's sleep, a long shift) are always the back layer. | Text keeps its width; Full Calendar's default column split leaves only initials. |
| R2 | Ordinary events starting within `SAME_START_PX` of each other, with a real overlap, share the width side by side. | Neither can sit behind the other, so stacking would hide one. |
| R3 | Where the top box covers only another box, its fill thins to `BOX_ALPHA` on that band. Its own text stays solid. | Shows there is something behind while keeping text readable. |
| R4 | Where the top box covers text behind it, that patch (fill and text) drops to `TEXT_ALPHA`. | The event behind stays legible. |
| R4b | If the top box's own text would land on the text behind and fits lower down, it drops below it (`DROP_GAP_PX`). | Two texts on one spot cannot both be read. |
| R5 | An edge overlap up to `TINY_OVERLAP_PX`, or `TINY_OVERLAP_RATIO` of the smaller box, is removed instead of layered: the backdrop or smaller box is trimmed, or moves if trimming would go under `MIN_BOX_PX`. | A sliver of overlap should not cost a whole strip offset. |
| R8 | Short items follow R1 like any other box. | They read as events, not leftovers. |
| R10 | Text steps down up to `FIT_STEPS` sizes (classes `fcas-fit1`, `fcas-fit2`) until it fits the box. | The whole title shows in tight boxes. |

## Adding an edge case
Extend the matching rule, or add a new numbered rule here with its reason. Thresholds go in a named constant. Never add a per-event exception: no event names, ids or dates in the layout code.
