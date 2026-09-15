export function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function truncate(value: string, length: number) {
  if (value.length <= length) {
    return value;
  }

  return `${value.slice(0, Math.max(length - 3, 0))}...`;
}
