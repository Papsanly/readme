function randHex(length: number): string {
  let out = '';
  while (out.length < length) {
    out += Math.floor(Math.random() * 0xffffffff)
      .toString(16)
      .padStart(8, '0');
  }
  return out.slice(0, length);
}

export function newId(prefix?: string): string {
  const time = Date.now().toString(36);
  const rand = randHex(8);
  return prefix ? `${prefix}_${time}_${rand}` : `${time}_${rand}`;
}
