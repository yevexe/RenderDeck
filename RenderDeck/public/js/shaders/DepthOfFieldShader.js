/**
 * High-quality Bokeh fragment shader — dynamic ring count.
 * Drop-in replacement for Three.js BokehShader.
 *
 * Adds one extra uniform:
 *   uniform int uRings;  // 1–6, how many rings to include (default 6)
 *
 * Ring layout (max radius 0.40, matching Three.js original):
 *   Ring 1: r=0.400, 16 samples  cumulative: 16
 *   Ring 2: r=0.340, 14 samples  cumulative: 30
 *   Ring 3: r=0.280, 12 samples  cumulative: 42
 *   Ring 4: r=0.220, 10 samples  cumulative: 52
 *   Ring 5: r=0.160,  8 samples  cumulative: 60
 *   Ring 6: r=0.088,  6 samples  cumulative: 66
 *   Center:           1 sample
 *   Max total: 67
 *
 * Each ring's starting angle is rotated by π/n relative to the previous ring
 * so sample positions interleave instead of forming visible concentric discs.
 */

export const HQBokehFragmentShader = /* glsl */`
  #include <common>
  varying vec2 vUv;

  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform float maxblur;
  uniform float aperture;
  uniform float nearClip;
  uniform float farClip;
  uniform float focus;
  uniform float aspect;
  uniform int   uRings;   // 1–6

  #include <packing>

  float getDepth( const in vec2 screenPosition ) {
    #if DEPTH_PACKING == 1
      return unpackRGBAToDepth( texture2D( tDepth, screenPosition ) );
    #else
      return texture2D( tDepth, screenPosition ).x;
    #endif
  }

  float getViewZ( const in float depth ) {
    #if PERSPECTIVE_CAMERA == 1
      return perspectiveDepthToViewZ( depth, nearClip, farClip );
    #else
      return orthographicDepthToViewZ( depth, nearClip, farClip );
    #endif
  }

  void main() {
    vec2 ac   = vec2( 1.0, aspect );
    vec2 blur = vec2( clamp( ( focus + getViewZ( getDepth( vUv ) ) ) * aperture,
                             -maxblur, maxblur ) );

    // ── All 66 ring sample offsets ────────────────────────────────────────
    // Declared as a const array so the compiler can optimise freely.
    // Indices 0-15  → Ring 1  (r=0.400, rot=0)
    // Indices 16-29 → Ring 2  (r=0.340, rot=π/14)
    // Indices 30-41 → Ring 3  (r=0.280, rot=π/12)
    // Indices 42-51 → Ring 4  (r=0.220, rot=π/10)
    // Indices 52-59 → Ring 5  (r=0.160, rot=π/8)
    // Indices 60-65 → Ring 6  (r=0.088, rot=π/6)
    const vec2 S[66] = vec2[66](
      // Ring 1 — 16 samples, r=0.400, rot=0
      vec2( 0.400, 0.000), vec2( 0.370, 0.153), vec2( 0.283, 0.283), vec2( 0.153, 0.370),
      vec2( 0.000, 0.400), vec2(-0.153, 0.370), vec2(-0.283, 0.283), vec2(-0.370, 0.153),
      vec2(-0.400, 0.000), vec2(-0.370,-0.153), vec2(-0.283,-0.283), vec2(-0.153,-0.370),
      vec2( 0.000,-0.400), vec2( 0.153,-0.370), vec2( 0.283,-0.283), vec2( 0.370,-0.153),
      // Ring 2 — 14 samples, r=0.340, rot=π/14
      vec2( 0.332, 0.076), vec2( 0.266, 0.212), vec2( 0.141, 0.309), vec2( 0.000, 0.340),
      vec2(-0.141, 0.309), vec2(-0.266, 0.212), vec2(-0.332, 0.076), vec2(-0.332,-0.076),
      vec2(-0.266,-0.212), vec2(-0.141,-0.309), vec2( 0.000,-0.340), vec2( 0.141,-0.309),
      vec2( 0.266,-0.212), vec2( 0.332,-0.076),
      // Ring 3 — 12 samples, r=0.280, rot=π/12
      vec2( 0.270, 0.072), vec2( 0.198, 0.198), vec2( 0.072, 0.270), vec2(-0.072, 0.270),
      vec2(-0.198, 0.198), vec2(-0.270, 0.072), vec2(-0.270,-0.072), vec2(-0.198,-0.198),
      vec2(-0.072,-0.270), vec2( 0.072,-0.270), vec2( 0.198,-0.198), vec2( 0.270,-0.072),
      // Ring 4 — 10 samples, r=0.220, rot=π/10
      vec2( 0.209, 0.068), vec2( 0.129, 0.178), vec2( 0.000, 0.220), vec2(-0.129, 0.178),
      vec2(-0.209, 0.068), vec2(-0.209,-0.068), vec2(-0.129,-0.178), vec2( 0.000,-0.220),
      vec2( 0.129,-0.178), vec2( 0.209,-0.068),
      // Ring 5 —  8 samples, r=0.160, rot=π/8
      vec2( 0.148, 0.061), vec2( 0.061, 0.148), vec2(-0.061, 0.148), vec2(-0.148, 0.061),
      vec2(-0.148,-0.061), vec2(-0.061,-0.148), vec2( 0.061,-0.148), vec2( 0.148,-0.061),
      // Ring 6 —  6 samples, r=0.088, rot=π/6
      vec2( 0.076, 0.044), vec2( 0.000, 0.088), vec2(-0.076, 0.044),
      vec2(-0.076,-0.044), vec2( 0.000,-0.088), vec2( 0.076,-0.044)
    );

    // Cumulative sample count per ring (index = rings-1)
    const int ENDS[6] = int[6]( 16, 30, 42, 52, 60, 66 );

    int count = ENDS[ clamp( uRings - 1, 0, 5 ) ];

    vec4 col = texture2D( tColor, vUv );   // centre sample
    for ( int i = 0; i < 66; i++ ) {
      if ( i >= count ) break;
      col += texture2D( tColor, vUv + S[i] * ac * blur );
    }

    gl_FragColor   = col / float( count + 1 );
    gl_FragColor.a = 1.0;
  }
`;
