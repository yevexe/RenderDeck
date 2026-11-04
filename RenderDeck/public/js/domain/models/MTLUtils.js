// MTL map paths are resolved against the dropped files, never the page URL.
export const fileName = path => String(path).replace(/\\/g, '/').split('/').pop();
export const mapLine = /^\s*(map_\w+|bump|disp|norm)\s+(.+)$/i;

export function parseMap(value) {
  const tokens = value.match(/"[^"]*"|'[^']*'|\S+/g) || [];
  const options = [];
  let i = 0;
  while (i < tokens.length && /^-[a-z]/i.test(tokens[i])) {
    const option = tokens[i++];
    const start = i;
    const max = /^-(s|o|t)$/i.test(option) ? 3 : /^-mm$/i.test(option) ? 2 : 1;
    while (i < tokens.length && i - start < max) {
      if (/^-(s|o|t|mm)$/i.test(option) && !Number.isFinite(Number(tokens[i]))) break;
      i++;
    }
    if (/^-(s|o|bm)$/i.test(option)) options.push(option, ...tokens.slice(start, i));
  }
  return { options: options.join(' '), path: tokens.slice(i).join(' ').replace(/^['"]|['"]$/g, '') };
}

export function rewriteMTL(text, textureURLs, warn) {
  const textures = new Map(Object.entries(textureURLs).map(([name, url]) => [fileName(name).toLowerCase(), url]));
  return text.split(/\r?\n/).map(line => {
    const match = line.match(mapLine);
    if (!match) return line;
    const map = parseMap(match[2]);
    const url = textures.get(fileName(map.path).toLowerCase());
    if (!url) { warn(`Missing texture "${fileName(map.path)}"; using the material color.`); return ''; }
    return `${match[1].toLowerCase()} ${map.options ? map.options + ' ' : ''}${url}`;
  }).join('\n');
}
