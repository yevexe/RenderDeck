import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { fileDataURL, loadDesignImage } from '../utils/imageAssets.js';
import { fileName, mapLine, parseMap } from './MTLUtils.js';
import { assertSelfContainedGLTF } from '../utils/modelAssets.js';

// VERIFIER.JS - Universal File Validation System
// Standalone module for validating 3D model files (OBJ/MTL/textures)

export class ModelVerifier {
  constructor(config = {}) {
    // Merge user config with defaults
    const defaults = {
      allowedExtensions: {
        model: ['.obj'],
        material: ['.mtl'],
        texture: ['.png', '.jpg', '.jpeg', '.svg', '.webp', '.bmp', '.gif']
      },
      maxFileSize: {
        model: 200 * 1024 * 1024,      // 200MB for OBJ/GLB files (increased)
        material: 1 * 1024 * 1024,     // 1MB for MTL files
        texture: 20 * 1024 * 1024      // 20MB for textures (increased!)
      },
      maxImageDimension: 8192,  // Warn if image is larger than this
      allowAbsolutePaths: false // In MTL files
    };
    
    this.config = { ...defaults, ...config };
    
    // For backward compatibility
    this.ALLOWED_EXTENSIONS = this.config.allowedExtensions;
    this.MAX_FILE_SIZE = this.config.maxFileSize;
  }

