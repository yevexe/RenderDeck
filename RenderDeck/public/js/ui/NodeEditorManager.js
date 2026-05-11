// NodeEditorManager.js — HTML node graph editor
// Nodes are plain HTML divs; only connection curves use SVG.
import { CompactColorPicker } from './Controls.js';

// ─── layout constants ─────────────────────────────────────────────────────────
const NODE_W     = 227;   // 6 cm @ 96 dpi
const PORT_R     = 7;     // port dot radius (px)
const PAD        = 10;    // inner padding
const HEADER_H   = 32;    // node header height
const PORT_ROW_H = 26;    // height per port row
const CTRL_ROW_H = 32;    // height per control row
const PREV_SZ    = NODE_W - PAD * 2;   // 207 px — square preview
const MAT_SECTION_H = 28;              // collapsible section toggle height in material-output node
const MAT_INFO_H    = 46;              // object/part name info box height in material-output node

// ─── Material Output node channel catalogue ───────────────────────────────────
const MAT_NODE_SECTIONS = [
  {
    key: 'basic', label: 'Basic',
    ports: [
      { name: 'Base Color',        key: 'baseColor',             type: 'color',   colorDef: '#ffffff', matProp: 'color'                       },
      { name: 'Metalness',         key: 'metalness',             type: 'scalar',  ctrl: { min:0,   max:1,     step:0.01,  def:0    }, matProp: 'metalness'            },
      { name: 'Metalness Map',     key: 'metalnessMap',          type: 'texture', matProp: 'metalnessMap'         },
      { name: 'Roughness',         key: 'roughness',             type: 'scalar',  ctrl: { min:0,   max:1,     step:0.01,  def:0.5  }, matProp: 'roughness'            },
      { name: 'Roughness Map',     key: 'roughnessMap',          type: 'texture', matProp: 'roughnessMap'         },
      { name: 'Specular Color',    key: 'specularColor',         type: 'color',   colorDef: '#ffffff', matProp: 'specularColor'               },
      { name: 'Specular Int.',     key: 'specularIntensity',     type: 'scalar',  ctrl: { min:0,   max:1,     step:0.01,  def:1    }, matProp: 'specularIntensity'    },
      { name: 'Specular Int. Map', key: 'specularIntensityMap',  type: 'texture', matProp: 'specularIntensityMap'  },
      { name: 'Clearcoat',         key: 'clearcoat',             type: 'scalar',  ctrl: { min:0,   max:1,     step:0.01,  def:0    }, matProp: 'clearcoat'            },
      { name: 'Clearcoat Map',     key: 'clearcoatMap',          type: 'texture', matProp: 'clearcoatMap'          },
      { name: 'Clear. Rough.',     key: 'clearcoatRoughness',    type: 'scalar',  ctrl: { min:0,   max:1,     step:0.01,  def:0.1  }, matProp: 'clearcoatRoughness'   },
      { name: 'Clear. Rough. Map', key: 'clearcoatRoughnessMap', type: 'texture', matProp: 'clearcoatRoughnessMap'  },
      { name: 'Clear. Normal Map', key: 'clearcoatNormalMap',    type: 'texture', matProp: 'clearcoatNormalMap'     },
      { name: 'Opacity',           key: 'opacity',               type: 'scalar',  ctrl: { min:0,   max:1,     step:0.01,  def:1    }, matProp: 'opacity'              },
      { name: 'Alpha Map',         key: 'alphaMap',              type: 'texture', matProp: 'alphaMap'              },
      { name: 'Transmission',      key: 'transmission',          type: 'scalar',  ctrl: { min:0,   max:1,     step:0.01,  def:0    }, matProp: 'transmission'         },
      { name: 'Transmission Map',  key: 'transmissionMap',       type: 'texture', matProp: 'transmissionMap'       },
      { name: 'IOR',               key: 'ior',                   type: 'scalar',  ctrl: { min:1,   max:2.5,   step:0.01,  def:1.5  }, matProp: 'ior'                  },
      { name: 'Thickness',         key: 'thickness',             type: 'scalar',  ctrl: { min:0,   max:5,     step:0.01,  def:0    }, matProp: 'thickness'            },
      { name: 'Thickness Map',     key: 'thicknessMap',          type: 'texture', matProp: 'thicknessMap'          },
      { name: 'Atten. Dist.',      key: 'attenuationDist',       type: 'scalar',  ctrl: { min:0,   max:100,   step:0.1,   def:0    }, matProp: 'attenuationDistance'  },
      { name: 'Atten. Color',      key: 'attenuationColor',      type: 'color',   colorDef: '#ffffff', matProp: 'attenuationColor'            },
      { name: 'Sheen Color',       key: 'sheenColor',            type: 'color',   colorDef: '#ffffff', matProp: 'sheenColor'                  },
      { name: 'Sheen Roughness',   key: 'sheenRoughness',        type: 'scalar',  ctrl: { min:0,   max:1,     step:0.01,  def:1    }, matProp: 'sheenRoughness'       },
      { name: 'Sheen Rough. Map',  key: 'sheenRoughnessMap',     type: 'texture', matProp: 'sheenRoughnessMap'     },
      { name: 'Emissive Color',    key: 'emissiveColor',         type: 'color',   colorDef: '#000000', matProp: 'emissive'                    },
      { name: 'Emissive Int.',     key: 'emissiveIntensity',     type: 'scalar',  ctrl: { min:0,   max:50,    step:0.01,  def:0    }, matProp: 'emissiveIntensity'    },
      { name: 'Env Map Int.',      key: 'envMapIntensity',       type: 'scalar',  ctrl: { min:0,   max:5,     step:0.01,  def:1    }, matProp: 'envMapIntensity'      },
      { name: 'AO Map',            key: 'aoMap',                 type: 'texture', matProp: 'aoMap'                 },
      { name: 'Bump Map',          key: 'bumpMap',               type: 'texture', matProp: 'bumpMap'               },
      { name: 'Displacement Map',  key: 'displacementMap',       type: 'texture', matProp: 'displacementMap'       },
    ],
  },
  {
    key: 'advanced', label: 'Advanced',
    ports: [
      { name: 'Anisotropy',          key: 'anisotropy',              type: 'scalar',  ctrl: { min:0,   max:1,     step:0.01,  def:0    }, matProp: 'anisotropy'                    },
      { name: 'Aniso. Rotation',     key: 'anisotropyRot',           type: 'scalar',  ctrl: { min:0,   max:6.283, step:0.01,  def:0    }, matProp: 'anisotropyRotation'            },
      { name: 'Anisotropy Map',      key: 'anisotropyMap',           type: 'texture', matProp: 'anisotropyMap'         },
      { name: 'Iridescence',         key: 'iridescence',             type: 'scalar',  ctrl: { min:0,   max:1,     step:0.01,  def:0    }, matProp: 'iridescence'                   },
      { name: 'Iridescence IOR',     key: 'iridescenceIOR',          type: 'scalar',  ctrl: { min:1,   max:2.333, step:0.001, def:1.3  }, matProp: 'iridescenceIOR'                },
      { name: 'Irid. Thick. Min',    key: 'iridThickMin',            type: 'scalar',  ctrl: { min:0,   max:1000,  step:1,     def:100  }, matProp: 'iridescenceThicknessRange_min' },
      { name: 'Irid. Thick. Max',    key: 'iridThickMax',            type: 'scalar',  ctrl: { min:0,   max:1000,  step:1,     def:400  }, matProp: 'iridescenceThicknessRange_max' },
      { name: 'Iridescence Map',     key: 'iridescenceMap',          type: 'texture', matProp: 'iridescenceMap'        },
      { name: 'Irid. Thickness Map', key: 'iridescenceThicknessMap', type: 'texture', matProp: 'iridescenceThicknessMap'},
      { name: 'Dispersion',          key: 'dispersion',              type: 'scalar',  ctrl: { min:0,   max:1,     step:0.01,  def:0    }, matProp: 'dispersion'                    },
      { name: 'Reflectivity',        key: 'reflectivity',            type: 'scalar',  ctrl: { min:0,   max:1,     step:0.01,  def:0.5  }, matProp: 'reflectivity'                  },
      { name: 'Sheen',               key: 'sheen',                   type: 'scalar',  ctrl: { min:0,   max:1,     step:0.01,  def:0    }, matProp: 'sheen'                         },
      { name: 'Normal Map',          key: 'normalMap',               type: 'texture', matProp: 'normalMap'             },
      { name: 'Normal Scale',        key: 'normalScale',             type: 'scalar',  ctrl: { min:0,   max:3,     step:0.01,  def:1    }, matProp: 'normalScale'                   },
    ],
  },
];
const MAT_ALL_PORTS = MAT_NODE_SECTIONS.flatMap(s => s.ports);

