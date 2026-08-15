import {
  ILabShell,
  ILayoutRestorer,
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import {
  ICommandPalette,
  MainAreaWidget,
  WidgetTracker
} from '@jupyterlab/apputils';
import { PageConfig } from '@jupyterlab/coreutils';
import { IDocumentManager } from '@jupyterlab/docmanager';
import { Widget } from '@lumino/widgets';

const DESKTOP_COMMAND_ID = 'desktop-widget:open';
const TUTORIAL_COMMAND_ID = 'desktop-widget:open-tutorial';
const NAMESPACE = 'desktop-widget';
const FILE_BROWSER_ID = 'filebrowser';
const PALETTE_CATEGORY = 'Demo';

// The notebook the session is about, relative to the directory JupyterLab serves.
const TUTORIAL_NOTEBOOK = 'notebooks/ijcai_demo.ipynb';

// Leaving simple mode makes the shell restore the deferred main area layout in the
// background, so the widgets opened at startup have to wait for it. There is no signal
// for the end of that restoration, hence the fixed delay.
const LAYOUT_RESTORE_DELAY_MS = 300;

const startupFlag = (name: string, defaultValue = true): boolean => {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get(name);
  if (raw === null) {
    return defaultValue;
  }

  const normalized = raw.trim().toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(normalized);
};

/**
 * The panel that embeds the remote desktop.
 */
class DesktopContent extends Widget {
  constructor() {
    super();
    this.addClass('jp-DesktopWidget');
    this.node.style.height = '100%';
    this.node.style.display = 'flex';
    this.node.style.flexDirection = 'column';

    // Escape hatch: the desktop leaves a blank panel if it ever refuses to be embedded,
    // and a live session should not end there. It also gives RViz the full screen.
    const header = document.createElement('div');
    header.className = 'jp-DesktopWidget-header';
    header.style.display = 'flex';
    header.style.flex = '0 0 auto';
    header.style.justifyContent = 'flex-end';
    header.style.padding = '2px 4px';

    const url = `${PageConfig.getBaseUrl()}desktop`;

    const externalLink = document.createElement('a');
    externalLink.className = 'jp-DesktopWidget-externalLink';
    externalLink.textContent = 'Open in new tab';
    externalLink.href = url;
    externalLink.target = '_blank';
    externalLink.rel = 'noopener';
    externalLink.title = 'Open the desktop with RViz in a new browser tab';
    externalLink.style.fontSize = 'var(--jp-ui-font-size0, 11px)';
    header.appendChild(externalLink);

    const iframe = document.createElement('iframe');
    iframe.className = 'jp-DesktopWidget-frame';
    iframe.src = url;
    iframe.setAttribute('title', 'RViz');
    iframe.setAttribute('allow', 'clipboard-read; clipboard-write');
    iframe.style.flex = '1 1 auto';
    iframe.style.minHeight = '0';
    iframe.style.width = '100%';
    iframe.style.border = '0';

    this.node.appendChild(header);
    this.node.appendChild(iframe);
  }
}

const plugin: JupyterFrontEndPlugin<void> = {
  id: 'desktop-widget:plugin',
  autoStart: true,
  requires: [ILabShell, ILayoutRestorer, IDocumentManager],
  optional: [ICommandPalette],
  activate: (
    app: JupyterFrontEnd,
    labShell: ILabShell,
    restorer: ILayoutRestorer,
    docManager: IDocumentManager,
    palette: ICommandPalette | null
  ) => {
    const tracker = new WidgetTracker<MainAreaWidget<DesktopContent>>({
      namespace: NAMESPACE
    });
    let widget: MainAreaWidget<DesktopContent> | null = null;

    const wait = (milliseconds: number) =>
      new Promise<void>(resolve => window.setTimeout(resolve, milliseconds));

    // The workspace stores the notebook and the desktop side by side, but the shell
    // ignores that layout while it runs in simple mode, which is why the split has to be
    // restored by hand today.
    const leaveSimpleMode = async () => {
      if (labShell.mode === 'multiple-document') {
        return;
      }

      labShell.mode = 'multiple-document';
      await wait(LAYOUT_RESTORE_DELAY_MS);
    };

    // Detaching the widget takes its tab out of the sidebar without disposing it, so the
    // extensions that work on the default file browser keep functioning.
    const removeFileBrowser = () => {
      for (const sideBarWidget of labShell.widgets('left')) {
        if (sideBarWidget.id === FILE_BROWSER_ID) {
          sideBarWidget.parent = null;
        }
      }
    };

    const openTutorial = async () => {
      try {
        return await docManager.openOrReveal(TUTORIAL_NOTEBOOK, 'Notebook');
      } catch (error) {
        console.error(`Failed to open ${TUTORIAL_NOTEBOOK}`, error);
        return null;
      }
    };

    const openDesktop = async (ref?: string) => {
      if (widget === null || widget.isDisposed) {
        // The workspace restores a desktop widget of its own, and a second one would
        // claim the same identifier.
        widget = tracker.find(() => true) ?? null;
      }

      if (widget === null || widget.isDisposed) {
        widget = new MainAreaWidget({ content: new DesktopContent() });
        widget.id = 'desktop-widget';
        widget.title.label = 'RViz';
        widget.title.closable = true;
        await tracker.add(widget);
      }

      if (!widget.isAttached) {
        // Anchored on the notebook so RViz ends up beside it, never on top of it.
        const options = ref
          ? { mode: 'split-right' as const, ref }
          : { mode: 'split-right' as const };
        app.shell.add(widget, 'main', options);
      }

      app.shell.activateById(widget.id);
      return widget;
    };

    void restorer.restore(tracker, {
      command: DESKTOP_COMMAND_ID,
      name: () => 'desktop'
    });

    app.commands.addCommand(DESKTOP_COMMAND_ID, {
      label: 'Open RViz',
      execute: () => openDesktop()
    });

    app.commands.addCommand(TUTORIAL_COMMAND_ID, {
      label: 'Open the Tutorial Notebook',
      execute: () => openTutorial()
    });

    if (palette) {
      for (const command of [TUTORIAL_COMMAND_ID, DESKTOP_COMMAND_ID]) {
        palette.addItem({ command, category: PALETTE_CATEGORY });
      }
    }

    void app.restored.then(async () => {
      const autoOpenTutorial = startupFlag('autoOpenTutorial', true);
      const autoOpenDesktop = startupFlag('autoOpenDesktop', true);
      const autoCollapseLeft = startupFlag('autoCollapseLeft', true);
      const hideFileBrowser = startupFlag('hideFileBrowser', true);

      await leaveSimpleMode();

      if (hideFileBrowser) {
        removeFileBrowser();
      }

      if (autoCollapseLeft) {
        labShell.collapseLeft();
      }

      const notebook = autoOpenTutorial ? await openTutorial() : null;

      if (autoOpenDesktop) {
        await openDesktop(notebook?.id);
      }

      // The reader starts in the tutorial, with RViz next to it.
      if (notebook !== null && !notebook.isDisposed) {
        app.shell.activateById(notebook.id);
      }
    });
  }
};

export default plugin;
