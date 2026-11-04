import * as THREE from 'three';

// The editors own a single material per part. Split OBJ usemtl groups before
// either the regular or custom loader assigns stable part names.
// Material.clone() copies userData, so each clone keeps its file material's library id.
export function prepareModelParts(object) {
  const meshes = [];
  const originals = new Set();
  object.traverse(child => { if (child.isMesh) meshes.push(child); });
  for (const mesh of meshes) {
    const materials = [mesh.material].flat();
    materials.forEach(material => { if (material) originals.add(material); });
    if (!Array.isArray(mesh.material)) {
      if (mesh.material) mesh.material = mesh.material.clone();
      continue;
    }
    const source = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
    for (let index = 0; index < materials.length; index++) {
      const groups = source.groups.filter(group => group.materialIndex === index);
      if (!groups.length) continue;
      const geometry = new THREE.BufferGeometry();
      const count = groups.reduce((sum, group) => sum + group.count, 0);
      for (const [name, attribute] of Object.entries(source.attributes)) {
        const array = new attribute.array.constructor(count * attribute.itemSize);
        let offset = 0;
        for (const group of groups) {
          array.set(attribute.array.subarray(group.start * attribute.itemSize, (group.start + group.count) * attribute.itemSize), offset);
          offset += group.count * attribute.itemSize;
        }
        geometry.setAttribute(name, new THREE.BufferAttribute(array, attribute.itemSize, attribute.normalized));
      }
      const part = new THREE.Mesh(geometry, materials[index].clone());
      part.name = `${mesh.name || 'Part'} — ${materials[index].name || `Material ${index + 1}`}`;
      part.position.copy(mesh.position);
      part.quaternion.copy(mesh.quaternion);
      part.scale.copy(mesh.scale);
      part.userData = { ...mesh.userData };
      mesh.parent.add(part);
    }
    mesh.removeFromParent();
    mesh.geometry.dispose();
    if (source !== mesh.geometry) source.dispose();
  }
  originals.forEach(material => material.dispose());
  return object;
}
