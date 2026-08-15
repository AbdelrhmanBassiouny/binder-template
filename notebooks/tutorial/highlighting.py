"""
Highlighting query results in the RViz rendering of the world.

The tool of this module answers one question: "which bodies did my query just
find?". It draws a colored overlay over those bodies in RViz, without touching
the world itself: each highlight is a copy of the body's shapes, dyed in the
requested color and grown a little, published on a topic of its own. Clearing
the highlights therefore never has to restore anything, it just deletes the
overlay.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Iterator, List, Tuple

from rclpy.node import Node
from rclpy.publisher import Publisher
from rclpy.qos import DurabilityPolicy, QoSProfile
from std_msgs.msg import ColorRGBA
from visualization_msgs.msg import Marker, MarkerArray

from semantic_digital_twin.adapters.ros.msg_converter import SemDTToRos2Converter
from semantic_digital_twin.world_description.geometry import Color
from semantic_digital_twin.world_description.world_entity import Body

HIGHLIGHT_COLOR = Color(1.0, 0.0, 1.0)
"""
The color a highlight has when no other color is asked for, a magenta that
nothing in the kitchen wears.
"""


def bodies_of(queried: Any) -> Iterator[Body]:
    """
    Yield every body a query result stands for.

    Accepts whatever a query hands back: a body, a semantic annotation such as
    a fridge or a handle, a list of either, a not yet evaluated query, or any
    nesting of those.

    :param queried: the query result to take the bodies of
    """
    if hasattr(queried, "tolist"):
        queried = queried.tolist()
    if isinstance(queried, Body):
        yield queried
        return
    entities = getattr(queried, "kinematic_structure_entities", None)
    if entities is not None:
        yield from (entity for entity in entities if isinstance(entity, Body))
        return
    try:
        items = iter(queried)
    except TypeError:
        raise TypeError(
            f"Cannot highlight {queried!r}: it is neither a body, nor a semantic "
            f"annotation, nor a query or collection of those."
        ) from None
    for item in items:
        yield from bodies_of(item)


@dataclass
class Highlighter:
    """
    Draws colored overlays over bodies in RViz, to point at what a query found.

    Highlights accumulate call by call, each with its own color, so the results
    of several queries can be told apart in one picture. Highlighting a body
    again repaints it, and :meth:`clear` takes down everything at once.
    """

    node: Node = field(kw_only=True)
    """
    The ROS node the overlay markers are published through.
    """

    topic_name: str = "/semworld/highlights"
    """
    The topic the overlay markers are published on.
    """

    growth: float = 1.05
    """
    How much larger than the body its overlay is drawn, so it envelops the
    body instead of flickering against its surface.
    """

    _markers: Dict[Tuple[str, int], Marker] = field(init=False, default_factory=dict)
    """
    Every currently shown overlay marker, keyed by namespace and id.
    """

    _publisher: Publisher = field(init=False)
    """
    The ROS publisher of the overlay markers.
    """

    def __post_init__(self):
        self._publisher = self.node.create_publisher(
            MarkerArray,
            self.topic_name,
            QoSProfile(depth=1, durability=DurabilityPolicy.TRANSIENT_LOCAL),
        )

    def highlight(self, *queried: Any, color: Color = HIGHLIGHT_COLOR) -> None:
        """
        Highlight the bodies behind the given query results in RViz.

        :param queried: what to highlight, see :func:`bodies_of`
        :param color: the color of the highlight
        """
        for argument in queried:
            for body in bodies_of(argument):
                for marker in self._overlay_of(body, color):
                    self._markers[(marker.ns, marker.id)] = marker
        self._publish()

    def clear(self) -> None:
        """
        Take down every highlight.
        """
        self._markers.clear()
        self._publish()

    def _overlay_of(self, body: Body, color: Color) -> List[Marker]:
        """
        Build the overlay markers of one body: its shapes, dyed and grown.

        :param body: the body to build the overlay of
        :param color: the color to dye the overlay in
        :return: the overlay markers
        """
        shapes = body.visual.shapes or body.collision.shapes
        overlay = []
        for index, shape in enumerate(shapes):
            marker = SemDTToRos2Converter.convert(shape)
            marker.color = ColorRGBA(r=color.R, g=color.G, b=color.B, a=color.A)
            marker.mesh_use_embedded_materials = False
            marker.scale.x *= self.growth
            marker.scale.y *= self.growth
            marker.scale.z *= self.growth
            marker.frame_locked = True
            marker.ns = str(body.name)
            marker.id = index
            overlay.append(marker)
        return overlay

    def _publish(self) -> None:
        """
        Publish the complete current overlay, preceded by a delete of the
        previous one. Late subscribers replay the latched message, so a freshly
        connected RViz shows the same highlights as one that watched all along.
        """
        wipe = Marker()
        wipe.action = Marker.DELETEALL
        self._publisher.publish(
            MarkerArray(markers=[wipe, *self._markers.values()])
        )
