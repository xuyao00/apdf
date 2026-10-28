// User-driven update flow. Downloads and installation each require confirmation.
class UpdateController {
  constructor({ getRelease, getUpdater, unsupportedReason, metadataName, show, openExternal, publish, beforeInstall }) {
    Object.assign(this, { getRelease, getUpdater, unsupportedReason, metadataName, show, openExternal, publish, beforeInstall });
    this.state = { phase: 'idle' };
  }
  setState(state) { this.state = state; this.publish(state); }
  check() {
    if (this.pending) return this.pending;
    this.pending = this.run().finally(() => { this.pending = undefined; });
    return this.pending;
  }
  async run() {
    try {
      if (this.state.phase === 'installing') return;
      if (this.state.phase === 'downloaded') return await this.confirmInstall();
      this.setState({ phase: 'checking' });
      const release = await this.getRelease();
      if (release.status !== 'available') {
        this.setState({ phase: 'idle' });
        await this.show({ type: 'info', message: release.status === 'no-release' ? 'No release is available yet' : 'aPDF is up to date', detail: `Installed version: ${release.currentVersion}.`, buttons: ['OK'] });
        return;
      }
      const reason = await this.unsupportedReason() || (!release.updateFiles.includes(this.metadataName) ? 'This release requires a manual installation.' : '');
      if (reason) {
        this.setState({ phase: 'idle' });
        const { response } = await this.show({ type: 'info', message: `aPDF ${release.latestVersion} is available`, detail: `${reason}\nDownload the installer for your operating system from GitHub Releases.`, buttons: ['View release', 'Later'], cancelId: 1 });
        if (response === 0) await this.openExternal(release.releaseUrl);
        return;
      }
      this.updater ||= this.configureUpdater(this.getUpdater());
      const result = await this.updater.checkForUpdates();
      if (!result || !result.isUpdateAvailable) {
        this.setState({ phase: 'idle' });
        await this.show({ type: 'info', message: 'aPDF is up to date', buttons: ['OK'] });
        return;
      }
      const version = result.updateInfo.version;
      this.setState({ phase: 'idle' });
      const { response } = await this.show({ type: 'info', message: `aPDF ${version} is available`, detail: 'Download the update now? You can continue reading while it downloads.', buttons: ['Download update', 'Later'], cancelId: 1 });
      if (response !== 0) return;
      this.setState({ phase: 'downloading', version, percent: 0 });
      await this.updater.downloadUpdate();
      this.setState({ phase: 'downloaded', version });
      await this.confirmInstall();
    } catch (error) {
      this.setState({ phase: 'idle' });
      await this.show({ type: 'error', message: 'Could not update aPDF', detail: error.message || 'Please try again later.', buttons: ['OK'] });
    }
  }
  configureUpdater(updater) {
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    updater.on('download-progress', progress => {
      if (this.state.phase !== 'downloading') return;
      this.setState({ ...this.state, percent: Number.isFinite(progress.percent) ? Math.max(0, Math.min(100, progress.percent)) : 0 });
    });
    // Electron Updater also emits errors when it rejects an operation. During
    // installation there is no promise to reject, so report that event here.
    updater.on('error', error => {
      if (this.state.phase !== 'installing') return;
      this.setState({ phase: 'downloaded', version: this.state.version });
      void this.show({ type: 'error', message: 'Could not install the update', detail: error.message, buttons: ['OK'] }).catch(() => {});
    });
    return updater;
  }
  async confirmInstall() {
    const { response } = await this.show({ type: 'info', message: 'Update ready to install', detail: 'Restart aPDF to install the update. Saved PDFs and reading positions are kept. Finish any unsaved citation edits first.', buttons: ['Restart and install', 'Later'], cancelId: 1 });
    if (response !== 0) return;
    await this.beforeInstall();
    this.setState({ phase: 'installing', version: this.state.version });
    this.updater.quitAndInstall(false, true);
  }
}
module.exports = { UpdateController };
