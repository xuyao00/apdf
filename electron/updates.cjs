const LATEST_RELEASE_URL = 'https://api.github.com/repos/xuyao00/apdf/releases/latest';

function parseVersion(value) {
  if (typeof value !== 'string') return null;
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/.exec(value);
  if (!match) return null;
  const pre = match[4]?.split('.') || [];
  if (pre.some(part => /^\d+$/.test(part) && part.length > 1 && part[0] === '0')) return null;
  return { core: match.slice(1, 4).map(BigInt), pre };
}
function compareVersions(left, right) {
  const a = parseVersion(left), b = parseVersion(right);
  if (!a || !b) throw new Error('The release version could not be read.');
  for (let i = 0; i < 3; i++) if (a.core[i] !== b.core[i]) return a.core[i] > b.core[i] ? 1 : -1;
  if (!a.pre.length || !b.pre.length) return a.pre.length === b.pre.length ? 0 : a.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i], y = b.pre[i];
    if (x === y) continue;
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
    if (nx && ny) return BigInt(x) > BigInt(y) ? 1 : -1;
    if (nx !== ny) return nx ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}
async function getUpdateStatus(currentVersion, fetchRelease = globalThis.fetch) {
  let response;
  try {
    response = await fetchRelease(LATEST_RELEASE_URL, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'aPDF', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(15000), redirect: 'error'
    });
  } catch {
    throw new Error('Could not reach GitHub. Check your internet connection and try again.');
  }
  if (response.status === 404) return { status: 'no-release', currentVersion };
  if (response.status === 403 || response.status === 429) throw new Error('GitHub is limiting update checks. Please try again later.');
  if (!response.ok) throw new Error('GitHub could not check for updates. Please try again later.');
  let release;
  try { release = await response.json(); } catch { throw new Error('GitHub returned an unreadable release. Please try again later.'); }
  if (!release || typeof release !== 'object') throw new Error('GitHub returned an unreadable release. Please try again later.');
  if (release.draft || release.prerelease) return { status: 'no-release', currentVersion };
  const comparison = compareVersions(release.tag_name, currentVersion);
  return {
    status: comparison > 0 ? 'available' : 'current', currentVersion,
    latestVersion: release.tag_name.replace(/^v/, ''),
    updateFiles: Array.isArray(release.assets) ? release.assets.filter(asset => asset && asset.state === 'uploaded').map(asset => asset.name) : [],
    // Construct a trusted GitHub URL instead of opening a URL from the response.
    releaseUrl: `https://github.com/xuyao00/apdf/releases/tag/${encodeURIComponent(release.tag_name)}`
  };
}
module.exports = { getUpdateStatus, compareVersions };
