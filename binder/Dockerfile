# Dockerfile of the base image: https://github.com/IntEL4CoRo/jupyter-ros2/blob/main/Dockerfile
FROM intel4coro/jupyter-ros2:jazzy-py3.12

USER root
#============= Install extra software packages =============#
# RUN apt update && apt install -y curl
RUN apt update && apt install -y --no-install-recommends     graphviz     libgraphviz-dev     pkg-config     python3-dev     build-essential &&     rm -rf /var/lib/apt/lists/*

# Install python packages
COPY requirements.txt /tmp/requirements.txt
RUN python3 -m pip install -r /tmp/requirements.txt
#===========================================================#
# ------------------------------------------------------------
# Required
# ------------------------------------------------------------
USER root
RUN apt update && apt install -y --no-install-recommends \
    ros-jazzy-ros2-control \
    ros-jazzy-ros2-controllers \
    ros-jazzy-hardware-interface \
    ros-jazzy-controller-manager \
    ros-jazzy-control-msgs \
    ros-jazzy-rclpy-message-converter \
    ros-jazzy-xacro \
    ros-jazzy-rqt-joint-trajectory-controller \
    python3-vcstool \
    nodejs \
    npm \
    wmctrl && \
    rm -rf /var/lib/apt/lists/*

# ------------------------------------------------------------
# Install demo repository and cram code
#
# cognitive_robot_abstract_machine sets "package-mode = false" for poetry, so
# "poetry install" installs the workspace packages but not the meta-package itself.
# The notebooks import it (cognitive_robot_abstract_machine.orm_interfaces), so it is
# installed separately; its dependencies are the workspace packages poetry just
# installed, hence --no-deps.
#
# cram_ros2_packages carries json_msgs, which giskardpy's ROS 2 middleware imports.
# Generating the ORM interface of the experiments package imports that middleware, so
# without these messages the generation fails. Its other two packages are ROS nodes the
# notebooks never start, so they are skipped.
# ------------------------------------------------------------

RUN python3 -m pip install poetry
RUN set -ex && \
    poetry config virtualenvs.create false && \
    mkdir -p ${HOME}/libs && cd ${HOME}/libs && \
    git clone --branch ijcai-tutorial --single-branch https://github.com/AbdelrhmanBassiouny/cognitive_robot_abstract_machine.git && \
    cd cognitive_robot_abstract_machine && \
    git pull && \
    git clone https://github.com/sunava/pycram_object_gap_demo.git pycram/resources/pycram_object_gap_demo && \
    sed -i '/^[[:space:]]*random_events[[:space:]]*=.*$/d' pyproject.toml && \
    poetry install && \
    python3 -m pip install --no-deps -e . && \
    mkdir -p /workspace/ros/src && \
    cd /workspace/ros/src && \
    git clone -b ros-jazzy --single-branch https://github.com/code-iai/iai_maps.git && \
    git clone -b ros-jazzy-main --single-branch https://github.com/code-iai/iai_pr2.git && \
    git clone -b ros-jazzy --single-branch https://github.com/code-iai/iai_robots.git && \
    git clone -b ros2-jazzy --single-branch https://github.com/code-iai/iai_stretch.git && \
    git clone -b ros2-jazzy --single-branch https://github.com/code-iai/hsr_description.git && \
    git clone -b ros2-main --single-branch https://github.com/code-iai/iai_tiago_description.git && \
    git clone -b ros2-master --single-branch https://github.com/realsenseai/realsense-ros.git && \
    git clone -b jazzy --single-branch https://github.com/UniversalRobots/Universal_Robots_ROS2_Description.git && \
    git clone https://github.com/maltehue/ros2_robotiq_gripper.git && \
    rm -rf ros2_robotiq_gripper/robotiq_driver \
           ros2_robotiq_gripper/robotiq_drivers \
           ros2_robotiq_gripper/robotiq_controllers \
           ros2_robotiq_gripper/robotiq_hardware_tests  \
           realsense-ros/realsense2_ros_mqtt_bridge  \
           realsense-ros/realsense2_rgbd_plugin  \
           realsense-ros/realsense2_camera_msgs \
           realsense-ros/realsense2_camera && \
    find /workspace/ros/src -type f -name package.xml -path '*/robotiq_driver/package.xml' -execdir touch COLCON_IGNORE \; && \
    git clone https://github.com/sunava/isr_testbed.git && \
    git clone https://github.com/ipa320/cob_simulation.git && \
    git clone https://github.com/cram2/cram_ros2_packages.git && \
    cd /workspace/ros && \
    . /opt/ros/${ROS_DISTRO}/setup.sh && \
    colcon build --symlink-install \
      --packages-skip cob_gazebo_tools cob_gazebo_objects cob_gazebo_worlds cob_gazebo cob_bringup_sim cob_simulation giskardpy_ros robokudo_ros && \
    echo "source /workspace/ros/install/setup.bash" >> /root/.bashrc

