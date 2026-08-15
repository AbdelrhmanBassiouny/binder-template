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
import { Widget } from '@lumino/widgets';

const DESKTOP_COMMAND_ID = 'desktop-widget:open';
const VSCODE_COMMAND_ID = 'vscode-widget:open';
const DESKTOP_NAMESPACE = 'desktop-widget';
const VSCODE_NAMESPACE = 'vscode-widget';
const FILE_BROWSER_ID = 'filebrowser';
const PALETTE_CATEGORY = 'Demo';

// The notebook the session is about. Relative to the directory JupyterLab serves.
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
 * The directory JupyterLab serves, which is also the folder code-server opens.
 */
const serverRoot = (): string => {
  const root = PageConfig.getOption('serverRoot') || '/home/repo';
  return root.replace(/\/$/, '');
};

/**
 * The URL of the VSCode proxy, asking it to open the tutorial notebook.
 *
 * The proxy starts code-server with `--ignore-last-opened` on the directory in
 * `CODE_WORKING_DIRECTORY`, so it never reopens the editors of an earlier session and the
 * notebook has to be requested per session. `payload` is how the web workbench takes that
 * request; a build that does not understand it still opens the folder, leaving the
 * notebook one click away in the explorer.
 */
const vscodeUrl = (): string => {
  const root = serverRoot();
  const payload = JSON.stringify([
    ['openFile', `vscode-remote://${root}/${TUTORIAL_NOTEBOOK}`]
  ]);

  const query = new URLSearchParams({ folder: root, payload });
  return `${PageConfig.getBaseUrl()}vscode/?${query.toString()}`;
};

const desktopUrl = (): string => `${PageConfig.getBaseUrl()}desktop`;

/**
 * A panel that embeds one of the proxied applications in an iframe.
 */
class AppFrame extends Widget {
  constructor(options: AppFrame.IOptions) {
    super();
    this.addClass('jp-DesktopWidget');
    this.node.style.height = '100%';
    this.node.style.display = 'flex';
    this.node.style.flexDirection = 'column';

    // Escape hatch: an app that refuses to be embedded leaves a blank panel, and a live
    // session should not end there.
    const header = document.createElement('div');
    header.className = 'jp-DesktopWidget-header';
    header.style.display = 'flex';
    header.style.flex = '0 0 auto';
    header.style.justifyContent = 'flex-end';
    header.style.padding = '2px 4px';

    const externalLink = document.createElement('a');
    externalLink.className = 'jp-DesktopWidget-externalLink';
    externalLink.textContent = 'Open in new tab';
    externalLink.href = options.url;
    externalLink.target = '_blank';
    externalLink.rel = 'noopener';
    externalLink.title = `Open ${options.title} in a new browser tab`;
    externalLink.style.fontSize = 'var(--jp-ui-font-size0, 11px)';
    header.appendChild(externalLink);

    const iframe = document.createElement('iframe');
    iframe.className = 'jp-DesktopWidget-frame';
    iframe.src = options.url;
    iframe.setAttribute('title', options.title);
    iframe.setAttribute('allow', 'clipboard-read; clipboard-write');
    iframe.style.flex = '1 1 auto';
    iframe.style.minHeight = '0';
    iframe.style.width = '100%';
    iframe.style.border = '0';

    this.node.appendChild(header);
    this.node.appendChild(iframe);
  }
}

namespace AppFrame {
  export interface IOptions {
    /** Human readable name of the embedded application. */
    title: string;
    /** URL the iframe loads. */
    url: string;
  }
}

