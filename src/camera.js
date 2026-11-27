// 相机：平移 / 缩放 / 旋转，带平滑插值
import * as THREE from 'three';
import { N } from './config.js';

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.target = new THREE.Vector3(-5, 0, 0);
    this.goal = this.target.clone();
    this.yaw = 0.55; this.yawGoal = this.yaw;
    this.pitch = 0.92; this.pitchGoal = this.pitch;
    this.dist = 24; this.distGoal = this.dist;
    this.keys = new Set();
  }

  pan(dx, dz) {
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    this.goal.x += dx * c + dz * s;
    this.goal.z += -dx * s + dz * c;
    const lim = N / 2 + 2;
    this.goal.x = Math.max(-lim, Math.min(lim, this.goal.x));
    this.goal.z = Math.max(-lim, Math.min(lim, this.goal.z));
  }
  // 以屏幕像素拖动，换算成大致的世界距离
  panPixels(px, py, viewH) {
    const k = (2 * this.dist * Math.tan((this.camera.fov * Math.PI) / 360)) / viewH;
    this.pan(-px * k, -py * k / Math.sin(this.pitch));
  }
  zoom(f) { this.distGoal = Math.max(7, Math.min(62, this.distGoal * f)); }
  rotate(d) { this.yawGoal += d; }
  tilt(d) { this.pitchGoal = Math.max(0.5, Math.min(1.35, this.pitchGoal + d)); }

  update(dt) {
    const sp = 18 * dt * (this.dist / 24);
    let kx = 0, kz = 0;
    if (this.keys.has('w') || this.keys.has('arrowup')) kz -= 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) kz += 1;
    if (this.keys.has('a') || this.keys.has('arrowleft')) kx -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) kx += 1;
    if (kx || kz) this.pan(kx * sp, kz * sp);
    const k = 1 - Math.exp(-dt * 10);
    this.target.lerp(this.goal, k);
    this.yaw += (this.yawGoal - this.yaw) * k;
    this.pitch += (this.pitchGoal - this.pitch) * k;
    this.dist += (this.distGoal - this.dist) * k;
    const cp = Math.cos(this.pitch);
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * cp * this.dist,
      this.target.y + Math.sin(this.pitch) * this.dist,
      this.target.z + Math.cos(this.yaw) * cp * this.dist,
    );
    this.camera.lookAt(this.target);
  }
}
