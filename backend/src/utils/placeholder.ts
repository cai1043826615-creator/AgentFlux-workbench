/** SVG 占位图生成（mock 生图降级 / 预览占位） */
export function createPlaceholderImage(label: string, color = '#7C3AED', width = 400, height = 400): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#FAFAFA"/>
  <rect x="20" y="20" width="${width - 40}" height="${height - 40}" fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="8 6"/>
  <circle cx="${width / 2}" cy="${height / 2 - 40}" r="52" fill="none" stroke="${color}" stroke-width="3"/>
  <text x="50%" y="${height / 2 + 30}" font-family="system-ui,sans-serif" font-size="26" fill="#0A0A0A" text-anchor="middle" font-weight="700">${label}</text>
  <text x="50%" y="${height / 2 + 62}" font-family="ui-monospace,monospace" font-size="13" fill="#8A8A90" text-anchor="middle">电商新品上架 · 生成预览</text>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

/** 头像占位（工位卡片用） */
export function createAvatarDataUrl(name: string, color = '#7C3AED'): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">
  <rect width="100%" height="100%" rx="16" fill="${color}"/>
  <text x="50%" y="54%" font-family="system-ui,sans-serif" font-size="30" fill="#fff" text-anchor="middle" font-weight="700">${name.slice(0, 1)}</text>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}