// ─── colour helpers ───────────────────────────────────────────────────────────
function hexToRgb(hex) {
  hex = hex.replace(/^#/, '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  return [parseInt(hex.slice(0,2),16), parseInt(hex.slice(2,4),16), parseInt(hex.slice(4,6),16)];
}
function rgbToHex(r,g,b) {
  return '#' + [r,g,b].map(v => Math.round(Math.max(0,Math.min(255,v))).toString(16).padStart(2,'0')).join('');
}
function blendHex(a, b, t) {
  const [r1,g1,b1] = hexToRgb(a||'#000000');
  const [r2,g2,b2] = hexToRgb(b||'#ffffff');
  return rgbToHex(r1+(r2-r1)*t, g1+(g2-g1)*t, b1+(b2-b1)*t);
}
function lightenHex(hex, amt) {
  const [r,g,b] = hexToRgb(hex);
  return rgbToHex(r+(255-r)*amt, g+(255-g)*amt, b+(255-b)*amt);
}
function darkenHex(hex, amt) {
  const [r,g,b] = hexToRgb(hex);
  return rgbToHex(r*(1-amt), g*(1-amt), b*(1-amt));
}

// ─── SVG helper (connections only) ───────────────────────────────────────────
const SVG_NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k,v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}
function bezier(x1,y1,x2,y2) {
  const dx = Math.max(Math.abs(x2-x1)*0.55, 60);
  return `M${x1},${y1} C${x1+dx},${y1} ${x2-dx},${y2} ${x2},${y2}`;
}

// ─── node type catalogue ──────────────────────────────────────────────────────
const NODE_DEFS = {
  'solid-color': {
    label:    'Solid Color',
    hdrColor: '#5a3a8a',
    inputs:   [],
    outputs:  [{ name: 'Color', type: 'color' }],
    defaults: { color: '#e05555' },
    controls: [{ type: 'color', key: 'color', label: 'Color' }],
    compute(vals)        { return { Color: vals.color || '#e05555' }; },
    drawPreview(ctx, sz, vals) {
      ctx.fillStyle = vals.color || '#e05555';
      ctx.fillRect(0, 0, sz, sz);
    },
  },
  'mix': {
    label:    'Mix',
    hdrColor: '#1a5c8a',
    inputs:   [{ name: 'A', type: 'color' }, { name: 'B', type: 'color' }],
    outputs:  [{ name: 'Result', type: 'color' }],
    defaults: { factor: 0.5 },
    controls: [{ type: 'range', key: 'factor', label: 'Factor', min: 0, max: 1, step: 0.01 }],
    compute(vals, inputs) {
      return { Result: blendHex(inputs.A, inputs.B, vals.factor ?? 0.5) };
    },
    drawPreview(ctx, sz, vals, inputs) {
      const a = inputs.A || '#000000', b = inputs.B || '#ffffff';
      const t = vals.factor ?? 0.5;
      ctx.fillStyle = a;           ctx.fillRect(0,         0, sz*0.44, sz);
      ctx.fillStyle = blendHex(a,b,t); ctx.fillRect(sz*0.44, 0, sz*0.12, sz);
      ctx.fillStyle = b;           ctx.fillRect(sz*0.56,   0, sz*0.44, sz);
    },
  },
  'image': {
    label:    'Image',
    hdrColor: '#2a5a40',
    inputs:   [],
    outputs:  [{ name: 'Image', type: 'texture' }],
    defaults: { imageDataUrl: null, _imageEl: null },
    controls: [{ type: 'image', key: 'imageDataUrl', label: 'Image' }],
    compute(vals)  { return { Image: vals.imageDataUrl || null }; },
    drawPreview(ctx, sz, vals) {
      ctx.fillStyle = '#111111';
      ctx.fillRect(0, 0, sz, sz);
      if (vals._imageEl?.complete && vals.imageDataUrl) {
        const iw = vals._imageEl.naturalWidth  || sz;
        const ih = vals._imageEl.naturalHeight || sz;
        const scale = Math.min(sz / iw, sz / ih);
        const dw = iw * scale, dh = ih * scale;
        ctx.drawImage(vals._imageEl, (sz - dw) / 2, (sz - dh) / 2, dw, dh);
      } else {
        ctx.fillStyle = '#404040';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '11px system-ui, sans-serif';
        ctx.fillText('No image loaded', sz / 2, sz / 2);
      }
    },
  },
  'material-output': {
    label:       'Material Output',
    hdrColor:    '#7a4820',
    inputs:      MAT_ALL_PORTS,
    outputs:     [],
    defaults:    {},
    controls:    [],
    isPermanent: true,
    compute()      { return {}; },
    drawPreview()  {},
  },
};

const ITEM_TYPE_MAP = { 'Solid Color': 'solid-color', 'Mix': 'mix', 'Image Input': 'image' };

// ─── layout helpers ───────────────────────────────────────────────────────────
// These must match the HTML/CSS pixel layout exactly so bezier endpoints align.
function portSectionY()  { return HEADER_H + PAD + PREV_SZ + PAD; }   // 259 px
function portRelY(i)     { return portSectionY() + i * PORT_ROW_H + PORT_ROW_H / 2; }
// Output dots live inside control rows, so their Y is offset past the input-only port section.
function outputPortY(typeKey, portIdx) {
  const def = NODE_DEFS[typeKey];
  return portSectionY() + def.inputs.length * PORT_ROW_H + PAD + portIdx * CTRL_ROW_H + CTRL_ROW_H / 2;
}
function nodeHeight(typeKey, nodeInst) {
  if (typeKey === 'material-output') {
    return nodeInst ? matOutputNodeHeight(nodeInst)
      : HEADER_H + MAT_INFO_H + MAT_NODE_SECTIONS.length * MAT_SECTION_H + MAT_ALL_PORTS.length * PORT_ROW_H + PAD;
  }
  const def = NODE_DEFS[typeKey];
  if (!def) return 120;
  return portSectionY() + def.inputs.length * PORT_ROW_H + PAD + def.controls.length * CTRL_ROW_H + PAD;
}

// ─── Material Output layout helpers ──────────────────────────────────────────
function matPortSection(portIdx) {
  let seen = 0;
  for (const sec of MAT_NODE_SECTIONS) {
    if (portIdx < seen + sec.ports.length) return { secKey: sec.key, localIdx: portIdx - seen };
    seen += sec.ports.length;
  }
  return null;
}

function matOutputPortY(node, portIdx) {
  const states = node._matSections || { basic: true, advanced: false };
  let y = HEADER_H + MAT_INFO_H;
  let seen = 0;
  for (const sec of MAT_NODE_SECTIONS) {
    y += MAT_SECTION_H;
    if (states[sec.key]) {
      const li = portIdx - seen;
      if (li >= 0 && li < sec.ports.length) return y + li * PORT_ROW_H + PORT_ROW_H / 2;
      y += sec.ports.length * PORT_ROW_H;
    }
    seen += sec.ports.length;
  }
  return y;
}

function matOutputNodeHeight(node) {
  const states = node._matSections || { basic: true, advanced: false };
  let h = HEADER_H + MAT_INFO_H;
  for (const sec of MAT_NODE_SECTIONS) {
    h += MAT_SECTION_H;
    if (states[sec.key]) h += sec.ports.length * PORT_ROW_H;
  }
  return h + PAD;
}

// ─── class ────────────────────────────────────────────────────────────────────
export class NodeEditorManager {
  constructor() {
    this._collections = [
      { id:'noise',     title:'Noise Generators', open:true,
        items:['FBM Noise','Voronoi','Value Noise','Perlin','Simplex','White Noise'] },
      { id:'normals',   title:'Normal Maps',       open:false,
        items:['Height to Normal','Normal Blend','Normal Intensity','Bump Map'] },
      { id:'composite', title:'Compositing',       open:false,
        items:['Mix','Alpha Over','Multiply','Screen','Overlay','Soft Light'] },
      { id:'color',     title:'Color',             open:false,
        items:['Solid Color','Gradient','Color Ramp','Invert','Hue / Sat / Val'] },
      { id:'utility',   title:'Utility',           open:false,
        items:['Image Input','Math','Clamp','Remap','Output'] },
    ];
    this._selectedColId = null;
    this._renaming      = null;
    this._didPosition   = false;

    this._nodes       = [];
    this._conns       = [];
    this._nextNodeId  = 1;
    this._nextConnId  = 1;
    this._viewOffset  = { x: 0, y: 0 };
    this._zoom        = 1;
    this._pendingConn = null;
    this._selObjectName = '—';
    this._selPartName   = '—';
    this._graphs      = new Map();   // key → saved graph data
    this._currentKey  = null;        // key of the currently displayed graph

    this._build();
    this._bindDrag();
    this._bindResize();
    this._bindMenu();
  }