const plugin: JupyterFrontEndPlugin<void> = {
  id: 'desktop-widget:plugin',
  autoStart: true,
  requires: [ILabShell, ILayoutRestorer],
  optional: [ICommandPalette],
  activate: (
    app: JupyterFrontEnd,
    labShell: ILabShell,
    restorer: ILayoutRestorer,
    palette: ICommandPalette | null
  ) => {
    const desktopTracker = new WidgetTracker<MainAreaWidget<AppFrame>>({
      namespace: DESKTOP_NAMESPACE
    });
    const vscodeTracker = new WidgetTracker<MainAreaWidget<AppFrame>>({
      namespace: VSCODE_NAMESPACE
    });

    let desktopWidget: MainAreaWidget<AppFrame> | null = null;
    let vscodeWidget: MainAreaWidget<AppFrame> | null = null;

    const wait = (milliseconds: number) =>
      new Promise<void>(resolve => window.setTimeout(resolve, milliseconds));

    // The workspace stores the two panels side by side, but the shell ignores that layout
    // while it runs in simple mode, which is why the split has to be restored by hand
    // today.
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

    const openVSCode = async () => {
      if (vscodeWidget === null || vscodeWidget.isDisposed) {
        // The workspace restores a panel of its own, and a second one would claim the
        // same identifier.
        vscodeWidget = vscodeTracker.find(() => true) ?? null;
      }

      if (vscodeWidget === null || vscodeWidget.isDisposed) {
        vscodeWidget = new MainAreaWidget({
          content: new AppFrame({ title: 'Tutorial', url: vscodeUrl() })
        });
        vscodeWidget.id = 'vscode-widget';
        vscodeWidget.title.label = 'Tutorial';
        vscodeWidget.title.closable = true;
        await vscodeTracker.add(vscodeWidget);
      }

      if (!vscodeWidget.isAttached) {
        app.shell.add(vscodeWidget, 'main');
      }

      app.shell.activateById(vscodeWidget.id);
      return vscodeWidget;
    };

    const openDesktop = async () => {
      if (desktopWidget === null || desktopWidget.isDisposed) {
        desktopWidget = desktopTracker.find(() => true) ?? null;
      }

      if (desktopWidget === null || desktopWidget.isDisposed) {
        desktopWidget = new MainAreaWidget({
          content: new AppFrame({ title: 'RViz', url: desktopUrl() })
        });
        desktopWidget.id = 'desktop-widget';
        desktopWidget.title.label = 'RViz';
        desktopWidget.title.closable = true;
        await desktopTracker.add(desktopWidget);
      }

      if (!desktopWidget.isAttached) {
        // Anchored on the tutorial so RViz always ends up beside it, never on top of it.
        const options =
          vscodeWidget !== null && vscodeWidget.isAttached
            ? { mode: 'split-right' as const, ref: vscodeWidget.id }
            : { mode: 'split-right' as const };
        app.shell.add(desktopWidget, 'main', options);
      }

      app.shell.activateById(desktopWidget.id);
      return desktopWidget;
    };

    void restorer.restore(desktopTracker, {
      command: DESKTOP_COMMAND_ID,
      name: () => 'desktop'
    });

    void restorer.restore(vscodeTracker, {
      command: VSCODE_COMMAND_ID,
      name: () => 'vscode'
    });

    app.commands.addCommand(DESKTOP_COMMAND_ID, {
      label: 'Open RViz',
      execute: () => openDesktop()
    });

    app.commands.addCommand(VSCODE_COMMAND_ID, {
      label: 'Open Tutorial in VSCode',
      execute: () => openVSCode()
    });

    if (palette) {
      for (const command of [VSCODE_COMMAND_ID, DESKTOP_COMMAND_ID]) {
        palette.addItem({ command, category: PALETTE_CATEGORY });
      }
    }

    void app.restored.then(async () => {
      const autoOpenVSCode = startupFlag('autoOpenVSCode', true);
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

      if (autoOpenVSCode) {
        await openVSCode();
      }

      if (autoOpenDesktop) {
        await openDesktop();
      }

      // The reader starts in the tutorial, with RViz next to it.
      if (autoOpenVSCode && vscodeWidget !== null && !vscodeWidget.isDisposed) {
        app.shell.activateById(vscodeWidget.id);
      }
    });
  }
};

export default plugin;
