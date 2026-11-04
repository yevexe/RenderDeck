/**
 * Custom Vignette Shader — drop-in replacement for Three.js VignetteShader.
 *
 * Adds:
 *   uniform vec3  vignetteColor  — the tint/fade color (default black)
 *   uniform int   blendMode      — how the vignette blends with the image:
 *     0 = Normal   (lerp base → vignette color)
 *     1 = Multiply (base × vignette color, darkens)
 *     2 = Screen   (1-(1-base)(1-color), lightens)
 *     3 = Overlay  (Photoshop overlay, boosts contrast)
 *     4 = Luminosity (only alters brightness, keeps hue/sat)
 *
 * Existing uniforms offset / darkness are unchanged so all callers
 * (setVignetteIntensity, setVignetteSoftness, applyPreset) work unmodified.
 */

export const CustomVignetteShader = {
  name: 'CustomVignetteShader',

  uniforms: {
    tDiffuse:     { value: null },
    offset:       { value: 1.0 },
    darkness:     { value: 1.0 },
    vignetteColor:{ value: null }, // THREE.Color — default set in Renderer.js
    blendMode:    { value: 0 },    // int, 0–4
  },

  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float offset;
    uniform float darkness;
    uniform vec3  vignetteColor;
    uniform int   blendMode;
    varying vec2 vUv;

    /* ---------- blend helpers ---------- */
    vec3 blendMultiply(vec3 base, vec3 blend) {
      return base * blend;
    }
    vec3 blendScreen(vec3 base, vec3 blend) {
      return 1.0 - (1.0 - base) * (1.0 - blend);
    }
    vec3 blendOverlay(vec3 base, vec3 blend) {
      return mix(
        2.0 * base * blend,
        1.0 - 2.0 * (1.0 - base) * (1.0 - blend),
        step(0.5, base)
      );
    }
    float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
    /* Shift luminance of base toward target luma while keeping hue/sat */
    vec3 setLuminosity(vec3 base, float targetLuma) {
      float l = luma(base);
      return l > 0.001 ? base * (targetLuma / l) : vec3(targetLuma);
    }

    void main() {
      /* vignette mask: 1 at centre, 0 at edges */
      float dist = distance(vUv, vec2(0.5)) * offset;
      float v = smoothstep(0.8, 0.2 * offset, dist * (darkness + offset));

      vec4  texel = texture2D(tDiffuse, vUv);
      vec3  base  = texel.rgb;
      vec3  result;

      if (blendMode == 1) {
        /* Multiply — edges become base × vignetteColor */
        result = mix(blendMultiply(base, vignetteColor), base, v);
      } else if (blendMode == 2) {
        /* Screen — edges lighten toward vignetteColor */
        result = mix(blendScreen(base, vignetteColor), base, v);
      } else if (blendMode == 3) {
        /* Overlay — contrast boost toward vignetteColor */
        result = mix(blendOverlay(base, vignetteColor), base, v);
      } else if (blendMode == 4) {
        /* Luminosity — only pull luminance toward vignetteColor's luma */
        float tgtLuma = mix(luma(vignetteColor), luma(base), v);
        result = setLuminosity(base, tgtLuma);
      } else {
        /* Normal (default, mode 0) — lerp base → vignetteColor at edges.
           With vignetteColor=black this is identical to the original shader. */
        result = mix(vignetteColor, base, v);
      }

      gl_FragColor = vec4(result, texel.a);
    }
  `,
};