  // ─── Public ───────────────────────────────────────────────────────────────

  open() {
    if (!this._didPosition) { this._centre(); this._didPosition = true; }
    if (!this._nodes.find(n => n.type === 'material-output')) this._placeMaterialOutputNode();
    this._overlay.style.display = 'flex';
  }
  close() {
    this._overlay.style.display = 'none';
    this._closeMenu();
    this._closeRenameForm();
  }

  setMaterialOutputHandler(fn) {
    this._onMatOutput = fn;
  }

  /** Serialize all graphs for persistence. Strip non-serializable DOM values. */
  getGraphData() {
    if (this._currentKey !== null) this._saveGraph();
    const graphs = {};
    this._graphs.forEach((graphData, key) => {
      graphs[key] = {
        ...graphData,
        nodes: graphData.nodes.map(n => {
          // eslint-disable-next-line no-unused-vars
          const { _imageEl, ...safeValues } = n.values || {};
          return { ...n, values: safeValues };
        }),
      };
    });
    return { graphs };
  }

  /** Restore graphs from a previously serialized snapshot. */
  loadGraphData(data) {
    if (!data?.graphs) return;
    this._graphs = new Map(Object.entries(data.graphs));
    // Recreate Image elements for any Image nodes that have a saved dataUrl
    this._graphs.forEach(graphData => {
      graphData.nodes.forEach(n => {
        if (n.type === 'image' && n.values?.imageDataUrl) {
          const img = new Image();
          img.src = n.values.imageDataUrl;
          n.values._imageEl = img;
        }
      });
    });
    // If fast-boot already ran setSelection before we got here, _currentKey is set
    // but the graph it loaded was a fresh empty one (graphs was empty at that point).
    // Reload from the restored data so the saved graph is applied immediately.
    if (this._currentKey !== null && this._graphs.has(this._currentKey)) {
      this._loadGraph(this._currentKey);
    }
  }

  // Called from main.js when Material Editor controls change, to keep Node Editor in sync.
  syncMaterialProp(matProp, value) {
    const matNode = this._nodes.find(n => n.type === 'material-output');
    if (!matNode?._portControls) return;
    // iridescenceThicknessRange arrives as [min, max] from Controls.js
    if (matProp === 'iridescenceThicknessRange' && Array.isArray(value)) {
      this._syncOnePortControl(matNode, 'iridescenceThicknessRange_min', value[0]);
      this._syncOnePortControl(matNode, 'iridescenceThicknessRange_max', value[1]);
      return;
    }
    // Controls sends Infinity for slider-at-0; node editor uses 0
    if (matProp === 'attenuationDistance' && value === Infinity) value = 0;
    this._syncOnePortControl(matNode, matProp, value);
  }

  _syncOnePortControl(matNode, matProp, value) {
    const portIdx = MAT_ALL_PORTS.findIndex(p => p.matProp === matProp);
    if (portIdx < 0) return;
    // Don't override a wire-driven (connected) control
    if (this._conns.some(c => c.toNode === matNode.id && c.toPort === portIdx)) return;
    const ctrl = matNode._portControls[portIdx];
    if (!ctrl) return;
    if (ctrl.slider) {
      ctrl.slider.value = value;
      ctrl.numInput.value = parseFloat(value).toFixed(2);
    } else if (ctrl.picker && typeof value === 'string' && /^#[0-9a-fA-F]{6}$/i.test(value)) {
      ctrl.picker.value = value;
      ctrl.hex.value = value;
    }
  }

  setSelection(objectName, partName) {
    const newKey = `${objectName || '—'}|${partName || '—'}`;
    if (newKey === this._currentKey) {
      // Same object — just refresh the labels
      const matNode = this._nodes.find(n => n.type === 'material-output');
      if (matNode?._infoObjectEl) matNode._infoObjectEl.textContent = objectName || '—';
      if (matNode?._infoPartEl)   matNode._infoPartEl.textContent   = partName   || '—';
      return;
    }
    if (this._currentKey !== null) this._saveGraph();
    this._currentKey    = newKey;
    this._selObjectName = objectName || '—';
    this._selPartName   = partName   || '—';
    this._loadGraph(newKey);
  }

  _saveGraph() {
    this._graphs.set(this._currentKey, {
      nodes: this._nodes.map(n => {
        const d = { id: n.id, type: n.type, x: n.x, y: n.y, values: { ...(n.values || {}) } };
        if (n._matSections) d._matSections = { ...n._matSections };
        return d;
      }),
      conns:       this._conns.map(c => ({ ...c })),
      nextNodeId:  this._nextNodeId,
      nextConnId:  this._nextConnId,
      viewOffset:  { ...this._viewOffset },
      zoom:        this._zoom,
    });
  }

  _loadGraph(key) {
    // Tear down current DOM
    this._nodes.forEach(n => n._el?.remove());
    Array.from(this._connLayer.querySelectorAll('.ne-conn')).forEach(el => el.remove());

    const saved = this._graphs.get(key);
    if (saved) {
      this._nodes      = saved.nodes.map(n => ({ ...n, values: { ...(n.values || {}) }, _output: {}, _inputs: {} }));
      this._conns      = saved.conns.map(c => ({ ...c }));
      this._nextNodeId = saved.nextNodeId;
      this._nextConnId = saved.nextConnId;
      this._viewOffset = { ...saved.viewOffset };
      this._zoom       = saved.zoom;
      this._applyTransform();
      this._nodes.forEach(n => this._renderNode(n));
      this._redrawConns();
      // Re-evaluate source nodes so connected values propagate to Material Output
      const sinks = new Set(this._conns.map(c => c.toNode));
      this._nodes.filter(n => n.type !== 'material-output' && !sinks.has(n.id))
                 .forEach(n => this._evaluateFrom(n.id));
    } else {
      this._nodes      = [];
      this._conns      = [];
      this._nextNodeId = 1;
      this._nextConnId = 1;
      this._placeMaterialOutputNode();
    }

    // Sync info labels on the material output node
    const matNode = this._nodes.find(n => n.type === 'material-output');
    if (matNode?._infoObjectEl) matNode._infoObjectEl.textContent = this._selObjectName;
    if (matNode?._infoPartEl)   matNode._infoPartEl.textContent   = this._selPartName;
  }

  _placeMaterialOutputNode() {
    const id = this._nextNodeId++;
    const node = {
      id, type: 'material-output',
      x: 520, y: 40,
      values: {}, _output: {}, _inputs: {},
      _matSections: { basic: true, advanced: false },
    };
    this._nodes.push(node);
    this._renderNode(node);
  }

  // ─── Build shell ──────────────────────────────────────────────────────────

  _build() {
    this._overlay = document.createElement('div');
    this._overlay.className = 'ne-overlay';
    this._overlay.style.display = 'none';
    const W = Math.min(Math.round(window.innerWidth * 0.60), 1000);
    const H = Math.round(W * 10 / 16);
    this._overlay.style.width  = `${W}px`;
    this._overlay.style.height = `${H}px`;

    this._titleBar = document.createElement('div');
    this._titleBar.className = 'ne-titlebar';
    const titleText = document.createElement('span');
    titleText.className = 'ne-titlebar-title';
    titleText.textContent = 'Node Editor';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button'; closeBtn.className = 'ne-close-btn';
    closeBtn.setAttribute('aria-label','Close'); closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', () => this.close());
    this._titleBar.append(titleText, closeBtn);

    const content = document.createElement('div');
    content.className = 'ne-content';
    content.append(this._buildLeftPanel(), this._buildCanvas());
    this._overlay.append(this._titleBar, content);

    for (const dir of ['n','ne','e','se','s','sw','w','nw']) {
      const h = document.createElement('div');
      h.className = `ne-resize ne-resize--${dir}`;
      h.dataset.dir = dir;
      this._overlay.appendChild(h);
    }
    document.body.appendChild(this._overlay);
    this._renderCollections();
  }

  // ─── Left panel ───────────────────────────────────────────────────────────

  _buildLeftPanel() {
    const left = document.createElement('div');
    left.className = 'ne-left';

    const header = document.createElement('div');
    header.className = 'ne-left-header';
    const panelTitle = document.createElement('span');
    panelTitle.className = 'ne-left-title';
    panelTitle.textContent = 'Nodes';
    this._menuBtn = document.createElement('button');
    this._menuBtn.type = 'button'; this._menuBtn.className = 'ne-menu-btn';
    this._menuBtn.setAttribute('aria-label','Nodes menu');
    this._menuBtn.innerHTML = '<span></span><span></span><span></span>';
    this._menu = document.createElement('div');
    this._menu.className = 'ne-menu'; this._menu.hidden = true;
    document.body.appendChild(this._menu);
    for (const { label, action } of [
      { label:'Add Collection', action:() => this._addCollection() },
      { label:'Rename',         action:() => this._renameSelected() },
      { label:'Delete',         action:() => this._deleteSelected() },
    ]) {
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'ne-menu-item'; btn.textContent = label;
      btn.addEventListener('click', () => { this._closeMenu(); action(); });
      this._menu.appendChild(btn);
    }
    header.append(panelTitle, this._menuBtn);
    this._scroll = document.createElement('div');
    this._scroll.className = 'ne-left-scroll';
    left.append(header, this._scroll);
    return left;
  }

