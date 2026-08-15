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
import { NotebookActions, NotebookPanel } from '@jupyterlab/notebook';
import { Cell } from '@jupyterlab/cells';
import { Widget } from '@lumino/widgets';

const COMMAND_ID = 'desktop-widget:open';
const SHOW_DESKTOP_COMMAND_ID = 'desktop-widget:show-desktop';
const SHOW_VSCODE_COMMAND_ID = 'desktop-widget:show-vscode';
const SWITCH_COMMAND_ID = 'desktop-widget:switch-app';
const NAMESPACE = 'desktop-widget';
const DEFAULT_NOTEBOOK = 'notebooks/demo.ipynb';
const FILE_BROWSER_ID = 'filebrowser';
const PALETTE_CATEGORY = 'Demo';

// Leaving simple mode makes the shell restore the deferred main area layout in the
// background, so the widgets opened at startup have to wait for it. There is no signal
// for the end of that restoration, hence the fixed delay.
const LAYOUT_RESTORE_DELAY_MS = 300;

type AppId = 'desktop' | 'vscode';

interface IAppDefinition {
  id: AppId;
  label: string;
  title: string;
  /** Path appended to the JupyterLab base URL. */
  path: string;
}

const APPS: IAppDefinition[] = [
  { id: 'vscode', label: 'VSCode', title: 'VSCode', path: 'vscode/' },
  { id: 'desktop', label: 'Desktop', title: 'Remote Desktop', path: 'desktop' }
];

// The tutorial is written in VSCode, so the panel opens there and RViz is one click away.
const DEFAULT_APP: AppId = 'vscode';

const startupFlag = (name: string, defaultValue = true): boolean => {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get(name);
  if (raw === null) {
    return defaultValue;
  }

  const normalized = raw.trim().toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(normalized);
};

const startupApp = (name: string, defaultValue: AppId = DEFAULT_APP): AppId => {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get(name);
  if (raw === null) {
    return defaultValue;
  }

  const normalized = raw.trim().toLowerCase();
  const match = APPS.find(app => app.id === normalized);
  return match ? match.id : defaultValue;
};

/**
 * A panel that embeds VSCode and the remote desktop, and switches between them
 * without reloading either one.
 */
class DesktopContent extends Widget {
  constructor(initialApp: AppId = DEFAULT_APP) {
    super();
    this.addClass('jp-DesktopWidget');
    this.node.style.height = '100%';
    this.node.style.display = 'flex';
    this.node.style.flexDirection = 'column';

    this._switcher = document.createElement('div');
    this._switcher.className = 'jp-DesktopWidget-switcher';
    this._switcher.style.display = 'flex';
    this._switcher.style.flex = '0 0 auto';
    this._switcher.style.gap = '4px';
    this._switcher.style.padding = '4px';
    this._switcher.style.borderBottom =
      '1px solid var(--jp-border-color2, #ddd)';
    this._switcher.style.background =
      'var(--jp-layout-color1, var(--jp-layout-color0, #fff))';

    for (const app of APPS) {
      const button = document.createElement('button');
      button.className = 'jp-Button jp-DesktopWidget-switcherButton';
      button.textContent = app.label;
      button.title = `Show ${app.title}`;
      button.dataset.appId = app.id;
      button.style.cursor = 'pointer';
      button.addEventListener('click', () => this.showApp(app.id));
      this._switcher.appendChild(button);
      this._buttons.set(app.id, button);
    }

    // Escape hatch: some apps refuse to be embedded in an iframe, and a live
    // demo should not get stuck on a blank panel.
    this._externalLink = document.createElement('a');
    this._externalLink.className = 'jp-DesktopWidget-externalLink';
    this._externalLink.textContent = 'Open in new tab';
    this._externalLink.target = '_blank';
    this._externalLink.rel = 'noopener';
    this._externalLink.style.marginLeft = 'auto';
    this._externalLink.style.alignSelf = 'center';
    this._externalLink.style.paddingRight = '4px';
    this._externalLink.style.fontSize = 'var(--jp-ui-font-size0, 11px)';
    this._switcher.appendChild(this._externalLink);

    this._frames = document.createElement('div');
    this._frames.className = 'jp-DesktopWidget-frames';
    this._frames.style.position = 'relative';
    this._frames.style.flex = '1 1 auto';
    this._frames.style.minHeight = '0';

    this.node.appendChild(this._switcher);
    this.node.appendChild(this._frames);

    this.showApp(initialApp);
  }

  /**
   * The application currently visible in the panel.
   */
  get currentApp(): AppId {
    return this._currentApp;
  }

  /**
   * Show one of the embedded applications, creating its iframe on first use.
   *
   * Iframes are kept alive and only hidden, so switching back keeps the running
   * desktop session and the open editor tabs.
   */
  showApp(appId: AppId): void {
    const app = APPS.find(candidate => candidate.id === appId);
    if (!app) {
      return;
    }

    this._ensureFrame(app);
    this._currentApp = app.id;

    this._iframes.forEach((iframe, id) => {
      iframe.style.display = id === app.id ? 'block' : 'none';
    });

    this._buttons.forEach((button, id) => {
      const selected = id === app.id;
      button.classList.toggle('jp-mod-styled', selected);
      button.disabled = selected;
      button.setAttribute('aria-pressed', String(selected));
    });

    this._externalLink.href = `${PageConfig.getBaseUrl()}${app.path}`;
    this._externalLink.title = `Open ${app.title} in a new browser tab`;

    this._appChanged();
  }

