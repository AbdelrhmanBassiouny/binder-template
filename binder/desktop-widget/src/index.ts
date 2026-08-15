import {
  ILabShell,
  ILayoutRestorer,
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { MainAreaWidget, WidgetTracker } from '@jupyterlab/apputils';
import { PageConfig } from '@jupyterlab/coreutils';
import { IDocumentManager } from '@jupyterlab/docmanager';
import { NotebookActions, NotebookPanel } from '@jupyterlab/notebook';
import { Cell } from '@jupyterlab/cells';
import { Widget } from '@lumino/widgets';

const COMMAND_ID = 'desktop-widget:open';
const NAMESPACE = 'desktop-widget';
const DEFAULT_NOTEBOOK = 'notebooks/demo.ipynb';
const FILE_BROWSER_ID = 'filebrowser';

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

class DesktopContent extends Widget {
  constructor() {
    super();
    this.addClass('jp-DesktopWidget');
    this.node.style.height = '100%';

    const iframe = document.createElement('iframe');
    iframe.className = 'jp-DesktopWidget-frame';
    iframe.src = `${PageConfig.getBaseUrl()}desktop`;
    iframe.setAttribute('title', 'Desktop');
    iframe.setAttribute('allow', 'clipboard-read; clipboard-write');
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = '0';

    this.node.appendChild(iframe);
  }
}

const plugin: JupyterFrontEndPlugin<void> = {
  id: 'desktop-widget:plugin',
  autoStart: true,
  requires: [ILabShell, ILayoutRestorer, IDocumentManager],
  activate: (
    app: JupyterFrontEnd,
    labShell: ILabShell,
    restorer: ILayoutRestorer,
    docManager: IDocumentManager
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

    const openWidget = async () => {
      if (widget === null || widget.isDisposed) {
        // The workspace restores a desktop widget of its own, and a second one would
        // claim the same identifier.
        widget = tracker.find(() => true) ?? null;
      }

      if (widget === null || widget.isDisposed) {
        widget = new MainAreaWidget({ content: new DesktopContent() });
        widget.id = 'desktop-widget';
        widget.title.label = 'Desktop';
        widget.title.closable = true;
        await tracker.add(widget);
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
      execute: openWidget
    });

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