  // ─── Canvas / Shader Graph ────────────────────────────────────────────────

  _buildCanvas() {
    const wrap = document.createElement('div');
    wrap.className = 'ne-canvas';

    const area = document.createElement('div');
    area.className = 'ne-canvas-area';
    this._canvasArea = area;

    const areaLabel = document.createElement('div');
    areaLabel.className = 'ne-graph-label';
    areaLabel.textContent = 'Shader Graph';
    area.appendChild(areaLabel);

    // Viewport — all nodes and connections live here; panned/zoomed via CSS transform
    const vp = document.createElement('div');
    vp.className = 'ne-viewport';
    this._viewport = vp;
    area.appendChild(vp);

    // SVG layer for bezier connections (inside viewport so transform is shared)
    const svg = s('svg');
    svg.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;overflow:visible;pointer-events:none;';
    this._svg = svg;

    const defs = s('defs');
    const marker = s('marker', { id:'ne-arr', markerWidth:12, markerHeight:12,
      refX:9, refY:5, orient:'auto', markerUnits:'userSpaceOnUse' });
    marker.appendChild(s('path', { d:'M2,2 L9,5 L2,8', fill:'none', stroke:'#5a9eff',
      'stroke-width':1.5, 'stroke-linecap':'round', 'stroke-linejoin':'round' }));
    defs.appendChild(marker);
    svg.appendChild(defs);

    this._connLayer = s('g');
    svg.appendChild(this._connLayer);

    this._pendingPath = s('path', {
      fill:'none', stroke:'#5a9eff', 'stroke-width':2,
      'stroke-dasharray':'6 3', 'marker-end':'url(#ne-arr)', visibility:'hidden',
    });
    this._connLayer.appendChild(this._pendingPath);
    vp.appendChild(svg);

    // HTML nodes layer
    const nodesLayer = document.createElement('div');
    nodesLayer.style.cssText = 'position:absolute;top:0;left:0;';
    this._nodesLayer = nodesLayer;
    vp.appendChild(nodesLayer);

    this._bindCanvasPan();
    this._bindWheelZoom();

    // Bottom toolbar
    const bar = document.createElement('div');
    bar.className = 'ne-canvas-bar';

    const centerBtn = document.createElement('button');
    centerBtn.type = 'button'; centerBtn.className = 'ne-bar-btn';
    centerBtn.textContent = 'Center';
    centerBtn.addEventListener('click', () => this._centerView());

    const resWrap = document.createElement('div');
    resWrap.className = 'ne-bar-select-wrap';
    const resLabel = document.createElement('span');
    resLabel.className = 'ne-bar-label'; resLabel.textContent = 'Resolution';
    const resSel = document.createElement('select');
    resSel.className = 'ne-bar-select';
    for (const [val, lbl] of [['512','512×512'],['1024','1024×1024'],['2048','2048×2048'],['4096','4096×4096']]) {
      const opt = document.createElement('option');
      opt.value = val; opt.textContent = lbl; resSel.appendChild(opt);
    }
    resSel.value = '1024';
    resWrap.append(resLabel, resSel);

    const zoomOutBtn = document.createElement('button');
    zoomOutBtn.type = 'button'; zoomOutBtn.className = 'ne-bar-btn ne-zoom-btn';
    zoomOutBtn.textContent = '−';
    zoomOutBtn.addEventListener('click', () => this._zoomBy(1/1.2));

    this._zoomSlider = document.createElement('input');
    this._zoomSlider.type = 'range'; this._zoomSlider.className = 'ne-zoom-slider';
    this._zoomSlider.min = '0.1'; this._zoomSlider.max = '3'; this._zoomSlider.step = '0.05';
    this._zoomSlider.value = '1';
    this._zoomSlider.addEventListener('input', () => this._zoomTo(parseFloat(this._zoomSlider.value)));

    this._zoomLabel = document.createElement('span');
    this._zoomLabel.className = 'ne-zoom-label'; this._zoomLabel.textContent = '100%';

    const zoomInBtn = document.createElement('button');
    zoomInBtn.type = 'button'; zoomInBtn.className = 'ne-bar-btn ne-zoom-btn';
    zoomInBtn.textContent = '+';
    zoomInBtn.addEventListener('click', () => this._zoomBy(1.2));

    bar.append(centerBtn, resWrap, zoomOutBtn, this._zoomSlider, this._zoomLabel, zoomInBtn);
    wrap.append(area, bar);
    return wrap;
  }

  // ─── Collections ──────────────────────────────────────────────────────────

  _renderCollections() {
    this._scroll.innerHTML = '';
    this._collections.forEach(col => {
      const section = document.createElement('div');
      section.className = 'ne-collection'; section.dataset.id = col.id;
      if (col.open)                       section.classList.add('is-open');
      if (col.id === this._selectedColId) section.classList.add('is-selected');

      const toggle = document.createElement('button');
      toggle.type = 'button'; toggle.className = 'ne-collection-toggle';
      const titleSpan = document.createElement('span');
      titleSpan.className = 'ne-collection-title'; titleSpan.textContent = col.title;
      const chevron = document.createElement('span');
      chevron.className = 'ne-collection-chevron';
      toggle.append(titleSpan, chevron);
      toggle.addEventListener('click', () => {
        col.open = !col.open;
        this._selectedColId = col.id;
        this._closeRenameForm();
        this._renderCollections();
      });

      // Update selection without re-rendering so the toggle click still fires
      section.addEventListener('mousedown', () => {
        if (this._selectedColId !== col.id) {
          this._selectedColId = col.id;
          this._scroll.querySelectorAll('.ne-collection').forEach(el =>
            el.classList.toggle('is-selected', el.dataset.id === col.id));
        }
      });

      const contentEl = document.createElement('div');
      contentEl.className = 'ne-collection-content';
      col.items.forEach(name => {
        const item = document.createElement('button');
        item.type = 'button'; item.className = 'ne-item'; item.textContent = name;
        const typeKey = ITEM_TYPE_MAP[name];
        if (typeKey) item.classList.add('ne-item--live');
        item.addEventListener('click', () => { if (typeKey) this._placeNode(typeKey); });
        contentEl.appendChild(item);
      });

      section.append(toggle, contentEl);
      this._scroll.appendChild(section);
    });
  }

  // ─── Place node ───────────────────────────────────────────────────────────

  _placeNode(typeKey) {
    const def = NODE_DEFS[typeKey];
    if (!def) return;
    const rect = this._canvasArea.getBoundingClientRect();
    const n = this._nodes.length;
    const x = (rect.width  / 2 - NODE_W / 2          - this._viewOffset.x + n * 28) / this._zoom;
    const y = (rect.height / 2 - nodeHeight(typeKey) / 2 - this._viewOffset.y + n * 28) / this._zoom;
    const id = this._nextNodeId++;
    const node = { id, type: typeKey, x, y, values: { ...def.defaults }, _output: {}, _inputs: {} };
    this._nodes.push(node);
    this._renderNode(node);
    this._evaluateNode(id);
  }

  // ─── Render node as HTML ──────────────────────────────────────────────────

