
// VERIFIER.JS - File Validation System for RenderDeck
// Validates OBJ files, MTL files, and texture images

export class ModelVerifier {
  constructor() {
    // Allowed file extensions
    this.ALLOWED_EXTENSIONS = {
      model: ['.obj'],
      material: ['.mtl'],
      texture: ['.png', '.jpg', '.jpeg', '.svg', '.webp', '.bmp', '.gif']
    };

    // File size limits (in bytes)
    this.MAX_FILE_SIZE = {
      model: 50 * 1024 * 1024,      // 50MB for OBJ files
      material: 1 * 1024 * 1024,     // 1MB for MTL files
      texture: 10 * 1024 * 1024      // 10MB for textures
    };
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

    // Separate files by type
    const objFiles = [];
    const mtlFiles = [];
    const textureFiles = [];
    const unknownFiles = [];

    fileArray.forEach(file => {
      const ext = this.getFileExtension(file.name);
      
      if (this.ALLOWED_EXTENSIONS.model.includes(ext)) {
        objFiles.push(file);
      } else if (this.ALLOWED_EXTENSIONS.material.includes(ext)) {
        mtlFiles.push(file);
      } else if (this.ALLOWED_EXTENSIONS.texture.includes(ext)) {
        textureFiles.push(file);
      } else {
        unknownFiles.push(file);
      }
    });

    // Warning for unknown files
    if (unknownFiles.length > 0) {
      results.warnings.push(`Ignoring ${unknownFiles.length} unknown file(s): ${unknownFiles.map(f => f.name).join(', ')}`);
    }

    // Validate OBJ file (required)
    if (objFiles.length === 0) {
      results.valid = false;
      results.errors.push('No .obj file found. An OBJ file is required.');
    } else if (objFiles.length > 1) {
      results.valid = false;
      results.errors.push(`Multiple .obj files found: ${objFiles.map(f => f.name).join(', ')}. Only one is allowed.`);
    } else {
      const objValidation = await this.validateOBJFile(objFiles[0]);
      if (objValidation.valid) {
        results.files.obj = objFiles[0];
        results.metadata.objInfo = objValidation.metadata;
      } else {
        results.valid = false;
        results.errors.push(...objValidation.errors);
      }
    }

    // Validate MTL file (optional)
    if (mtlFiles.length > 1) {
      results.warnings.push(`Multiple .mtl files found: ${mtlFiles.map(f => f.name).join(', ')}. Using first one.`);
      const mtlValidation = await this.validateMTLFile(mtlFiles[0]);
      if (mtlValidation.valid) {
        results.files.mtl = mtlFiles[0];
        results.metadata.mtlInfo = mtlValidation.metadata;
      } else {
        results.warnings.push(...mtlValidation.errors);
      }
    } else if (mtlFiles.length === 1) {
      const mtlValidation = await this.validateMTLFile(mtlFiles[0]);
      if (mtlValidation.valid) {
        results.files.mtl = mtlFiles[0];
        results.metadata.mtlInfo = mtlValidation.metadata;
      } else {
        results.warnings.push(...mtlValidation.errors);
      }
    }

    // Validate textures (optional)
    for (const textureFile of textureFiles) {
      const textureValidation = await this.validateTextureFile(textureFile);
      if (textureValidation.valid) {
        results.files.textures.push(textureFile);
      } else {
        results.warnings.push(`Texture ${textureFile.name}: ${textureValidation.errors.join(', ')}`);
      }
    }

    // Cross-reference: Check if MTL references textures that are present
    if (results.files.mtl && results.metadata.mtlInfo?.referencedTextures) {
      const mtlTextures = results.metadata.mtlInfo.referencedTextures;
      const providedTextureNames = results.files.textures.map(f => f.name);
      
      const missingTextures = mtlTextures.filter(texName => 
        !providedTextureNames.includes(texName)
      );

      if (missingTextures.length > 0) {
        results.warnings.push(`MTL references missing textures: ${missingTextures.join(', ')}`);
      }
    }

    // Success summary
    if (results.valid) {
      results.metadata.summary = {
        objFile: results.files.obj.name,
        mtlFile: results.files.mtl?.name || 'none',
        textureCount: results.files.textures.length,
        totalSize: this.calculateTotalSize(fileArray)
      };
    }

    return results;
  }

