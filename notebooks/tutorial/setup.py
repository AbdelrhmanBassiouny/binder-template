"""
Everything the tutorial needs before its story can start.

Importing this module once:

- generates the ORM interfaces of the workspace when a fresh checkout misses them
- starts a ROS node and publishes the world to RViz
- loads the kitchen world from its URDF file, see :mod:`tutorial.kitchen`

The names exported here are the vocabulary of the tutorial: the world and its
publishers, the Entity Query Language factories, and the handful of domain types
the story touches. Hover any of them in the notebook to see its documentation,
or jump to its definition with a control click.
"""

import importlib.util
import os
import sys
from pathlib import Path


def _ensure_ros_messages_available() -> None:
    """
    Make the ``json_msgs`` ROS package importable when the session was started
    without the workspace overlay that provides it, as an IDE-managed kernel
    typically is. The overlay is wired in through ``sys.path`` for this process
    and through the environment for the subprocesses this module spawns, such
    as the ORM interface generation.
    """
    if importlib.util.find_spec("json_msgs") is not None:
        return
    python_version = f"python{sys.version_info.major}.{sys.version_info.minor}"
    for overlay in (Path.home() / "ros2_ws" / "install", Path("/workspace/ros/install")):
        if not (overlay / "share" / "json_msgs").is_dir():
            continue
        site_packages = overlay / "lib" / python_version / "site-packages"
        sys.path.insert(0, str(site_packages))
        for name, addition in (
            ("AMENT_PREFIX_PATH", overlay),
            ("PYTHONPATH", site_packages),
            ("LD_LIBRARY_PATH", overlay / "lib"),
        ):
            os.environ[name] = f"{addition}:{os.environ.get(name, '')}"
        return


_ensure_ros_messages_available()

from cognitive_robot_abstract_machine.orm_interfaces import WORKSPACE_ORM_INTERFACES

# The repository tracks the ORM interfaces of its packages as empty placeholders,
# so a fresh checkout has to generate them once before anything can be queried
# from or written to a database.
if not WORKSPACE_ORM_INTERFACES.are_generated:
    print("Generating the ORM interfaces of the repository, this takes about a minute ...")
    WORKSPACE_ORM_INTERFACES.regenerate()
    print("Done.")

import logging

logging.disable(logging.CRITICAL)

import threading
from typing import Iterable

import numpy as np
import rclpy
from sqlalchemy.orm import sessionmaker

import coraplex.orm.ormatic_interface  # type: ignore

from coraplex.datastructures.dataclasses import Context
from coraplex.datastructures.enums import Arms
from coraplex.execution_environment import simulated_robot
from coraplex.plans.factories import sequential
from coraplex.plans.plan import Plan
from coraplex.robot_plans.actions.core.navigation import NavigateAction
from coraplex.robot_plans.actions.core.robot_body import ParkArmsAction

from krrood.entity_query_language.backends import (
    ProbabilisticBackend,
    SQLAlchemyBackend,
)
from krrood.entity_query_language.factories import *
from krrood.entity_query_language.verbalization.pipeline import (
    VerbalizationPipeline,
    verbalize_expression,
)
from krrood.entity_query_language.verbalization.fragments.base import (
    VerbalizationFragment,
)
from krrood.entity_query_language.verbalization.vocabulary.parts_of_speech import (
    Noun,
    Verb,
    clause,
)
from krrood.ormatic.data_access_objects.helper import to_dao
from krrood.ormatic.utils import create_engine

