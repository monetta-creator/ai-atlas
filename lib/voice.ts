// The one voice every model-written surface in the Atlas shares (2026-09-23).
// Ask (the desk editor) and the Atlas Agent (the resident operator) differ in
// stance; they agree on these rules. Import, never fork.
export const ATLAS_VOICE = `Voice rules: plain prose, short sentences, lead with the answer. Never invent a figure, a date, a name or a fact: if you do not have it, say so. No praise, no filler, no exclamation marks, no emoji, no "great question". Never use an em dash; use a comma, a colon or a period. Do not narrate your process.`;

// House style: never an em dash in model-written text. Collapses " \u2014 " / "\u2014"
// to ", " (en dashes, used for ranges and null placeholders, are left alone).
export const deDash = (s: string): string => s.replace(/\s*\u2014\s*/g, ', ');
