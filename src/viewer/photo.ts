import * as THREE from 'three';

/** The picture a camera sees of a photo sphere (z up), `fov` degrees high whatever the camera's angle (a narrower one stretches the photo's pixels): one quad over the whole target. */
export function photoPass(fov = 70) {
  const material = new THREE.ShaderMaterial({
    uniforms: { photo: { value: null }, basis: { value: new THREE.Matrix3() }, tanHalf: { value: Math.tan(THREE.MathUtils.degToRad(fov / 2)) }, aspect: { value: 1 }, turn: { value: 0 } },
    depthTest: false,
    depthWrite: false,
    vertexShader: 'varying vec2 at; void main() { at = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    // u runs against the turn around Z as seen from inside, like three's equirectangular environments
    fragmentShader: `uniform sampler2D photo; uniform mat3 basis; uniform float tanHalf; uniform float aspect; uniform float turn; varying vec2 at;
      void main() {
        vec3 d = normalize(basis * vec3(at.x * tanHalf * aspect, at.y * tanHalf, -1.0));
        gl_FragColor = texture2D(photo, vec2(fract(0.5 - atan(d.y, d.x) / 6.283185307 + turn), asin(clamp(d.z, -1.0, 1.0)) / 3.141592654 + 0.5));
        #include <colorspace_fragment>
      }`,
  });
  const scene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  scene.add(quad);
  const none = new THREE.Camera();
  return {
    /** Draws into the renderer's current target. `turn`: degrees. */
    draw(renderer: THREE.WebGLRenderer, photo: THREE.Texture, camera: THREE.Camera, aspect: number, turn: number) {
      const u = material.uniforms;
      u.photo.value = photo;
      u.basis.value.setFromMatrix4(camera.matrixWorld);
      u.aspect.value = aspect;
      u.turn.value = turn / 360;
      material.uniformsNeedUpdate = true;
      renderer.render(scene, none);
    },
    dispose() {
      quad.geometry.dispose();
      material.dispose();
    },
  };
}

/** A photo as a sphere's texture. */
export function photoTexture(image: HTMLImageElement) {
  const t = new THREE.Texture(image);
  Object.assign(t, { colorSpace: THREE.SRGBColorSpace, wrapS: THREE.RepeatWrapping, generateMipmaps: false, minFilter: THREE.LinearFilter, needsUpdate: true });
  return t;
}

export function loadImage(url: string) {
  const image = new Image();
  image.src = url;
  return image.decode().then(() => image);
}

/** A photo as the path tracer's light from all around (y up, linear). `turn`: degrees, as the background's. */
export function photoEnvironment(image: HTMLImageElement, turn: number) {
  const [w, h] = [1024, 512];
  const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(image, 0, 0, w, h);
  const from = g.getImageData(0, 0, w, h).data;
  const to = new Float32Array(w * h * 4);
  const linear = Float32Array.from({ length: 256 }, (_, v) => (v <= 10 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4)); // sRGB bytes
  const shift = Math.round(((turn / 360) * w) % w) + w;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = ((x + shift) % w) * 4 + (h - 1 - y) * w * 4; // the top row last: v 1 is up
      const o = (x + y * w) * 4;
      for (let k = 0; k < 3; k++) to[o + k] = linear[from[i + k]];
      to[o + 3] = 1;
    }
  const t = new THREE.DataTexture(to, w, h, THREE.RGBAFormat, THREE.FloatType);
  Object.assign(t, { mapping: THREE.EquirectangularReflectionMapping, wrapS: THREE.RepeatWrapping, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, needsUpdate: true });
  return t;
}