  _renderNode(node) {
    if (node.type === 'material-output') { this._renderMaterialNode(node); return; }
    const def = NODE_DEFS[node.type];

    // Root element
    const el = document.createElement('div');
    el.className = 'ne-node'; el.dataset.id = node.id;
    el.style.left = `${node.x}px`; el.style.top = `${node.y}px`;
    node._el = el;

    // ── Header ──────────────────────────────────────────────────────────────
    const header = document.createElement('div');
    header.className = 'ne-node-header';
    header.style.background =
      `linear-gradient(to bottom, ${lightenHex(def.hdrColor, 0.18)}, ${darkenHex(def.hdrColor, 0.28)})`;

    const title = document.createElement('div');
    title.className = 'ne-node-title'; title.textContent = def.label;

    const delBtn = document.createElement('button');
    delBtn.type = 'button'; delBtn.className = 'ne-del'; delBtn.textContent = '×';
    delBtn.addEventListener('click', e => { e.stopPropagation(); this._deleteNode(node.id); });

    header.append(title, delBtn);
    el.appendChild(header);

    // ── Preview ───────────────────────────────────────────────────────────
    const previewWrap = document.createElement('div');
    previewWrap.className = 'ne-node-preview-wrap';
    const canvas = document.createElement('canvas');
    canvas.className = 'ne-node-preview';
    canvas.width = PREV_SZ; canvas.height = PREV_SZ;
    previewWrap.appendChild(canvas);
    el.appendChild(previewWrap);
    node._previewCanvas = canvas;

    // ── Input ports only (output dots live in control rows below) ─────────
    const portSection = document.createElement('div');
    portSection.className = 'ne-port-section';

    for (let i = 0; i < def.inputs.length; i++) {
      const row = document.createElement('div');
      row.className = 'ne-port-row';
      const portEl = document.createElement('div');
      portEl.className = 'ne-port ne-port--in';
      const dot = document.createElement('div'); dot.className = 'ne-port-dot';
      const lbl = document.createElement('span'); lbl.className = 'ne-port-label'; lbl.textContent = def.inputs[i].name;
      portEl.append(dot, lbl);
      row.appendChild(portEl);
      portSection.appendChild(row);
    }
    el.appendChild(portSection);

    // ── Controls ──────────────────────────────────────────────────────────
    const ctrlSection = document.createElement('div');
    ctrlSection.className = 'ne-node-controls';

    def.controls.forEach((ctrl, ctrlIdx) => {
      const row = document.createElement('div');
      row.className = 'control-row';
      const lbl = document.createElement('p');
      lbl.className = 'control-label'; lbl.textContent = ctrl.label;
      row.appendChild(lbl);

      if (ctrl.type === 'color') {
        const picker = document.createElement('input');
        picker.type = 'color'; picker.className = 'colorPicker';
        picker.value = node.values[ctrl.key] || '#ffffff';

        const field = document.createElement('div');
        field.className = 'color-field';
        const hexInput = document.createElement('input');
        hexInput.type = 'text'; hexInput.className = 'value-input value-input-hex';
        hexInput.value = picker.value; hexInput.maxLength = 7;
        field.appendChild(hexInput);

        const ccp = new CompactColorPicker({
          pickerEl: picker,
          hexEl: hexInput,
          onLiveChange: (hex) => { node.values[ctrl.key] = hex; this._evaluateFrom(node.id); },
          onCommitChange: (hex) => { node.values[ctrl.key] = hex; this._evaluateFrom(node.id); },
        });

        hexInput.addEventListener('change', () => {
          const v = hexInput.value.trim();
          const norm = v.startsWith('#') ? v : `#${v}`;
          if (/^#[0-9a-fA-F]{6}$/.test(norm)) ccp.setColor(norm, { commit: true });
          else hexInput.value = ccp.state.hex;
        });

        row.append(picker, field);
      } else if (ctrl.type === 'range') {
        const slider = document.createElement('input');
        slider.type = 'range'; slider.className = 'slider';
        slider.min = String(ctrl.min ?? 0); slider.max = String(ctrl.max ?? 1);
        slider.step = String(ctrl.step ?? 0.01);
        slider.value = String(node.values[ctrl.key] ?? 0.5);

        const numInput = document.createElement('input');
        numInput.type = 'number'; numInput.className = 'value-input';
        numInput.setAttribute('inputmode', 'decimal');
        numInput.min = String(ctrl.min ?? 0); numInput.max = String(ctrl.max ?? 1);
        numInput.step = String(ctrl.step ?? 0.01);
        numInput.value = parseFloat(slider.value).toFixed(2);

        slider.addEventListener('input', () => {
          node.values[ctrl.key] = parseFloat(slider.value);
          numInput.value = parseFloat(slider.value).toFixed(2);
          this._evaluateFrom(node.id);
        });
        numInput.addEventListener('change', () => {
          const v = Math.max(ctrl.min ?? 0, Math.min(ctrl.max ?? 1, parseFloat(numInput.value) || 0));
          node.values[ctrl.key] = v;
          slider.value = String(v);
          numInput.value = v.toFixed(2);
          this._evaluateFrom(node.id);
        });

        row.append(slider, numInput);
      } else if (ctrl.type === 'image') {
        lbl.style.display = 'none';
        const dropZone = document.createElement('div');
        dropZone.className = 'button-medium ne-image-drop';

        const dropLabel = document.createElement('span');
        dropLabel.className = 'ne-image-drop-label';
        dropLabel.textContent = 'Click or drop image';
        dropZone.appendChild(dropLabel);

        if (node.values.imageDataUrl) dropZone.classList.add('has-image');

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';
        fileInput.style.display = 'none';

        const _loadFile = (file) => {
          if (!file?.type.startsWith('image/')) return;
          const reader = new FileReader();
          reader.onload = evt => {
            const img = new Image();
            img.onload = () => {
              node.values.imageDataUrl = evt.target.result;
              node.values._imageEl = img;
              dropZone.classList.add('has-image');
              this._evaluateFrom(node.id);
            };
            img.src = evt.target.result;
          };
          reader.readAsDataURL(file);
        };

        dropZone.addEventListener('click', () => fileInput.click());
        dropZone.addEventListener('dragover', e => {
          e.preventDefault(); e.stopPropagation();
          dropZone.classList.add('drag-over');
        });
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
        dropZone.addEventListener('drop', e => {
          e.preventDefault(); e.stopPropagation();
          dropZone.classList.remove('drag-over');
          _loadFile(e.dataTransfer.files[0]);
        });
        fileInput.addEventListener('change', () => _loadFile(fileInput.files[0]));

        row.append(dropZone, fileInput);
      }

      // Output dot for this row (outputs are co-located with control rows, no separate port section)
      const out = def.outputs[ctrlIdx];
      if (out) {
        const outDot = document.createElement('div');
        outDot.className = 'ne-port-dot ne-port-dot--out';
        this._bindOutputDrag(outDot, node.id, ctrlIdx);
        row.appendChild(outDot);
      }

      ctrlSection.appendChild(row);
    });
    el.appendChild(ctrlSection);

    // ── Drag by header ────────────────────────────────────────────────────
    header.addEventListener('mousedown', e => {
      if (e.button !== 0 || e.target.closest('.ne-del')) return;
      e.preventDefault(); e.stopPropagation();
      const start = this._clientToGraph(e.clientX, e.clientY);
      const ox = node.x - start.x, oy = node.y - start.y;
      this._nodesLayer.appendChild(el); // bring to front
      const onMove = mv => {
        const p = this._clientToGraph(mv.clientX, mv.clientY);
        node.x = p.x + ox; node.y = p.y + oy;
        el.style.left = `${node.x}px`; el.style.top = `${node.y}px`;
        this._redrawConns();
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    this._nodesLayer.appendChild(el);
  }

  // ─── Material Output node ─────────────────────────────────────────────────

  _renderMaterialNode(node) {
    const HDR = '#7a4820';
    const el = document.createElement('div');
    el.className = 'ne-node ne-node--material-output';
    el.dataset.id = node.id;
    el.style.left = `${node.x}px`;
    el.style.top  = `${node.y}px`;
    node._el = el;

    // Header — no delete button (permanent node)
    const header = document.createElement('div');
    header.className = 'ne-node-header';
    header.style.background =
      `linear-gradient(to bottom, ${lightenHex(HDR, 0.18)}, ${darkenHex(HDR, 0.28)})`;
    const title = document.createElement('div');
    title.className = 'ne-node-title';
    title.textContent = 'Material Output';
    header.appendChild(title);
    el.appendChild(header);

    // Object / Part name info box
    const infoBox = document.createElement('div');
    infoBox.className = 'ne-mat-info';
    const makeInfoRow = (labelText, valueText) => {
      const row = document.createElement('div');
      row.className = 'ne-mat-info-row';
      const lbl = document.createElement('span');
      lbl.className = 'ne-mat-info-label';
      lbl.textContent = labelText;
      const val = document.createElement('span');
      val.className = 'ne-mat-info-value';
      val.textContent = valueText;
      row.append(lbl, val);
      return { row, val };
    };
    const { row: row1, val: objVal } = makeInfoRow('Object Name:', this._selObjectName);
    const { row: row2, val: partVal } = makeInfoRow('Part Name:', this._selPartName);
    infoBox.append(row1, row2);
    el.appendChild(infoBox);
    node._infoObjectEl = objVal;
    node._infoPartEl   = partVal;

    // Sections
    node._matSections   = node._matSections || { basic: true, advanced: false };
    node._portControls  = [];   // index = global port idx → { slider?, numInput?, picker?, hex? }
    let portIdx = 0;

    for (const sec of MAT_NODE_SECTIONS) {
      const secKey = sec.key;
      const secEl = document.createElement('div');
      secEl.className = 'ne-mat-section';
      if (node._matSections[secKey]) secEl.classList.add('is-open');

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'ne-mat-section-toggle';
      const lbl = document.createElement('span');
      lbl.textContent = sec.label;
      const chevron = document.createElement('span');
      chevron.className = 'ne-mat-section-chevron';
      toggle.append(lbl, chevron);

      const content = document.createElement('div');
      content.className = 'ne-mat-section-content';
      content.addEventListener('mousedown', e => e.stopPropagation());

      for (let i = 0; i < sec.ports.length; i++) {
        const port = sec.ports[i];
        const row = document.createElement('div');
        row.className = 'ne-port-row ne-port-row--has-ctrl';

        const portEl = document.createElement('div');
        portEl.className = 'ne-port ne-port--in';

        const dot = document.createElement('div');
        const dotMod = port.type === 'color' ? ' ne-port-dot--color-type'
                     : port.type === 'texture' ? ' ne-port-dot--texture-type' : '';
        dot.className = `ne-port-dot${dotMod}`;

        portEl.appendChild(dot);
        row.appendChild(portEl);

        {
          // All ports: dot in portEl, name (+ controls if applicable) in a control-row
          const ctrlRow = document.createElement('div');
          ctrlRow.className = port.type === 'texture' ? 'control-row material-map-row'
                                                      : 'control-row';

          const lbl = document.createElement('p');
          lbl.className = 'control-label';
          lbl.textContent = port.name;
          ctrlRow.appendChild(lbl);

          const globalIdx = portIdx + i;
          const ctrlRefs = { dot };

          if (port.type === 'scalar' && port.ctrl) {
            const c = port.ctrl;
            const slider = document.createElement('input');
            slider.type = 'range';
            slider.className = 'slider';
            slider.min = c.min; slider.max = c.max; slider.step = c.step; slider.value = c.def;
            const numInput = document.createElement('input');
            numInput.type = 'number';
            numInput.className = 'value-input';
            numInput.inputMode = 'decimal';
            numInput.min = c.min; numInput.max = c.max; numInput.step = c.step;
            numInput.value = c.def;
            slider.addEventListener('input', () => {
              numInput.value = slider.value;
              if (port.matProp) this._onMatOutput?.(port.matProp, parseFloat(slider.value));
            });
            numInput.addEventListener('input', () => {
              const v = Math.min(c.max, Math.max(c.min, parseFloat(numInput.value) || 0));
              slider.value = v;
              if (port.matProp) this._onMatOutput?.(port.matProp, v);
            });
            ctrlRow.append(slider, numInput);
            ctrlRefs.slider = slider; ctrlRefs.numInput = numInput;
          } else if (port.type === 'color') {
            const picker = document.createElement('input');
            picker.type = 'color';
            picker.className = 'colorPicker';
            picker.value = port.colorDef || '#ffffff';
            const field = document.createElement('div');
            field.className = 'color-field';
            const hex = document.createElement('input');
            hex.type = 'text';
            hex.className = 'value-input value-input-hex';
            hex.value = port.colorDef || '#ffffff';
            hex.maxLength = 7;
            hex.spellcheck = false;
            picker.addEventListener('input', () => {
              hex.value = picker.value;
              if (port.matProp) this._onMatOutput?.(port.matProp, picker.value);
            });
            hex.addEventListener('change', () => {
              if (/^#[0-9a-fA-F]{6}$/.test(hex.value)) {
                picker.value = hex.value;
                if (port.matProp) this._onMatOutput?.(port.matProp, hex.value);
              }
            });
            field.appendChild(hex);
            ctrlRow.append(picker, field);
            ctrlRefs.picker = picker; ctrlRefs.hex = hex;
          }

          node._portControls[globalIdx] = ctrlRefs;
          this._bindInputDisconnect(dot, node, globalIdx);
          row.appendChild(ctrlRow);
        }

        content.appendChild(row);
      }

      portIdx += sec.ports.length;

      toggle.addEventListener('click', () => {
        node._matSections[secKey] = !node._matSections[secKey];
        secEl.classList.toggle('is-open', node._matSections[secKey]);
        this._redrawConns();
      });

      secEl.append(toggle, content);
      el.appendChild(secEl);
    }

    // Bottom pad
    const padEl = document.createElement('div');
    padEl.style.height = `${PAD}px`;
    el.appendChild(padEl);

    // Drag by header
    header.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      const start = this._clientToGraph(e.clientX, e.clientY);
      const ox = node.x - start.x, oy = node.y - start.y;
      this._nodesLayer.appendChild(el);
      const onMove = mv => {
        const p = this._clientToGraph(mv.clientX, mv.clientY);
        node.x = p.x + ox; node.y = p.y + oy;
        el.style.left = `${node.x}px`; el.style.top = `${node.y}px`;
        this._redrawConns();
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    this._nodesLayer.appendChild(el);
  }

  // ─── Delete node ──────────────────────────────────────────────────────────

  _deleteNode(id) {
    const node = this._nodes.find(n => n.id === id);
    if (!node || NODE_DEFS[node.type]?.isPermanent) return;
    const downstream = this._conns.filter(c => c.fromNode === id).map(c => c.toNode);
    this._conns.filter(c => c.fromNode === id || c.toNode === id)
               .forEach(c => this._onConnectionRemoved(c));
    this._conns = this._conns.filter(c => c.fromNode !== id && c.toNode !== id);
    node._el?.remove();
    this._nodes = this._nodes.filter(n => n.id !== id);
    this._redrawConns();
    downstream.forEach(dnId => this._evaluateFrom(dnId));
  }

  // ─── Evaluate ─────────────────────────────────────────────────────────────

  _evaluateNode(id) {
    const node = this._nodes.find(n => n.id === id);
    if (!node) return;

    if (node.type === 'material-output') {
      // Reflect each connected input's live value into the control UI and apply to material
      this._conns.filter(c => c.toNode === id).forEach(c => {
        const src = this._nodes.find(n => n.id === c.fromNode);
        if (!src?._output) return;
        const outName = NODE_DEFS[src.type]?.outputs?.[c.fromPort]?.name;
        const val = src._output[outName];
        if (val === undefined || val === null) return;
        const ctrl = node._portControls?.[c.toPort];
        const port = MAT_ALL_PORTS[c.toPort];
        if (ctrl?.slider) {
          const n = parseFloat(val);
          if (!isNaN(n)) { ctrl.slider.value = n; ctrl.numInput.value = n; }
        } else if (ctrl?.picker) {
          if (typeof val === 'string' && /^#[0-9a-fA-F]{6}$/i.test(val)) {
            ctrl.picker.value = val;
            ctrl.hex.value    = val;
          }
        }
        if (port?.matProp) this._onMatOutput?.(port.matProp, val);
      });
      return;
    }

    const def = NODE_DEFS[node.type];
    const inputs = {};
    def.inputs.forEach((inp, i) => {
      const conn = this._conns.find(c => c.toNode === id && c.toPort === i);
      if (conn) {
        const src = this._nodes.find(n => n.id === conn.fromNode);
        if (src?._output)
          inputs[inp.name] = src._output[NODE_DEFS[src.type].outputs[conn.fromPort].name];
      }
    });
    node._inputs = inputs;
    node._output = def.compute(node.values, inputs);
    if (node._previewCanvas) {
      const ctx = node._previewCanvas.getContext('2d');
      ctx.clearRect(0, 0, PREV_SZ, PREV_SZ);
      def.drawPreview(ctx, PREV_SZ, node.values, inputs);
    }
  }

  _evaluateFrom(id) {
    this._evaluateNode(id);
    this._conns.filter(c => c.fromNode === id).forEach(c => this._evaluateFrom(c.toNode));
  }

  // ─── Connections ──────────────────────────────────────────────────────────

  _onConnectionRemoved(conn) {
    const toNode = this._nodes.find(n => n.id === conn.toNode);
    if (toNode?.type !== 'material-output') return;
    const port = MAT_ALL_PORTS[conn.toPort];
    if (port?.type !== 'texture' || !port?.matProp) return;
    this._onMatOutput?.(port.matProp, null);
  }

  _portTypeOf(nodeId, kind, portIdx) {
    const node = this._nodes.find(n => n.id === nodeId);
    if (!node) return null;
    if (kind === 'out') return NODE_DEFS[node.type]?.outputs?.[portIdx]?.type ?? null;
    if (node.type === 'material-output') return MAT_ALL_PORTS[portIdx]?.type ?? null;
    return NODE_DEFS[node.type]?.inputs?.[portIdx]?.type ?? null;
  }

  _addConnection(fromNode, fromPort, toNode, toPort) {
    if (fromNode === toNode) return;
    const outType = this._portTypeOf(fromNode, 'out', fromPort);
    const inType  = this._portTypeOf(toNode,   'in',  toPort);
    if (outType && inType && outType !== inType) return;
    const displaced = this._conns.find(c => c.toNode === toNode && c.toPort === toPort);
    if (displaced) this._onConnectionRemoved(displaced);
    this._conns = this._conns.filter(c => !(c.toNode === toNode && c.toPort === toPort));
    this._conns.push({ id: this._nextConnId++, fromNode, fromPort, toNode, toPort });
    this._redrawConns();
    this._evaluateFrom(toNode);
  }

  _updateMatOutputConnStates(matNode) {
    if (!matNode?._portControls) return;
    matNode._portControls.forEach((ctrl, portIdx) => {
      if (!ctrl) return;
      const connected = this._conns.some(c => c.toNode === matNode.id && c.toPort === portIdx);
      for (const [key, el] of Object.entries(ctrl)) {
        if (!el) continue;
        if (key === 'dot') {
          // Port dot: show grab cursor when wired so user knows it's draggable
          el.classList.toggle('ne-port-dot--wired', connected);
          continue;
        }
        if (connected) {
          if (!el.hasAttribute('data-user-val')) el.dataset.userVal = el.value;
        } else {
          if (el.hasAttribute('data-user-val')) {
            el.value = el.dataset.userVal;
            el.removeAttribute('data-user-val');
          }
        }
        el.disabled = connected;
        el.classList.toggle('ne-ctrl--connected', connected);
      }
    });
  }

  _redrawConns() {
    Array.from(this._connLayer.querySelectorAll('.ne-conn')).forEach(el => el.remove());
    for (const c of this._conns) {
      // Skip drawing if target port is inside a collapsed material-output section
      const toNode = this._nodes.find(n => n.id === c.toNode);
      if (toNode?.type === 'material-output') {
        const info = matPortSection(c.toPort);
        if (info && !toNode._matSections?.[info.secKey]) continue;
      }
      const from = this._portAbsPos(c.fromNode, 'out', c.fromPort);
      const to   = this._portAbsPos(c.toNode,   'in',  c.toPort);
      const path = s('path', {
        class:'ne-conn', 'data-conn':c.id,
        d: bezier(from.x, from.y, to.x, to.y),
        fill:'none', stroke:'#5a9eff', 'stroke-width':2, 'marker-end':'url(#ne-arr)',
      });
      path.addEventListener('contextmenu', e => {
        e.preventDefault();
        this._onConnectionRemoved(c);
        this._conns = this._conns.filter(cx => cx.id !== c.id);
        this._redrawConns();
        this._evaluateFrom(c.toNode);
      });
      this._connLayer.insertBefore(path, this._pendingPath);
    }
    const matNode = this._nodes.find(n => n.type === 'material-output');
    if (matNode) this._updateMatOutputConnStates(matNode);
  }

  _portAbsPos(nodeId, kind, portIdx) {
    const node = this._nodes.find(n => n.id === nodeId);
    if (!node) return { x:0, y:0 };
    let y;
    if (node.type === 'material-output') {
      y = node.y + matOutputPortY(node, portIdx);
    } else if (kind === 'in') {
      y = node.y + portRelY(portIdx);
    } else {
      y = node.y + outputPortY(node.type, portIdx);
    }
    return { x: node.x + (kind === 'in' ? 0 : NODE_W), y };
  }

  // ─── Output drag → connect ────────────────────────────────────────────────

  _bindOutputDrag(dot, nodeId, portIdx) {
    dot.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();

      const from = this._portAbsPos(nodeId, 'out', portIdx);
      this._pendingConn = { fromNode: nodeId, fromPort: portIdx };
      this._pendingPath.setAttribute('visibility', 'visible');
      this._pendingPath.setAttribute('d', bezier(from.x, from.y, from.x, from.y));

      const onMove = mv => {
        const p = this._clientToGraph(mv.clientX, mv.clientY);
        this._pendingPath.setAttribute('d', bezier(from.x, from.y, p.x, p.y));
      };
      const onUp = up => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        this._pendingPath.setAttribute('visibility', 'hidden');
        const pc = this._pendingConn;
        this._pendingConn = null;
        if (!pc) return;
        const p = this._clientToGraph(up.clientX, up.clientY);
        for (const node of this._nodes) {
          if (node.id === pc.fromNode) continue;
          NODE_DEFS[node.type].inputs.forEach((_, i) => {
            // Skip ports hidden inside collapsed material-output sections
            if (node.type === 'material-output') {
              const info = matPortSection(i);
              if (info && !node._matSections?.[info.secKey]) return;
            }
            const ap = this._portAbsPos(node.id, 'in', i);
            if (Math.hypot(p.x - ap.x, p.y - ap.y) <= PORT_R + 8)
              this._addConnection(pc.fromNode, pc.fromPort, node.id, i);
          });
        }
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // ─── Input port drag → disconnect (or rewire) ────────────────────────────

  _bindInputDisconnect(dot, matNode, portIdx) {
    dot.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      const conn = this._conns.find(c => c.toNode === matNode.id && c.toPort === portIdx);
      if (!conn) return;
      e.preventDefault();
      e.stopPropagation();

      // Lift the wire: remove it and show it dangling from the cursor
      const saved = { ...conn };
      this._onConnectionRemoved(conn);
      this._conns = this._conns.filter(c => c.id !== conn.id);
      this._redrawConns();
      this._evaluateFrom(matNode.id);

      const from = this._portAbsPos(saved.fromNode, 'out', saved.fromPort);
      this._pendingPath.setAttribute('visibility', 'visible');
      this._pendingPath.setAttribute('d', bezier(from.x, from.y, from.x, from.y));

      const onMove = mv => {
        const p = this._clientToGraph(mv.clientX, mv.clientY);
        this._pendingPath.setAttribute('d', bezier(from.x, from.y, p.x, p.y));
      };
      const onUp = up => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        this._pendingPath.setAttribute('visibility', 'hidden');

        const p = this._clientToGraph(up.clientX, up.clientY);
        let reconnected = false;

        // 1. Drop on a different input slot of the same Material Output node
        //    → move the wire from the old slot to the new one (same source)
        for (let i = 0; i < MAT_ALL_PORTS.length && !reconnected; i++) {
          if (i === portIdx) continue;
          const info = matPortSection(i);
          if (info && !matNode._matSections?.[info.secKey]) continue;
          const ap = this._portAbsPos(matNode.id, 'in', i);
          if (Math.abs(p.y - ap.y) <= PORT_ROW_H / 2 &&
              p.x >= matNode.x - PORT_R && p.x <= matNode.x + 290) {
            this._addConnection(saved.fromNode, saved.fromPort, matNode.id, i);
            reconnected = true;
          }
        }

        // 2. Drop on an output dot of a source node → reconnect same slot to new source
        for (const node of this._nodes) {
          if (reconnected) break;
          const def = NODE_DEFS[node.type];
          if (!def?.outputs?.length) continue;
          def.outputs.forEach((_, i) => {
            if (reconnected) return;
            const ap = this._portAbsPos(node.id, 'out', i);
            if (Math.hypot(p.x - ap.x, p.y - ap.y) <= PORT_R + 8) {
              this._addConnection(node.id, i, matNode.id, portIdx);
              reconnected = true;
            }
          });
        }

        // 3. Drop anywhere on a source node body → connect its first output to same slot
        if (!reconnected) {
          for (const node of this._nodes) {
            if (node.id === matNode.id) continue;
            const def = NODE_DEFS[node.type];
            if (!def?.outputs?.length) continue;
            const h = nodeHeight(node.type, node);
            if (p.x >= node.x && p.x <= node.x + NODE_W &&
                p.y >= node.y && p.y <= node.y + h) {
              this._addConnection(node.id, 0, matNode.id, portIdx);
              reconnected = true;
              break;
            }
          }
        }
        // Drop on empty space → wire stays removed (disconnected)
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // ─── Pan + zoom ───────────────────────────────────────────────────────────

  _bindCanvasPan() {
    // Left-drag on bare background (nodes stopPropagation so this only fires on canvas)
    this._canvasArea.addEventListener('mousedown', e => {
      if (e.button === 0) this._startPan(e);
    });
    // Middle-drag from anywhere
    this._canvasArea.addEventListener('mousedown', e => {
      if (e.button === 1) { e.preventDefault(); this._startPan(e); }
    });
  }

  _startPan(e) {
    const ox = this._viewOffset.x, oy = this._viewOffset.y;
    const sx = e.clientX, sy = e.clientY;
    const onMove = mv => {
      this._viewOffset.x = ox + mv.clientX - sx;
      this._viewOffset.y = oy + mv.clientY - sy;
      this._applyTransform();
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  _bindWheelZoom() {
    this._canvasArea.addEventListener('wheel', e => {
      e.preventDefault();
      const rect = this._canvasArea.getBoundingClientRect();
      const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.05 : 1/1.05;
      const newZoom = Math.max(0.1, Math.min(3, this._zoom * factor));
      const ratio = newZoom / this._zoom;
      this._viewOffset.x = cx - (cx - this._viewOffset.x) * ratio;
      this._viewOffset.y = cy - (cy - this._viewOffset.y) * ratio;
      this._zoom = newZoom;
      this._applyTransform();
    }, { passive: false });
  }

  _zoomBy(factor) {
    const rect = this._canvasArea.getBoundingClientRect();
    const cx = rect.width/2, cy = rect.height/2;
    const newZoom = Math.max(0.1, Math.min(3, this._zoom * factor));
    const ratio = newZoom / this._zoom;
    this._viewOffset.x = cx - (cx - this._viewOffset.x) * ratio;
    this._viewOffset.y = cy - (cy - this._viewOffset.y) * ratio;
    this._zoom = newZoom;
    this._applyTransform();
  }

  _zoomTo(z) {
    const rect = this._canvasArea.getBoundingClientRect();
    const cx = rect.width/2, cy = rect.height/2;
    const ratio = z / this._zoom;
    this._viewOffset.x = cx - (cx - this._viewOffset.x) * ratio;
    this._viewOffset.y = cy - (cy - this._viewOffset.y) * ratio;
    this._zoom = z;
    this._applyTransform();
  }

  _applyTransform() {
    this._viewport.style.transform =
      `translate(${this._viewOffset.x}px,${this._viewOffset.y}px) scale(${this._zoom})`;
    if (this._zoomSlider) this._zoomSlider.value = String(this._zoom);
    if (this._zoomLabel)  this._zoomLabel.textContent = `${Math.round(this._zoom * 100)}%`;
  }

  _clientToGraph(cx, cy) {
    const r = this._canvasArea.getBoundingClientRect();
    return { x: (cx - r.left - this._viewOffset.x) / this._zoom,
             y: (cy - r.top  - this._viewOffset.y) / this._zoom };
  }

  _centerView() {
    if (!this._nodes.length) return;
    const rect = this._canvasArea.getBoundingClientRect();
    let x0=Infinity, y0=Infinity, x1=-Infinity, y1=-Infinity;
    for (const n of this._nodes) {
      const H = nodeHeight(n.type, n);
      x0=Math.min(x0,n.x); y0=Math.min(y0,n.y);
      x1=Math.max(x1,n.x+NODE_W); y1=Math.max(y1,n.y+H);
    }
    this._viewOffset.x = rect.width  / 2 - ((x0+x1)/2) * this._zoom;
    this._viewOffset.y = rect.height / 2 - ((y0+y1)/2) * this._zoom;
    this._applyTransform();
  }

  // ─── Burger menu ──────────────────────────────────────────────────────────

  _bindMenu() {
    this._menuBtn.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      if (!this._menu.hidden) { this._closeMenu(); return; }
      const r = this._menuBtn.getBoundingClientRect();
      this._menu.style.top   = `${r.bottom + 4}px`;
      this._menu.style.right = `${window.innerWidth - r.right}px`;
      this._menu.style.left  = 'auto';
      this._menu.hidden = false;
    });
    document.addEventListener('mousedown', e => {
      if (this._menu.hidden) return;
      if (e.target === this._menuBtn || this._menu.contains(e.target)) return;
      this._closeMenu();
    });
  }
  _closeMenu() { this._menu.hidden = true; }

  // ─── Collection CRUD ──────────────────────────────────────────────────────

  _addCollection() {
    const id = `col_${Date.now()}`;
    this._collections.push({ id, title:'New Collection', open:true, items:[] });
    this._selectedColId = id;
    this._renderCollections();
    this._openRenameForm(id);
  }
  _renameSelected() { if (this._selectedColId) this._openRenameForm(this._selectedColId); }
  _deleteSelected() {
    if (!this._selectedColId) return;
    const idx = this._collections.findIndex(c => c.id === this._selectedColId);
    if (idx < 0) return;
    this._collections.splice(idx, 1);
    this._selectedColId = this._collections[Math.max(0,idx-1)]?.id ?? null;
    this._closeRenameForm(); this._renderCollections();
  }

  // ─── Rename form ──────────────────────────────────────────────────────────

  _openRenameForm(colId) {
    this._closeRenameForm();
    const col     = this._collections.find(c => c.id === colId);
    const section = this._scroll.querySelector(`[data-id="${colId}"]`);
    if (!col || !section) return;
    const toggle = section.querySelector('.ne-collection-toggle');
    const form   = document.createElement('div');
    form.className = 'ne-rename-form';
    const field = document.createElement('div'); field.className = 'ne-rename-field';
    const input = document.createElement('input');
    input.type = 'text'; input.className = 'ne-rename-input';
    input.value = col.title; input.autocomplete = 'off'; input.spellcheck = false;
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button'; clearBtn.className = 'ne-rename-clear';
    clearBtn.innerHTML = '<svg width="7" height="7" viewBox="0 0 8 8"><line x1="1" y1="1" x2="7" y2="7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="7" y1="1" x2="1" y2="7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
    clearBtn.addEventListener('click', () => { input.value = ''; input.focus(); });
    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button'; confirmBtn.className = 'ne-rename-confirm';
    confirmBtn.innerHTML = '<svg width="12" height="9" viewBox="0 0 13 10"><polyline points="1,5 5,9 12,1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';
    const commit = () => {
      const val = input.value.trim(); if (val) col.title = val;
      this._closeRenameForm(); this._renderCollections();
    };
    confirmBtn.addEventListener('click', commit);
    input.addEventListener('keydown', e => { if (e.key==='Enter') commit(); if (e.key==='Escape') this._closeRenameForm(); });
    field.append(input, clearBtn); form.append(field, confirmBtn);
    const tRect = toggle.getBoundingClientRect(), sRect = section.getBoundingClientRect();
    form.style.top = `${tRect.top - sRect.top}px`; form.style.height = `${tRect.height}px`;
    section.appendChild(form);
    this._renaming = { id: colId, form };
    input.focus(); input.select();
  }
  _closeRenameForm() {
    if (!this._renaming) return;
    this._renaming.form.remove(); this._renaming = null;
  }

  // ─── Window drag ──────────────────────────────────────────────────────────

  _bindDrag() {
    let ox, oy, ol, ot;
    this._titleBar.addEventListener('mousedown', e => {
      if (e.target.closest('button')) return;
      e.preventDefault();
      const r = this._overlay.getBoundingClientRect();
      ox=e.clientX; oy=e.clientY; ol=r.left; ot=r.top;
      const move = mv => {
        this._overlay.style.left   = `${ol + mv.clientX - ox}px`;
        this._overlay.style.top    = `${ot + mv.clientY - oy}px`;
        this._overlay.style.right  = 'auto'; this._overlay.style.bottom = 'auto';
      };
      const up = () => { document.removeEventListener('mousemove',move); document.removeEventListener('mouseup',up); };
      document.addEventListener('mousemove',move); document.addEventListener('mouseup',up);
    });
  }

  _centre() {
    const W = parseInt(this._overlay.style.width,10), H = parseInt(this._overlay.style.height,10);
    this._overlay.style.left   = `${Math.round((window.innerWidth-W)/2)}px`;
    this._overlay.style.top    = `${Math.round((window.innerHeight-H)/2)}px`;
    this._overlay.style.right  = 'auto'; this._overlay.style.bottom = 'auto';
  }

  // ─── Resize ───────────────────────────────────────────────────────────────

  _bindResize() {
    const MIN_W=480, MIN_H=300;
    this._overlay.querySelectorAll('.ne-resize').forEach(handle => {
      handle.addEventListener('mousedown', e => {
        e.preventDefault(); e.stopPropagation();
        const dir=handle.dataset.dir, r=this._overlay.getBoundingClientRect();
        const sx=e.clientX, sy=e.clientY, sw=r.width, sh=r.height, sl=r.left, st=r.top;
        const move = mv => {
          const dx=mv.clientX-sx, dy=mv.clientY-sy;
          let w=sw, h=sh, l=sl, t=st;
          if (dir.includes('e')) w=Math.max(MIN_W,sw+dx);
          if (dir.includes('s')) h=Math.max(MIN_H,sh+dy);
          if (dir.includes('w')) { w=Math.max(MIN_W,sw-dx); l=sl+sw-w; }
          if (dir.includes('n')) { h=Math.max(MIN_H,sh-dy); t=st+sh-h; }
          Object.assign(this._overlay.style,{ width:`${w}px`,height:`${h}px`,left:`${l}px`,top:`${t}px`,right:'auto',bottom:'auto' });
        };
        const up = () => { document.removeEventListener('mousemove',move); document.removeEventListener('mouseup',up); };
        document.addEventListener('mousemove',move); document.addEventListener('mouseup',up);
      });
    });
  }
}