  // ─────────────────────────────────────────────
  // Main verification function for a model folder
  // ─────────────────────────────────────────────
  async verifyModelFolder(files) {
    const results = {
      valid: true,
      errors: [],
      warnings: [],
      files: {
        glb: null,
        obj: null,
        mtl: null,
        textures: []
      },
      metadata: {}
    };

    // Convert FileList to Array if needed
    const fileArray = Array.from(files);

    if (fileArray.length === 0) {
      results.valid = false;
      results.errors.push('No files provided');
      return results;
    }

    const supported = new Set(['.obj', '.mtl', '.glb', ...this.config.allowedExtensions.texture]);
    const unsupported = fileArray.filter(file => !supported.has(this.getFileExtension(file.name)));
    if (unsupported.length) {
      results.valid = false;
      results.errors.push(`Unsupported model files: ${unsupported.map(file => file.name).join(', ')}`);
      return results;
    }

    const seenNames = new Set();
    for (const file of fileArray) {
      const key = fileName(file.name).toLowerCase();
      if (seenNames.has(key)) {
        results.valid = false;
        results.errors.push(`Duplicate file name: ${file.name}`);
      }
      seenNames.add(key);
    }
    if (!results.valid) return results;

    // ── GLB path: single self-contained file ──────────────────────
    const glbFiles = fileArray.filter(f => this.getFileExtension(f.name) === '.glb');
    if (glbFiles.length > 0) {
      if (fileArray.length !== 1) {
        results.valid = false;
        results.errors.push('GLB models must be uploaded as one self-contained file.');
        return results;
      }
      if (glbFiles.length > 1) {
        results.valid = false;
        results.errors.push(`Multiple GLB files found (${glbFiles.length}). Please provide only one.`);
        return results;
      }
      const glbValidation = await this.validateGLBFile(glbFiles[0]);
      results.warnings.push(...glbValidation.warnings);
      if (!glbValidation.valid) {
        results.valid = false;
        results.errors.push(...glbValidation.errors);
      } else {
        results.files.glb = glbFiles[0];
        results.metadata.glbInfo = glbValidation.metadata;
      }
      return results;
    }

    // ── OBJ path ──────────────────────────────────────────────────
    const objFiles = [];
    const mtlFiles = [];
    const textureFiles = [];

    fileArray.forEach(file => {
      const ext = this.getFileExtension(file.name);
      if (this.config.allowedExtensions.model.includes(ext)) {
        objFiles.push(file);
      } else if (this.config.allowedExtensions.material.includes(ext)) {
        mtlFiles.push(file);
      } else if (this.config.allowedExtensions.texture.includes(ext)) {
        textureFiles.push(file);
      }
    });

    // Validate OBJ (required)
    if (objFiles.length === 0) {
      results.valid = false;
      results.errors.push('No OBJ or GLB file found');
    } else if (objFiles.length > 1) {
      results.valid = false;
      results.errors.push(`Multiple OBJ files found (${objFiles.length}). Please provide only one.`);
    } else {
      const objValidation = await this.validateOBJFile(objFiles[0]);
      if (objValidation.valid) {
        results.files.obj = objFiles[0];
        results.metadata.objInfo = objValidation.metadata;
      } else {
        results.valid = false;
        results.errors.push(...objValidation.errors);
      }
      results.warnings.push(...objValidation.warnings);
    }

    // Resolve mtllib by file name, including references containing spaces.
    const references = results.metadata.objInfo?.mtlFiles || [];
    const selected = mtlFiles.filter(file => references.some(reference => {
      const target = fileName(file.name).toLowerCase();
      const ref = reference.replace(/\\/g, '/').replace(/['"]/g, '').toLowerCase();
      return fileName(ref) === target || (` ${ref.replaceAll('/', ' ')} `).includes(` ${target} `);
    }));
    if (!selected.length && mtlFiles.length === 1) {
      selected.push(mtlFiles[0]);
      if (references.length) results.warnings.push(`mtllib names ${references.join(', ')}; using the only supplied material file "${mtlFiles[0].name}".`);
    } else if (!selected.length && mtlFiles.length > 1) {
      results.valid = false;
      results.errors.push(`None of the supplied MTL files matches mtllib: ${references.join(', ') || '(not specified)'}`);
    }
    results.files.mtls = mtlFiles;
    results.files.selectedMtlNames = selected.map(file => file.name);
    const materialNames = [];
    const referencedTextures = [];
    for (const file of selected) {
      const validation = await this.validateMTLFile(file);
      results.warnings.push(...validation.errors, ...validation.warnings);
      materialNames.push(...(validation.metadata.materialNames || []));
      referencedTextures.push(...(validation.metadata.referencedTextures || []));
    }
    if (selected.length) {
      results.files.mtl = selected[0];
      results.metadata.mtlInfo = { materialNames, materialCount: materialNames.length, referencedTextures };
    }
    for (const name of results.metadata.objInfo?.usedMaterials || []) {
      if (!materialNames.includes(name)) results.warnings.push(`Unmatched material "${name}": no matching newmtl; using the default material.`);
    }

    // Validate textures (optional)
    for (const textureFile of textureFiles) {
      const textureValidation = await this.validateTextureFile(textureFile);
      if (textureValidation.valid) {
        results.files.textures.push(textureFile);
      } else {
        results.valid = false;
        results.errors.push(...textureValidation.errors.map(e => `Texture ${textureFile.name}: ${e}`));
      }
      results.warnings.push(...textureValidation.warnings.map(w => `Texture ${textureFile.name}: ${w}`));
    }

    // Cross-validation: Check if MTL references match provided textures
    if (results.files.mtl && results.metadata.mtlInfo?.referencedTextures) {
      const providedTextureNames = results.files.textures.map(f => f.name);
      results.metadata.mtlInfo.referencedTextures.forEach(refTexture => {
        if (!providedTextureNames.some(name => name.toLowerCase() === fileName(refTexture).toLowerCase())) {
          results.warnings.push(`MTL references texture "${refTexture}" which was not provided`);
        }
      });
    }

    return results;
  }

  // ─────────────────────────────────────────────
  // Validate a single GLB file
  // ─────────────────────────────────────────────
  async validateGLBFile(file) {
    const result = { valid: true, errors: [], warnings: [], metadata: {} };

    if (this.getFileExtension(file.name) !== '.glb') {
      result.valid = false;
      result.errors.push(`Invalid file extension: expected .glb`);
      return result;
    }

    if (file.size > this.config.maxFileSize.model) {
      result.valid = false;
      result.errors.push(`File too large: ${this.formatBytes(file.size)}. Max: ${this.formatBytes(this.config.maxFileSize.model)}`);
      return result;
    }

    // Check GLB magic bytes: first 4 bytes must be 'glTF' (0x46546C67 little-endian)
    try {
      const header = await file.slice(0, 12).arrayBuffer();
      const view = new DataView(header);
      const magic = view.getUint32(0, true);
      if (magic !== 0x46546C67) {
        result.valid = false;
        result.errors.push('Not a valid GLB file (incorrect magic bytes)');
        return result;
      }
      const version = view.getUint32(4, true);
      if (version !== 2) {
        result.warnings.push(`GLB version ${version} detected — only version 2 is supported`);
      }
      result.metadata = { version, size: file.size };
      await assertSelfContainedGLTF(file);
    } catch (error) {
      result.valid = false;
      result.errors.push(`Failed to read GLB header: ${error.message}`);
    }

    return result;
  }

  // ─────────────────────────────────────────────
  // Validate a single OBJ file
  // ─────────────────────────────────────────────
  async validateOBJFile(file) {
    const result = {
      valid: true,
      errors: [],
      warnings: [],
      metadata: {}
    };

    // Check extension
    const ext = this.getFileExtension(file.name);
    if (!this.config.allowedExtensions.model.includes(ext)) {
      result.valid = false;
      result.errors.push(`Invalid file extension: ${ext}. Expected: ${this.config.allowedExtensions.model.join(', ')}`);
      return result;
    }

    // Check file size
    if (file.size > this.config.maxFileSize.model) {
      result.valid = false;
      result.errors.push(`File too large: ${this.formatBytes(file.size)}. Max: ${this.formatBytes(this.config.maxFileSize.model)}`);
      return result;
    }

    // Read and validate content
    try {
      const content = await this.readFileAsText(file);
      
      // Count vertices and faces
      const vertexCount = (content.match(/^v\s/gm) || []).length;
      const faceCount = (content.match(/^f\s/gm) || []).length;
      const mtlReference = content.match(/^mtllib\s+(.+)$/m);

      result.metadata = {
        vertexCount,
        faceCount,
        mtlFile: mtlReference ? mtlReference[1].trim() : null,
        mtlFiles: [...content.matchAll(/^\s*mtllib\s+(.+)$/gmi)].map(match => match[1].trim()),
        usedMaterials: [...new Set([...content.matchAll(/^\s*usemtl\s+(.+)$/gmi)].map(match => match[1].trim()))]
      };

      // Validate has geometry
      if (vertexCount === 0) {
        result.valid = false;
        result.errors.push('OBJ file contains no vertices');
      }
      
      if (faceCount === 0) {
        result.valid = false;
        result.errors.push('OBJ file contains no faces');
      }

      const object = new OBJLoader().parse(content);
      let drawable = false;
      object.traverse(child => {
        if (!child.isMesh) return;
        const position = child.geometry.attributes.position;
        if (position?.count >= 3 && position.array.every(Number.isFinite)) drawable = true;
        else { result.valid = false; result.errors.push('OBJ contains invalid geometry'); }
        child.geometry.dispose();
        for (const material of [child.material].flat()) material?.dispose();
      });
      if (!drawable) { result.valid = false; result.errors.push('OBJ contains no drawable meshes'); }

      // Warnings
      if (vertexCount > 1000000) {
        result.warnings.push(`High vertex count (${vertexCount.toLocaleString()}). May impact performance.`);
      }

    } catch (error) {
      result.valid = false;
      result.errors.push(`Failed to read OBJ file: ${error.message}`);
    }

    return result;
  }

  // ─────────────────────────────────────────────
  // Validate a single MTL file
  // ─────────────────────────────────────────────
  async validateMTLFile(file) {
    const result = {
      valid: true,
      errors: [],
      warnings: [],
      metadata: {}
    };

    // Check extension
    const ext = this.getFileExtension(file.name);
    if (!this.config.allowedExtensions.material.includes(ext)) {
      result.valid = false;
      result.errors.push(`Invalid file extension: ${ext}. Expected: ${this.config.allowedExtensions.material.join(', ')}`);
      return result;
    }

    // Check file size
    if (file.size > this.config.maxFileSize.material) {
      result.valid = false;
      result.errors.push(`File too large: ${this.formatBytes(file.size)}. Max: ${this.formatBytes(this.config.maxFileSize.material)}`);
      return result;
    }

    // Read and validate content
    try {
      const content = await this.readFileAsText(file);
      
      // Check for material definitions
      const materialCount = (content.match(/^newmtl\s/gm) || []).length;
      
      if (materialCount === 0) {
        result.valid = false;
        result.errors.push('MTL file contains no material definitions (newmtl)');
      }

      // Extract referenced textures
      const textureReferences = [];
      for (const line of content.split(/\r?\n/)) {
        const match = line.match(mapLine);
        if (match) textureReferences.push(fileName(parseMap(match[2]).path));
      }

      result.metadata = {
        materialCount,
        materialNames: [...content.matchAll(/^\s*newmtl\s+(.+)$/gmi)].map(match => match[1].trim()),
        referencedTextures: textureReferences
      };

      // Check for absolute paths (usually problematic)
      if (!this.config.allowAbsolutePaths) {
        const hasAbsolutePaths = /^(map_\w+|bump)\s+[A-Za-z]:|^(map_\w+|bump)\s+\//m.test(content);
        if (hasAbsolutePaths) {
          result.valid = false;
          result.errors.push('MTL contains absolute file paths. Use relative paths only.');
        }
      }

    } catch (error) {
      result.valid = false;
      result.errors.push(`Failed to read MTL file: ${error.message}`);
    }

    return result;
  }

  // ─────────────────────────────────────────────
  // Validate a single texture file
  // ─────────────────────────────────────────────
  async validateTextureFile(file) {
    const result = {
      valid: true,
      errors: [],
      warnings: [],
      metadata: {}
    };

    // Check extension
    const ext = this.getFileExtension(file.name);
    if (!this.config.allowedExtensions.texture.includes(ext)) {
      result.valid = false;
      result.errors.push(`Invalid file extension: ${ext}. Expected: ${this.config.allowedExtensions.texture.join(', ')}`);
      return result;
    }

    // Check file size
    if (file.size > this.config.maxFileSize.texture) {
      result.valid = false;
      result.errors.push(`File too large: ${this.formatBytes(file.size)}. Max: ${this.formatBytes(this.config.maxFileSize.texture)}`);
      return result;
    }

    // Try to load as image to verify it's valid
    try {
      const imageData = await this.loadImageFromFile(file);
      
      result.metadata = {
        width: imageData.width,
        height: imageData.height,
        size: file.size
      };

      // Warnings for large dimensions
      if (imageData.width > this.config.maxImageDimension || imageData.height > this.config.maxImageDimension) {
        result.warnings.push(`Large image dimensions (${imageData.width}×${imageData.height}). May cause performance issues.`);
      }

    } catch (error) {
      result.valid = false;
      result.errors.push(`Not a valid image file: ${error.message}`);
    }

    return result;
  }

  // ─────────────────────────────────────────────
  // Generate a human-readable report
  // ─────────────────────────────────────────────
  generateReport(verification) {
    let report = '=== File Verification Report ===\n\n';

    if (verification.valid) {
      report += '✅ Status: VALID\n\n';
    } else {
      report += '❌ Status: INVALID\n\n';
    }

    // Files found
    report += 'Files:\n';
    if (verification.files.glb) {
      report += `  ✅ GLB: ${verification.files.glb.name}\n`;
      if (verification.metadata.glbInfo) {
        report += `     - Version: ${verification.metadata.glbInfo.version}\n`;
        report += `     - Size: ${this.formatBytes(verification.metadata.glbInfo.size)}\n`;
      }
    } else if (verification.files.obj) {
      report += `  ✅ OBJ: ${verification.files.obj.name}\n`;
      if (verification.metadata.objInfo) {
        report += `     - Vertices: ${verification.metadata.objInfo.vertexCount.toLocaleString()}\n`;
        report += `     - Faces: ${verification.metadata.objInfo.faceCount.toLocaleString()}\n`;
      }
    } else {
      report += '  ❌ OBJ or GLB: Not found\n';
    }

    if (verification.files.mtl) {
      report += `  ✅ MTL: ${verification.files.mtl.name}\n`;
      if (verification.metadata.mtlInfo) {
        report += `     - Materials: ${verification.metadata.mtlInfo.materialCount}\n`;
        if (verification.metadata.mtlInfo.referencedTextures.length > 0) {
          report += `     - References: ${verification.metadata.mtlInfo.referencedTextures.join(', ')}\n`;
        }
      }
    } else {
      report += '  ⚠️  MTL: Not provided\n';
    }

    if (verification.files.textures.length > 0) {
      report += `  ✅ Textures: ${verification.files.textures.length} file(s)\n`;
      verification.files.textures.forEach(tex => {
        report += `     - ${tex.name}\n`;
      });
    } else {
      report += '  ⚠️  Textures: None provided\n';
    }

    // Errors
    if (verification.errors.length > 0) {
      report += '\nErrors:\n';
      verification.errors.forEach(err => {
        report += `  ❌ ${err}\n`;
      });
    }

    // Warnings
    if (verification.warnings.length > 0) {
      report += '\nWarnings:\n';
      verification.warnings.forEach(warn => {
        report += `  ⚠️  ${warn}\n`;
      });
    }

    return report;
  }

  // ─────────────────────────────────────────────
  // Helper: Get file extension
  // ─────────────────────────────────────────────
  getFileExtension(filename) {
    const match = filename.match(/\.[^.]+$/);
    return match ? match[0].toLowerCase() : '';
  }

  // ─────────────────────────────────────────────
  // Helper: Read file as text
  // ─────────────────────────────────────────────
  readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  }

  // ─────────────────────────────────────────────
  // Helper: Load image from file
  // ─────────────────────────────────────────────
  async loadImageFromFile(file) {
    return await loadDesignImage(await fileDataURL(file));
  }

  // ─────────────────────────────────────────────
  // Helper: Format bytes to human-readable
  // ─────────────────────────────────────────────
  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }
}

// Example:
// import { ModelVerifier } from './verifier.js';
//
// // Use with default settings
// const verifier = new ModelVerifier();
//
// // Or customize:
// const verifier = new ModelVerifier({
//   maxFileSize: {
//     texture: 50 * 1024 * 1024  // Allow 50MB textures
//   },
//   maxImageDimension: 16384  // Allow up to 16K textures
// });
//
// // Verify files
// const result = await verifier.verifyModelFolder(fileList);
// console.log(verifier.generateReport(result));
