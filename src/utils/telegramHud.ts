export function hudHeader(title: string, subtitle?: string): string {
  const sub = subtitle ? ` · ${subtitle}` : '';
  return `<b>◈ ${title}${sub}</b>`;
}

export function hudSection(title: string): string {
  return `<b>▸ ${title}</b>`;
}

export function hudBox(lines: Array<string | undefined | null | false>): string {
  const clean = (lines || []).filter((l): l is string => Boolean(l && String(l).trim()));
  if (clean.length === 0) return '';
  return clean.map((l) => `│ ${l}`).join('\n');
}

export function hudSegmentedBar(percent: number, segments = 10): string {
  const p = Math.max(0, Math.min(100, Number(percent || 0)));
  const total = Math.max(4, segments);
  const filled = Math.round((p / 100) * total);
  return `${'▰'.repeat(filled)}${'▱'.repeat(total - filled)} ${p}%`;
}

export function hudWizardStep(step: 1 | 2 | 3 | 4): string {
  const labels = ['Título', 'Sinopsis', 'Portada', 'Subtítulos'];
  return `Paso ${step}/4 (${labels[step - 1] || ''})`;
}