  // ─────────────────────────────────────────────
  // Validate OBJ file
  // ─────────────────────────────────────────────
  async validateOBJFile(file) {
    const result = {
      valid: true,
      errors: [],
      metadata: {}
    };

    // Check file extension
    if (!this.ALLOWED_EXTENSIONS.model.includes(this.getFileExtension(file.name))) {
      result.valid = false;
      result.errors.push(`Invalid file extension. Expected .obj, got ${this.getFileExtension(file.name)}`);
      return result;
    }

    // Check file size
    if (file.size > this.MAX_FILE_SIZE.model) {
      result.valid = false;
      result.errors.push(`File too large: ${this.formatBytes(file.size)}. Maximum allowed: ${this.formatBytes(this.MAX_FILE_SIZE.model)}`);
      return result;
    }

    if (file.size === 0) {
      result.valid = false;
      result.errors.push('File is empty');
      return result;
    }

    // Read and validate content
    try {
      const content = await this.readFileAsText(file);
      const lines = content.split('\n');

      // Check for basic OBJ structure
      const hasVertices = lines.some(line => line.trim().startsWith('v '));
      const hasFaces = lines.some(line => line.trim().startsWith('f '));

      if (!hasVertices) {
        result.valid = false;
        result.errors.push('No vertex data found in OBJ file');
      }

      if (!hasFaces) {
        result.valid = false;
        result.errors.push('No face data found in OBJ file');
      }

      // Extract metadata
      const vertexCount = lines.filter(line => line.trim().startsWith('v ')).length;
      const faceCount = lines.filter(line => line.trim().startsWith('f ')).length;
      const mtlLibLine = lines.find(line => line.trim().startsWith('mtllib '));
      const referencedMTL = mtlLibLine ? mtlLibLine.split(/\s+/)[1] : null;

      result.metadata = {
        vertexCount,
        faceCount,
        referencedMTL,
        fileSize: file.size
      };

    } catch (error) {
      result.valid = false;
      result.errors.push(`Failed to read OBJ file: ${error.message}`);
    }

    return result;
  }

  // ─────────────────────────────────────────────
  // Validate MTL file
  // ─────────────────────────────────────────────
  async validateMTLFile(file) {
    const result = {
      valid: true,
      errors: [],
      metadata: {}
    };

    // Check file extension
    if (!this.ALLOWED_EXTENSIONS.material.includes(this.getFileExtension(file.name))) {
      result.valid = false;
      result.errors.push(`Invalid file extension. Expected .mtl, got ${this.getFileExtension(file.name)}`);
      return result;
    }

    // Check file size
    if (file.size > this.MAX_FILE_SIZE.material) {
      result.valid = false;
      result.errors.push(`File too large: ${this.formatBytes(file.size)}. Maximum: ${this.formatBytes(this.MAX_FILE_SIZE.material)}`);
      return result;
    }

    if (file.size === 0) {
      result.valid = false;
      result.errors.push('File is empty');
      return result;
    }

    // Read and validate content
    try {
      const content = await this.readFileAsText(file);
      const lines = content.split('\n');

      // Check for material definitions
      const hasMaterial = lines.some(line => line.trim().startsWith('newmtl '));
      if (!hasMaterial) {
        result.valid = false;
        result.errors.push('No material definitions found in MTL file');
      }

      // Extract referenced textures
      const textureLines = lines.filter(line => {
        const trimmed = line.trim();
        return trimmed.startsWith('map_Kd ') || 
               trimmed.startsWith('map_Ka ') || 
               trimmed.startsWith('map_Ks ') ||
               trimmed.startsWith('map_Bump ') ||
               trimmed.startsWith('map_d ');
      });

      const referencedTextures = textureLines.map(line => {
        const parts = line.trim().split(/\s+/);
        // Get the last part (the filename), handle paths
        const texPath = parts[parts.length - 1];
        // Extract just the filename (remove any path separators)
        return texPath.split(/[/\\]/).pop();
      });

      // Check for absolute paths (warning)
      const hasAbsolutePaths = textureLines.some(line => {
        return line.includes(':\\') || line.includes('C:') || line.startsWith('/');
      });

      if (hasAbsolutePaths) {
        result.errors.push('MTL file contains absolute texture paths. These should be relative filenames only.');
        result.valid = false;
      }

      result.metadata = {
        materialCount: lines.filter(line => line.trim().startsWith('newmtl ')).length,
        referencedTextures: [...new Set(referencedTextures)], // Remove duplicates
        fileSize: file.size
      };

    } catch (error) {
      result.valid = false;
      result.errors.push(`Failed to read MTL file: ${error.message}`);
    }

    return result;
  }

