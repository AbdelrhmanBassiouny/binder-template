"""
The kitchen the tutorial plays in.

The world is parsed from a URDF file of a small kitchen. The URDF only knows
geometry, so this module also stocks the kitchen for the story: it hangs a shelf
layer into the fridge and stands a carton of milk on it.
"""

import io
import os
from contextlib import contextmanager, redirect_stderr, redirect_stdout
from importlib.resources import files
from pathlib import Path

import numpy as np

from krrood.entity_query_language.factories import the
from semantic_digital_twin.adapters.urdf import URDFParser
from semantic_digital_twin.semantic_annotations.semantic_annotations import (
    Fridge,
    Milk,
    ShelfLayer,
)
from semantic_digital_twin.spatial_types.spatial_types import (
    HomogeneousTransformationMatrix,
)
from semantic_digital_twin.world import World
from semantic_digital_twin.world_description.geometry import Color, Scale

SHELF_LAYER_SCALE = Scale(0.45, 0.5, 0.02)
"""
The extents of the shelf layer the milk stands on.

Fits into the fridge cavity, which is about 0.03 meters narrower than the shell
on every side.
"""

SHELF_LAYER_COLOR = Color(0.9, 0.93, 0.95)
"""
The colour of the shelf layer, an off-white against the fridge's own shell.
"""

FRIDGE_T_SHELF_LAYER = HomogeneousTransformationMatrix.from_xyz_rpy(
    0.0, 0.02, 0.0, yaw=np.pi
)
"""
The shelf layer in the fridge frame, centered in the cavity.

The kitchen places its fridge turned by half a turn against the room, so the
layer turns back: everything spawned below it is then aligned with the room, and
grasped from the front like any other object standing in it.
"""

SHELF_LAYER_T_MILK = HomogeneousTransformationMatrix.from_xyz_rpy(-0.16, 0.0, 0.11)
"""
The milk on the shelf layer, standing near its front edge.

Layer x runs towards the fridge opening, and the layer is 0.4 meters deep, so
this leaves the 0.065 meter carton just clear of the edge. The further forward
it stands, the further back the robot can stand to take it, and the less it has
to lean into the swing of the open door.
"""

MILK_NAME = "milk"
"""
Name of the transported body.
"""

SHELF_LAYER_NAME = "fridge_shelf"
"""
Name of the shelf layer the milk stands on.
"""

MILK_SCALE = Scale(0.065, 0.065, 0.2)
"""
The extents of the milk carton.
"""


@contextmanager
def muted_output():
    """
    Silence the standard output and error streams, both at the Python level and
    at the file descriptor level, for the duration of the context.
    """
    saved_fds = [os.dup(fd) for fd in (1, 2)]
    devnull_fd = os.open(os.devnull, os.O_WRONLY)
    try:
        for fd in (1, 2):
            os.dup2(devnull_fd, fd)
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            yield
    finally:
        for fd, saved_fd in zip((1, 2), saved_fds):
            os.dup2(saved_fd, fd)
            os.close(saved_fd)
        os.close(devnull_fd)


def load_kitchen() -> World:
    """
    Parse the kitchen world from its URDF file.

    :return: the parsed world, not yet stocked
    """
    world_path = os.path.join(
        Path(files("coraplex")).parent.parent,
        "resources",
        "worlds",
        "kitchen-small.urdf",
    )
    with muted_output():
        return URDFParser.from_file(world_path).parse()


def stock_the_fridge(world: World) -> None:
    """
    Hang a shelf layer into the fridge and stand the milk carton on it.

    :param world: the kitchen world to stock
    """
    fridge_annotation = the(Fridge).first()
    shelf_layer = ShelfLayer.get_annotation_specification(
        SHELF_LAYER_NAME,
        ShelfLayer.get_default_root_kinematic_structure_entity_specification(
            scale=SHELF_LAYER_SCALE
        ),
    ).spawn(
        world,
        parent=fridge_annotation.root,
        parent_T_self=FRIDGE_T_SHELF_LAYER,
    )
    with world.modify_world():
        fridge_annotation.add(shelf_layer)
        for shape in shelf_layer.root.visual.shapes:
            shape.color = SHELF_LAYER_COLOR

    Milk.get_annotation_specification(
        MILK_NAME,
        Milk.get_default_root_kinematic_structure_entity_specification(
            scale=MILK_SCALE
        ),
    ).spawn(world, parent=shelf_layer.root, parent_T_self=SHELF_LAYER_T_MILK)
