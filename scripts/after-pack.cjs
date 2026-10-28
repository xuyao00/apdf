const { readdir, lstat, chmod } = require('node:fs/promises');
const { join } = require('node:path');

// Cross-platform ZIP extraction can leave Linux files with mode 0777. Keep
// executables executable and resources readable, without group/world writes.
async function normalizeLinuxPermissions(root) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const file = join(root, entry.name);
    if (entry.isSymbolicLink()) continue;
    const info = await lstat(file);
    if (entry.isDirectory()) {
      await chmod(file, 0o755);
      await normalizeLinuxPermissions(file);
    } else await chmod(file, info.mode & 0o111 ? 0o755 : 0o644);
  }
  await chmod(root, 0o755);
}
module.exports = async context => {
  if (context.electronPlatformName === 'linux') await normalizeLinuxPermissions(context.appOutDir);
};
module.exports.normalizeLinuxPermissions = normalizeLinuxPermissions;
