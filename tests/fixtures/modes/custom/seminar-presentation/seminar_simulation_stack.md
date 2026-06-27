# Simulation and Teleoperation Stack
Unity game engine hosts simulated Mercury X1 environment and provides the VR teleoperation interface.
Meta Quest 3 provides XR visualization of robot state and is used for immersive teleoperation.
ROS# synchronizes joint angles between ROS and Unity at 30 Hz.
VR teleoperation was used to collect dual-arm manipulation demonstrations.
Teleoperation uses Unity, ROS#, Meta Quest 3, and ROS message bridging for robot control.
Camera setup includes Orbbec Deeyea 3D camera and two Logitech C920 HD webcams.
The robotic raw data acquisition procedure records synchronized camera observations, robot states, and action commands.