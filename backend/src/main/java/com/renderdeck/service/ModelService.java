package com.renderdeck.service;

import com.renderdeck.entity.Decal;
import com.renderdeck.entity.Part;
import com.renderdeck.entity.ProductModel;
import com.renderdeck.repository.DecalRepository;
import com.renderdeck.repository.PartRepository;
import com.renderdeck.repository.ProductModelRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class ModelService {

    private final ProductModelRepository modelRepository;
    private final PartRepository partRepository;
    private final DecalRepository decalRepository;

    public ProductModel getModelForProject(UUID projectId) {
        return modelRepository.findByProjectId(projectId)
                .orElseThrow(() -> new RuntimeException("Model not found for project"));
    }

    @Transactional
    public ProductModel upsertModel(UUID projectId, String baseModel, UUID customModelAssetId) {
        ProductModel model = modelRepository.findByProjectId(projectId).orElse(new ProductModel());
        model.setProjectId(projectId);
        model.setBaseModel(baseModel);
        model.setCustomModelAssetId(customModelAssetId);
        return modelRepository.save(model);
    }

    public List<Part> getPartsForModel(UUID modelId) {
        return partRepository.findByModelId(modelId);
    }

    @Transactional
    public Part upsertPart(UUID modelId, UUID partId, String name, UUID materialId) {
        Part part = partId != null ? partRepository.findById(partId).orElse(new Part()) : new Part();
        part.setModelId(modelId);
        part.setName(name);
        part.setMaterialId(materialId);
        return partRepository.save(part);
    }

    @Transactional
    public void deletePart(UUID partId) {
        decalRepository.deleteByPartId(partId);
        partRepository.deleteById(partId);
    }

    public List<Decal> getDecalsForPart(UUID partId) {
        return decalRepository.findByPartId(partId);
    }

    @Transactional
    public Decal upsertDecal(UUID partId, UUID decalId, UUID assetId,
                              double posX, double posY, double scaleX, double scaleY,
                              double rotation, int layerOrder) {
        Decal decal = decalId != null ? decalRepository.findById(decalId).orElse(new Decal()) : new Decal();
        decal.setPartId(partId);
        decal.setAssetId(assetId);
        decal.setPosX(posX);
        decal.setPosY(posY);
        decal.setScaleX(scaleX);
        decal.setScaleY(scaleY);
        decal.setRotation(rotation);
        decal.setLayerOrder(layerOrder);
        return decalRepository.save(decal);
    }

    @Transactional
    public void deleteDecal(UUID decalId) {
        decalRepository.deleteById(decalId);
    }
}
