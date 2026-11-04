# KomaSlate Frontend Workbench
Ubiquitous language for the creator-facing workbench UI and its redesign program. Implementation detail does not belong here.

## Language

**Director Desk**:
The primary creation surface after a project exists: chrome, agent conversation, and canvas as one workspace.
_Avoid_: Dashboard, editor (ambiguous), IDE

**Workbench Shell**:
The viewport-locked frame (top chrome + main columns) that must not produce document-level scrolling.
_Avoid_: Layout wrapper, app chrome (too generic)

**Agent Column**:
The conversation / task-binding side of the Director Desk (currently left). Selection on the canvas binds feedback to an entity here.
_Avoid_: Sidebar (overloaded), chat drawer (implies temporary only)

**Canvas**:
The infinite visual stage (React Flow projection of workflow nodes: brief, characters, shot grid, output).
_Avoid_: Board, whiteboard

**Shot Grid**:
The storyboard projection of shots in up to three columns (九宫格-style reading order), each cell one shot.
_Avoid_: Shotline (legacy label), timeline (implies video editing)

**Cell**:
One shot card in the Shot Grid; the unit of single-entity regenerate and selection binding.
_Avoid_: Card (too generic), panel

**Selection Binding**:
The rule that the currently selected canvas entity (character or shot cell) scopes agent feedback and inspector actions.
_Avoid_: Context menu, focus (DOM sense)

**Design Contract**:
The frozen visual and layout rules (density, tokens, shell geometry) that every domain batch must meet before merge.
_Avoid_: Style guide (passive), theme

**Interaction Freeze**:
The redesign constraint that primary creator operations keep their meaning. Soft freeze (F2): selection binding, Agent Column chat, cell regenerate, generate/confirm/cancel, and viewport-locked shell are mandatory; defaults, copy polish, secondary-entry folding may change.
_Avoid_: UX freeze (too broad), feature freeze, hard freeze (F1)

**Domain Batch**:
One mergeable redesign slice that covers a coherent UI domain under the Design Contract (e.g. shell, home, canvas shapes).
_Avoid_: Sprint, phase (overloaded with product roadmap phases)

## Redesign Program (decided)

- **Scope**: Full warehouse visual/density alignment (program C).
- **Delivery**: Contract-first, domain batches (C2).
- **Constraint**: Interaction Freeze (C3) — no semantic re-learning of primary creator ops.
- **Design Contract authority**: Executable tokens (`frontend/app/styles/tokens.css` + minimal Tailwind/daisy mapping) are source of truth (T1). Human-readable `DESIGN.md` is updated in the same PR when tokens change (light T3) — docs follow code, not the reverse.
- **Aesthetic**: Dense Comic Workbench (D2) — keep CMYK/halftone/display type identity; tighten chrome and cards to cockpit density. Not a cold SaaS skin; not dual themes.
- **Batch order (O1)**: Design Contract tokens → Workbench Shell → Home → Director Desk → list pages (Projects/Universes) → settings/drawers/primitives polish.
- **Acceptance (G2)**: Each domain batch requires green vitest + tsc/build, plus a short manual path check (open project → run/recovery state → select cell → bound feedback → cell regenerate; shell batches also verify no document scrollbar).
