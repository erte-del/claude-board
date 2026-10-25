// Clipboard images pasted into a chat are saved as paste-<uuid>.png (or .jpg) in a temp folder, and swept after a day.
const NAME = /^paste-[0-9a-f-]{36}\.(png|jpg)$/

/** Which files in the paste folder are old enough to delete. Only our own file names are ever considered. */
export function staleImages(files: { name: string; mtimeMs: number }[], now: number, maxAgeMs = 24 * 3600_000): string[] {
  return files.filter((f) => NAME.test(f.name) && now - f.mtimeMs > maxAgeMs).map((f) => f.name)
}
