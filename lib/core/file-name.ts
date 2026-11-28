const invalidCharacters = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;
const reservedName = /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i;

export function sanitizeBaseName(input: string): string {
  const name = input.trim().replace(invalidCharacters, '_').replace(/[. ]+$/, '');
  return reservedName.test(name) ? `_${name}` : name;
}

export function originalBaseName(name: string): string {
  const extension = name.lastIndexOf('.');
  return sanitizeBaseName(extension >= 0 ? name.slice(0, extension) : name) || 'image';
}
