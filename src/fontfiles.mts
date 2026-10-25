export type FontGroup = { name: string; regular: string; bold?: string }

const STYLE = new Set(['regular', 'plain', 'book', 'roman', 'bold', 'italic', 'oblique', 'light', 'extralight', 'ultralight', 'thin', 'medium', 'semibold', 'demibold', 'extrabold', 'heavy', 'black', 'condensed', 'semicondensed', 'dotted', 'slashed'])

/**
 * Group the font files in a folder into families with a regular (and, if present, bold) face, so they can be loaded as web
 * fonts. The family name is the file name minus its style words ("Hack-Bold.ttf" -> Hack; "Droid Sans Mono for Powerline.otf"
 * stays whole). Italic, light, black and the other styles are skipped: a terminal only needs regular and bold.
 */
export function groupFontFiles(files: string[]): FontGroup[] {
  const groups = new Map<string, FontGroup>()
  for (const f of files) {
    const m = /^(.*)\.(ttf|otf)$/i.exec(f.split('/').pop() ?? '')
    if (!m) continue
    // split into words on spaces/underscores/hyphens, and "BoldItalic" -> Bold Italic
    const words = m[1].replace(/([a-z])([A-Z])/g, '$1 $2').split(/[\s_-]+/).filter(Boolean)
    const style = words.filter((w) => STYLE.has(w.toLowerCase())).map((w) => w.toLowerCase())
    const name = words.filter((w) => !STYLE.has(w.toLowerCase())).join(' ')
    if (!name) continue
    const g = groups.get(name) ?? { name, regular: '' }
    const plain = style.every((s) => s === 'regular' || s === 'plain' || s === 'book' || s === 'roman')
    if (plain) g.regular = g.regular || f
    else if (style.length === 1 && style[0] === 'bold') g.bold = g.bold || f
    groups.set(name, g)
  }
  return [...groups.values()].filter((g) => g.regular).sort((a, b) => a.name.localeCompare(b.name))
}