# ------------------------------------------------------------
# ROS2 workspace: giskardpy_ros (clone, deps, build)
# ------------------------------------------------------------
RUN pip install xacro

ARG ROS_DISTRO=jazzy
ENV ROS_DISTRO=${ROS_DISTRO}


RUN pip install "setuptools<81"

# ------------------------------------------------------------
# Generate the ORM interfaces
#
# cognitive_robot_abstract_machine tracks every ormatic_interface.py as an empty
# placeholder, so a fresh checkout can neither read from nor write to a database until
# they are generated. Doing it here costs about a minute of build time instead of a
# minute in the first notebook cell of every session. The entrypoint regenerates them
# whenever it pulls new commits, so they never lag behind the code they map.
# ------------------------------------------------------------
RUN set -ex && \
    . /opt/ros/${ROS_DISTRO}/setup.sh && \
    . /workspace/ros/install/setup.sh && \
    cd ${HOME}/libs/cognitive_robot_abstract_machine && \
    python3 scripts/regenerate_all_orm.py

USER root
# Copy content to the image
ENV REPO_DIR=/home/repo
RUN mkdir -p ${REPO_DIR}
COPY . ${REPO_DIR}/
RUN git config --global --add safe.directory ${REPO_DIR}

# The tutorial notebook's support code, installed so `from tutorial.setup import *`
# works no matter which working directory the kernel starts in.
RUN python3 -m pip install --no-deps -e ${REPO_DIR}/notebooks

# Set JupyterLab default directory
WORKDIR ${REPO_DIR}

# Set VSCODE default directory
ENV CODE_WORKING_DIRECTORY=${REPO_DIR}

# Copy RViz config
COPY default.rviz /home/jovyan/.rviz2/default.rviz
RUN mkdir -p /home/jovyan/.ipython/profile_default/startup /root/.ipython/profile_default/startup
RUN cd ${REPO_DIR}/binder/desktop-widget && \
    npm install && \
    npm run build && \
    jupyter labextension install . --no-build && \
    jupyter lab build --minimize=False

# ------------------------------------------------------------
# Hide the file browser
#
# The desktop-widget extension opens the notebook and the desktop itself, so the file
# browser only takes up room in the interface. Disabling the plugin that puts it in the
# sidebar keeps the file browser commands other extensions rely on registered.
# ------------------------------------------------------------
RUN jupyter labextension disable --level=sys_prefix "@jupyterlab/filebrowser-extension:widget"

# ------------------------------------------------------------
# Turn the language server hints on by default
#
# jupyterlab-lsp ships with the completion popup and the hover documentation behind a
# key press, which readers of a tutorial never find. The overrides make both appear on
# their own, so the notebook offers the same hints an editor would.
#
# The base image may already carry an overrides.json, hence the merge instead of a copy.
# ------------------------------------------------------------
RUN python3 - <<'PY'
import json
import os
import sys
from pathlib import Path

overrides_file = Path(sys.prefix) / "share/jupyter/lab/settings/overrides.json"
overrides = json.loads(overrides_file.read_text()) if overrides_file.is_file() else {}

repo_overrides = Path(os.environ["REPO_DIR"]) / "binder/jupyterlab-overrides.json"

for plugin, settings in json.loads(repo_overrides.read_text()).items():
    overrides.setdefault(plugin, {}).update(settings)

overrides_file.parent.mkdir(parents=True, exist_ok=True)
overrides_file.write_text(json.dumps(overrides, indent=2) + "\n")
PY

# The entrypoint of the docker image
COPY binder/entrypoint.sh /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
