export type HSV = { h: number; s: number; v: number } // h 0-360, s/v 0-1

/** Accepts #rgb or #rrggbb (with or without #); null if it isn't a colour. */
export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const full = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number]
}

export const rgbToHex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')

export function hsvToRgb({ h, s, v }: HSV): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h / 60) % 6
    return (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255
  }
  return [f(5), f(3), f(1)]
}

export function rgbToHsv(r: number, g: number, b: number): HSV {
  const [R, G, B] = [r / 255, g / 255, b / 255]
  const max = Math.max(R, G, B), d = max - Math.min(R, G, B)
  let h = 0
  if (d) h = max === R ? ((G - B) / d + 6) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4
  return { h: h * 60, s: max ? d / max : 0, v: max }
}

export const hsvToHex = (c: HSV) => rgbToHex(...hsvToRgb(c))
