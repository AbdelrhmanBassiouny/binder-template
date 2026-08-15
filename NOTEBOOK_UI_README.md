# Notebook UI README

A reader who opens the Binder link lands in the tutorial itself. The session shows two
panels and nothing else: `notebooks/ijcai_demo.ipynb` open in VSCode, and RViz next to it.

## What happens on startup

- the JupyterLab extension leaves the simple interface, because the split layout is only
  restored in the multiple document interface
- the file browser is taken out of the sidebar and the sidebar is collapsed
- VSCode opens on the left with `notebooks/ijcai_demo.ipynb` already open, and the desktop
  with RViz opens on the right
- the tutorial panel gets the focus, so the reader starts on the first cell

## The two panels of the session

| Panel | Tab | What it is |
|-------|-----|------------|
| left | `Tutorial` | VSCode, served by the `vscode` proxy, with the tutorial notebook open |
| right | `RViz` | the Xpra desktop, served by the `desktop` proxy, with RViz on it |

Both are iframes onto the same session, so the notebook in VSCode and RViz on the desktop
talk to the same ROS graph.

`Open in new tab` above each panel opens that app in a browser tab of its own, which is
the way out if an app ever refuses to be embedded, and a way to give one of them the full
screen.

VSCode is asked to open the notebook through its URL:

```text
{base}/vscode/?folder=/home/repo&payload=[["openFile","vscode-remote:///home/repo/notebooks/ijcai_demo.ipynb"]]
```

The proxy starts code-server with `--ignore-last-opened`, so it never reopens the editors
of an earlier session and the notebook has to be requested on every launch. To point the
session at another notebook, change `TUTORIAL_NOTEBOOK` at the top of
[binder/desktop-widget/src/index.ts](binder/desktop-widget/src/index.ts).

The notebook runs on the Jupyter extension of VSCode, which the base image installs
together with the Python extension. Its kernels inherit the environment of the Jupyter
server, so the ROS workspace sourced in [binder/entrypoint.sh](binder/entrypoint.sh) is on
their path.

## The selector UI is no longer part of the startup

`notebooks/demo.ipynb` and `notebooks/demo_ui.py` are still in the repository and still
work when opened by hand, but nothing opens them any more: the session starts in the
tutorial. The sections about the selector below are kept for that reason.

## How to disable the startup automation

The JupyterLab extension supports URL flags so other users can opt out without editing code.

Available flags:

- `autoOpenVSCode=0` disables opening the tutorial in VSCode
- `autoOpenDesktop=0` disables opening the desktop with RViz
- `autoCollapseLeft=0` keeps the left sidebar open
- `hideFileBrowser=0` keeps the file browser in the sidebar, if it is enabled at all

Example:

```text
...?urlpath=lab/workspaces/new-workspace?autoOpenVSCode=0&autoOpenDesktop=0&autoCollapseLeft=0
```

Both panels are also in the command palette under `Demo`, as `Open Tutorial in VSCode`
and `Open RViz`, so a reader who closes one can bring it back.

The file browser is disabled for good in [binder/Dockerfile](binder/Dockerfile), so
`hideFileBrowser=0` only brings it back in a setup that does not disable the
`@jupyterlab/filebrowser-extension:widget` plugin. To get the file browser back on Binder,
drop the `jupyter labextension disable` line from the Dockerfile.

Accepted false-like values are:

- `0`
- `false`
- `off`
- `no`

If the flag is missing, the default behavior stays enabled.

## Editor hints in the notebook

> These settings apply to notebooks opened in JupyterLab. The tutorial itself now opens in
> VSCode, which brings its own completion and hover documentation through the Python
> extension, so they no longer affect what the reader of the tutorial sees.

A plain notebook offers no completion until you press `Tab` and no documentation until you
press `Shift+Tab`, which readers of a tutorial rarely discover. `jupyterlab-lsp` and
`python-lsp-server` in [requirements.txt](requirements.txt) put a language server behind
the notebook, and [binder/jupyterlab-overrides.json](binder/jupyterlab-overrides.json)
turns its two hidden features on:

- `continuousHinting` shows the completion popup while you type instead of on `Tab`
- `autoActivate` on hover shows the documentation of a symbol without holding `Control`

`waitForBusyKernel` is turned off so completions keep coming while a demo cell is still
running.

The overrides are merged into JupyterLab's own `overrides.json` in
[binder/Dockerfile](binder/Dockerfile), so they are the defaults of a fresh session and a
reader can still change any of them under `Settings -> Settings Editor -> Code Completion`.

`python-lsp-server` is installed without its linter extras on purpose: the extras report
style warnings on every cell, which is noise in a tutorial.

## Where to edit the UI

- Tutorial notebook: [notebooks/ijcai_demo.ipynb](notebooks/ijcai_demo.ipynb)
- Startup extension, which decides what the session opens:
  [binder/desktop-widget/src/index.ts](binder/desktop-widget/src/index.ts)
- Restored layout of the two panels:
  [new-workspace.jupyterlab-workspace](new-workspace.jupyterlab-workspace)
- Selector UI, no longer opened at startup: [notebooks/demo_ui.py](notebooks/demo_ui.py)

## How to add or change buttons

The selectable values live at the top of `notebooks/demo_ui.py`:

```python
ROBOTS = ("hsrb", "stretch", "tiago", "g1", "justin", "armar7", "pr2")
ACTIONS = ("cut", "mix", "wipe")
ENVIRONMENTS = ("isr", "apartment", "kitchen")
```

To add a new button, add a new value to one of those tuples.

Example:

```python
ROBOTS = ("hsrb", "stretch", "tiago", "g1", "justin", "armar7", "pr2", "boxy")
```

The UI will render the new option automatically.

## How to use the selected values

When the user clicks `Start Demo`, the current selection is passed into the callback as:

```python
{
    "robot": "...",
    "action": "...",
    "environment": "..."
}
```

By default, `run_ui()` stores them in:

- `DEMO_ROBOT`
- `DEMO_ACTION`
- `DEMO_ENVIRONMENT`

If you want to connect the UI to your own code, pass a callback:

```python
from demo_ui import run_ui

def start_demo(selection):
    print(selection["robot"])
    print(selection["action"])
    print(selection["environment"])

run_ui(on_start=start_demo)
```

## Recommended workflow for lab authors

1. Keep one generic notebook entrypoint: `notebooks/demo.ipynb`
2. Put all UI changes in `notebooks/demo_ui.py`
3. Keep demo execution logic in normal Python modules, not in the notebook cell
4. Let the notebook only call `run_ui(...)`

## Important note

Nothing is executed for the reader any more. The tutorial notebook opens in VSCode with
its cells unrun, so the reader runs them in the order the tutorial explains.