from semantic_digital_twin.adapters.ros.tf_publisher import TFPublisher
from semantic_digital_twin.adapters.ros.visualization.spatial_type_marker_renderer import (
    SpatialTypeVisualization,
)
from semantic_digital_twin.adapters.ros.visualization.spatial_type_publisher import (
    SpatialTypePublisher,
)
from semantic_digital_twin.adapters.ros.visualization.viz_marker import (
    VizMarkerPublisher,
)
from semantic_digital_twin.api import RobotSpecification
from semantic_digital_twin.reasoning.predicates import InsideOf
from semantic_digital_twin.reasoning.world_reasoner import WorldReasoner
from semantic_digital_twin.robots.pr2 import PR2
from semantic_digital_twin.semantic_annotations.mixins import IsStorageSpace
from semantic_digital_twin.semantic_annotations.semantic_annotations import (
    Fridge,
    Milk,
    ShelfLayer,
)
from semantic_digital_twin.spatial_types import Point3, Quaternion
from semantic_digital_twin.spatial_types.spatial_types import Pose
from semantic_digital_twin.world import World
from semantic_digital_twin.world_description.geometry import Color
from semantic_digital_twin.world_description.graph_of_convex_sets.base import (
    translate_free_space_to_where_condition,
)
from semantic_digital_twin.world_description.graph_of_convex_sets.boxes import (
    GraphOfBoundingBoxes,
    navigation_map_at_target,
)
from semantic_digital_twin.world_description.world_entity import (
    Body,
    KinematicStructureEntity,
)

from tutorial.highlighting import HIGHLIGHT_COLOR, Highlighter
from tutorial.kitchen import load_kitchen, muted_output, stock_the_fridge

rclpy.init()

node = rclpy.create_node("semantic_digital_twin")
"""
The ROS node the tutorial publishes the world through.
"""

_spin_thread = threading.Thread(target=rclpy.spin, args=(node,), daemon=True)
_spin_thread.start()

world: World = load_kitchen()
"""
The kitchen the tutorial plays in, see :mod:`tutorial.kitchen`.
"""

tf_publisher = TFPublisher(_world=world, node=node)
"""
Publishes the transforms of the world's bodies, so RViz can place them.
"""

viz = VizMarkerPublisher(_world=world, node=node)
"""
Publishes the world's bodies as markers, so RViz can draw them.
"""

points_publisher = SpatialTypePublisher(
    _world=world, node=node, topic_name="/semworld/sampled_points"
)
"""
Publishes loose points into RViz, used to look at the results of queries.
"""


highlighter = Highlighter(node=node)
"""
Draws colored overlays over bodies in RViz, see :mod:`tutorial.highlighting`.
"""


def highlight(*queried, color: Color = HIGHLIGHT_COLOR) -> None:
    """
    Show in RViz which bodies a query found, by drawing a colored overlay over
    them. Takes bodies, semantic annotations, queries, or lists of those, in
    any mix. Highlights add up call by call, so different queries can wear
    different colors; :func:`clear_highlights` takes all of them down.

    :param queried: what to highlight
    :param color: the color of the highlight, magenta by default
    """
    highlighter.highlight(*queried, color=color)


def clear_highlights() -> None:
    """
    Take down every highlight drawn by :func:`highlight`.
    """
    highlighter.clear()


def show_points(points: Iterable[Point3], color: Color = Color(0.0, 1.0, 0.0)) -> None:
    """
    Draw the given points in RViz, replacing whatever points were drawn before.

    :param points: the points to draw
    :param color: the color to draw them in, green by default
    """
    points_publisher.set_requests(
        SpatialTypeVisualization(spatial_type=point, color=color) for point in points
    )


def clear_points() -> None:
    """
    Remove all points drawn by :func:`show_points` from RViz.
    """
    points_publisher.clear()


def spawn_pr2() -> PR2:
    """
    Spawn a PR2 robot into the world and return its annotation.
    """
    with muted_output():
        return RobotSpecification(semantic_annotation_type=PR2).spawn(world)


def make_long_term_memory() -> SQLAlchemyBackend:
    """
    Create an empty long term memory: a relational database held in memory,
    wrapped as a backend that the Entity Query Language can evaluate against.

    :return: the backend around the fresh database
    """
    session_maker = sessionmaker(bind=create_engine("sqlite:///:memory:"))
    coraplex.orm.ormatic_interface.Base.metadata.create_all(bind=session_maker().bind)
    return SQLAlchemyBackend(session_maker)


print("The kitchen is up. Find it rendered in RViz, on the right.")
