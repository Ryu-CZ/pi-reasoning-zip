export function buildCompactionPrompt(thinking: string): string {
  return `Compress this model reasoning into a compact decision trace for future coding-agent context.

Keep exact paths, commands, symbols, errors, decisions, constraints, failed attempts, and next actions.
Drop self-talk, repeated planning, obvious reasoning, filler, and prose.
Use terse bullets under: facts, decisions, constraints, failed, next.
Target 10-20% of original length.
If no useful content remains, output exactly: none

Reasoning:
${thinking}`;
}