  // ─────────────────────────────────────────────
  // Validate texture/image file
  // ─────────────────────────────────────────────
  async validateTextureFile(file) {
    const result = {
      valid: true,
      errors: [],
      metadata: {}
    };

    // Check file extension
    const ext = this.getFileExtension(file.name);
    if (!this.ALLOWED_EXTENSIONS.texture.includes(ext)) {
      result.valid = false;
      result.errors.push(`Invalid image extension: ${ext}. Allowed: ${this.ALLOWED_EXTENSIONS.texture.join(', ')}`);
      return result;
    }

    // Check file size
    if (file.size > this.MAX_FILE_SIZE.texture) {
      result.valid = false;
      result.errors.push(`Texture too large: ${this.formatBytes(file.size)}. Maximum: ${this.formatBytes(this.MAX_FILE_SIZE.texture)}`);
      return result;
    }

    if (file.size === 0) {
      result.valid = false;
      result.errors.push('File is empty');
      return result;
    }

    // Validate image by trying to load it
    try {
      const dimensions = await this.getImageDimensions(file);
      result.metadata = {
        width: dimensions.width,
        height: dimensions.height,
        fileSize: file.size,
        format: ext.substring(1).toUpperCase()
      };

      // Warn about very large textures
      if (dimensions.width > 4096 || dimensions.height > 4096) {
        result.errors.push(`Large texture (${dimensions.width}x${dimensions.height}). May impact performance.`);
        // Don't set valid to false, just a warning
      }

    } catch (error) {
      result.valid = false;
      result.errors.push(`Failed to load image: ${error.message}`);
    }

    return result;
  }

  // ─────────────────────────────────────────────
  // Helper: Get file extension
  // ─────────────────────────────────────────────
  getFileExtension(filename) {
    const lastDot = filename.lastIndexOf('.');
    return lastDot === -1 ? '' : filename.substring(lastDot).toLowerCase();
  }

  // ─────────────────────────────────────────────
  // Helper: Read file as text
  // ─────────────────────────────────────────────
  readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = (e) => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  }

  // ─────────────────────────────────────────────
  // Helper: Get image dimensions
  // ─────────────────────────────────────────────
  getImageDimensions(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          resolve({ width: img.width, height: img.height });
        };
        img.onerror = () => {
          reject(new Error('Invalid image file'));
        };
        img.src = e.target.result;
      };
      reader.onerror = () => reject(new Error('Failed to read image file'));
      reader.readAsDataURL(file);
    });
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

  // ─────────────────────────────────────────────
  // Helper: Calculate total size of files
  // ─────────────────────────────────────────────
  calculateTotalSize(files) {
    return files.reduce((sum, file) => sum + file.size, 0);
  }

  // ─────────────────────────────────────────────
  // Generate verification report (for display)
  // ─────────────────────────────────────────────
  generateReport(verificationResult) {
    let report = '';

    if (verificationResult.valid) {
      report += 'VERIFICATION PASSED\n\n';
      
      const meta = verificationResult.metadata.summary;
      report += `📦 OBJ File: ${meta.objFile}\n`;
      report += `📄 MTL File: ${meta.mtlFile}\n`;
      report += `🖼️  Textures: ${meta.textureCount} file(s)\n`;
      report += `💾 Total Size: ${this.formatBytes(meta.totalSize)}\n`;

      if (verificationResult.metadata.objInfo) {
        report += `\n📊 Model Stats:\n`;
        report += `   Vertices: ${verificationResult.metadata.objInfo.vertexCount.toLocaleString()}\n`;
        report += `   Faces: ${verificationResult.metadata.objInfo.faceCount.toLocaleString()}\n`;
      }

      if (verificationResult.warnings.length > 0) {
        report += `\nWARNINGS:\n`;
        verificationResult.warnings.forEach(w => report += `   - ${w}\n`);
      }

    } else {
      report += 'VERIFICATION FAILED\n\n';
      report += `ERRORS:\n`;
      verificationResult.errors.forEach(e => report += `   ❌ ${e}\n`);

      if (verificationResult.warnings.length > 0) {
        report += `\nWARNINGS:\n`;
        verificationResult.warnings.forEach(w => report += `   ⚠️  ${w}\n`);
      }
    }

    return report;
  }
}