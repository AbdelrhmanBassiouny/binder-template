# Notebook UI README

This Binder setup uses a notebook-native UI instead of passing `robot`, `action`, or `environment` through the Binder URL.

## What happens on startup

- Binder opens `notebooks/demo.ipynb`
- the JupyterLab extension auto-runs the first code cell
- that cell calls `run_ui()` from `notebooks/demo_ui.py`
- the user sees the selector UI directly inside the notebook

## Switching between the Desktop and VSCode

The split panel on the right hosts both the remote desktop and VSCode. Two
buttons at the top of the panel switch between them.

- both apps stay loaded once opened, so switching back keeps the running
  desktop session and the open editor tabs
- VSCode is only loaded the first time it is selected, so the startup time of
  the demo does not change
- `Ctrl/Cmd + Shift + E` toggles between the two apps
- the command palette has `Show Desktop`, `Show VSCode` and
  `Switch Between Desktop and VSCode` under the `Demo` category

To choose which app is shown when the panel opens, use the `startApp` URL
parameter:

```text
...?urlpath=lab/workspaces/new-workspace?startApp=vscode
```

Accepted values are `desktop` (default) and `vscode`. Unknown values fall back
to `desktop`.

## How to disable the startup automation

The JupyterLab extension supports URL flags so other users can opt out without editing code.

Available flags:

- `autoRunUI=0` disables opening and auto-running `notebooks/demo.ipynb`
- `autoOpenDesktop=0` disables opening the desktop split panel
- `autoCollapseLeft=0` keeps the left sidebar open
- `startApp=vscode` opens the split panel on VSCode instead of the desktop

Example:

```text
...?urlpath=lab/workspaces/new-workspace?autoRunUI=0&autoOpenDesktop=0&autoCollapseLeft=0
```

Accepted false-like values are:

- `0`
- `false`
- `off`
- `no`

If the flag is missing, the default behavior stays enabled.

## Where to edit the UI

- Main UI code: [notebooks/demo_ui.py](/home/hassouna/binder-template/notebooks/demo_ui.py:1)
- Startup notebook: [notebooks/demo.ipynb](/home/hassouna/binder-template/notebooks/demo.ipynb:1)
- Auto-run extension: [binder/desktop-widget/src/index.ts](/home/hassouna/binder-template/binder/desktop-widget/src/index.ts:1)

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

If you add a Markdown cell above the startup code cell, Binder still works because the extension now runs the first code cell automatically.