  /**
   * Show the next application in the list, wrapping around at the end.
   */
  switchApp(): void {
    const index = APPS.findIndex(app => app.id === this._currentApp);
    const next = APPS[(index + 1) % APPS.length];
    this.showApp(next.id);
  }

  /**
   * Called whenever the visible application changes.
   */
  onAppChanged: (appId: AppId) => void = () => undefined;

  private _appChanged(): void {
    try {
      this.onAppChanged(this._currentApp);
    } catch (error) {
      console.error('Failed to notify about the active app', error);
    }
  }

  private _ensureFrame(app: IAppDefinition): void {
    if (this._iframes.has(app.id)) {
      return;
    }

    const iframe = document.createElement('iframe');
    iframe.className = `jp-DesktopWidget-frame jp-DesktopWidget-frame-${app.id}`;
    iframe.src = `${PageConfig.getBaseUrl()}${app.path}`;
    iframe.setAttribute('title', app.title);
    iframe.setAttribute('allow', 'clipboard-read; clipboard-write');
    iframe.style.position = 'absolute';
    iframe.style.inset = '0';
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = '0';
    iframe.style.display = 'none';

    this._frames.appendChild(iframe);
    this._iframes.set(app.id, iframe);
  }

  private _currentApp: AppId = DEFAULT_APP;
  private _switcher: HTMLDivElement;
  private _externalLink: HTMLAnchorElement;
  private _frames: HTMLDivElement;
  private _iframes = new Map<AppId, HTMLIFrameElement>();
  private _buttons = new Map<AppId, HTMLButtonElement>();
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

    const titleFor = (appId: AppId): string => {
      const definition = APPS.find(candidate => candidate.id === appId);
      return definition ? definition.label : 'Desktop';
    };

    const openWidget = async (appId?: AppId) => {
      if (widget === null || widget.isDisposed) {
        // The workspace restores a desktop widget of its own, and a second one would
        // claim the same identifier.
        widget = tracker.find(() => true) ?? null;
      }

      if (widget === null || widget.isDisposed) {
        const content = new DesktopContent(appId ?? startupApp('startApp'));
        widget = new MainAreaWidget({ content });
        widget.id = 'desktop-widget';
        widget.title.label = titleFor(content.currentApp);
        widget.title.closable = true;
        content.onAppChanged = (current: AppId) => {
          if (widget && !widget.isDisposed) {
            widget.title.label = titleFor(current);
          }
        };
        await tracker.add(widget);
      } else if (appId) {
        widget.content.showApp(appId);
      }

      if (!widget.isAttached) {
        app.shell.add(widget, 'main', { mode: 'split-right' });
      }

      app.shell.activateById(widget.id);
      return widget;
    };

    const autoRunNotebookCell = async (panel: NotebookPanel) => {
      try {
        await panel.revealed;
        await panel.context.ready;
        await panel.sessionContext.ready;

        const firstCodeCellIndex = panel.content.widgets.findIndex(
          (cell: Cell) => cell.model.type === 'code'
        );

        if (firstCodeCellIndex === -1) {
          return;
        }

        panel.content.activeCellIndex = firstCodeCellIndex;
        await NotebookActions.run(panel.content, panel.sessionContext);
      } catch (error) {
        console.error(
          `Failed to auto-run the first code cell in ${DEFAULT_NOTEBOOK}`,
          error
        );
      }
    };

    const openNotebook = async () => {
      try {
        const widget = await docManager.openOrReveal(DEFAULT_NOTEBOOK, 'Notebook');
        if (widget instanceof NotebookPanel) {
          void autoRunNotebookCell(widget);
        }
        return widget;
      } catch (error) {
        console.error(`Failed to open ${DEFAULT_NOTEBOOK}`, error);
        return null;
      }
    };

    void restorer.restore(tracker, {
      command: COMMAND_ID,
      name: () => 'desktop'
    });

    app.commands.addCommand(COMMAND_ID, {
      label: 'Open Desktop',
      execute: () => openWidget()
    });

    app.commands.addCommand(SHOW_DESKTOP_COMMAND_ID, {
      label: 'Show Desktop',
      execute: () => openWidget('desktop')
    });

    app.commands.addCommand(SHOW_VSCODE_COMMAND_ID, {
      label: 'Show VSCode',
      execute: () => openWidget('vscode')
    });

    app.commands.addCommand(SWITCH_COMMAND_ID, {
      label: 'Switch Between VSCode and Desktop',
      execute: async () => {
        const panel = await openWidget();
        panel.content.switchApp();
      }
    });

    app.commands.addKeyBinding({
      command: SWITCH_COMMAND_ID,
      keys: ['Accel Shift E'],
      selector: 'body'
    });

    if (palette) {
      for (const command of [
        COMMAND_ID,
        SHOW_DESKTOP_COMMAND_ID,
        SHOW_VSCODE_COMMAND_ID,
        SWITCH_COMMAND_ID
      ]) {
        palette.addItem({ command, category: PALETTE_CATEGORY });
      }
    }

    void app.restored.then(async () => {
      const autoRun = startupFlag('autoRunUI', true);
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

      if (autoRun) {
        await openNotebook();
      }

      if (autoOpenDesktop) {
        await app.commands.execute(COMMAND_ID);
      }
    });
  }
};

export default plugin;
