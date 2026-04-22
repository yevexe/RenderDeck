package com.renderdeck.service;

import com.renderdeck.entity.Decal;
import com.renderdeck.entity.Part;
import com.renderdeck.entity.ProductModel;
import com.renderdeck.entity.Project;
import com.renderdeck.exception.ForbiddenException;
import com.renderdeck.exception.NotFoundException;
import com.renderdeck.repository.DecalRepository;
import com.renderdeck.repository.PartRepository;
import com.renderdeck.repository.ProductModelRepository;
import com.renderdeck.repository.ProjectRepository;
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
    private final ProjectRepository projectRepository;

    private void checkProjectOwnership(UUID projectId, UUID requestingUserId) {
        Project project = projectRepository.findById(projectId)
                .orElseThrow(() -> new NotFoundException("Project not found"));
        if (!project.getUserId().equals(requestingUserId)) throw new ForbiddenException();
    }

    private void checkModelOwnership(UUID modelId, UUID requestingUserId) {
        ProductModel model = modelRepository.findById(modelId)
                .orElseThrow(() -> new NotFoundException("Model not found"));
        checkProjectOwnership(model.getProjectId(), requestingUserId);
    }

    private void checkPartOwnership(UUID partId, UUID requestingUserId) {
        Part part = partRepository.findById(partId)
                .orElseThrow(() -> new NotFoundException("Part not found"));
        checkModelOwnership(part.getModelId(), requestingUserId);
    }

    public List<ProductModel> getModelsForProject(UUID projectId, UUID requestingUserId) {
        checkProjectOwnership(projectId, requestingUserId);
        return modelRepository.findByProjectId(projectId);
    }

    public ProductModel getModel(UUID modelId, UUID requestingUserId) {
        checkModelOwnership(modelId, requestingUserId);
        return modelRepository.findById(modelId)
                .orElseThrow(() -> new NotFoundException("Model not found"));
    }

    @Transactional
    public ProductModel createModel(UUID projectId, UUID requestingUserId, String name, String baseModel,
                                     UUID customModelAssetId, String sourceType) {
        checkProjectOwnership(projectId, requestingUserId);
        ProductModel model = new ProductModel();
        model.setProjectId(projectId);
        model.setName(name);
        model.setBaseModel(baseModel);
        model.setCustomModelAssetId(customModelAssetId);
        model.setSourceType(sourceType);
        return modelRepository.save(model);
    }

    @Transactional
    public ProductModel updateModel(UUID modelId, UUID requestingUserId, String name,
                                     String baseModel, UUID customModelAssetId) {
        checkModelOwnership(modelId, requestingUserId);
        ProductModel model = modelRepository.findById(modelId)
                .orElseThrow(() -> new NotFoundException("Model not found"));
        if (name != null) model.setName(name);
        if (baseModel != null) model.setBaseModel(baseModel);
        if (customModelAssetId != null) model.setCustomModelAssetId(customModelAssetId);
        return modelRepository.save(model);
    }

    @Transactional
    public void deleteModel(UUID modelId, UUID requestingUserId) {
        checkModelOwnership(modelId, requestingUserId);
        List<Part> parts = partRepository.findByModelId(modelId);
        for (Part part : parts) {
            decalRepository.deleteByPartId(part.getId());
        }
        partRepository.deleteByModelId(modelId);
        modelRepository.deleteById(modelId);
    }

    public List<Part> getPartsForModel(UUID modelId, UUID requestingUserId) {
        checkModelOwnership(modelId, requestingUserId);
        return partRepository.findByModelId(modelId);
    }

    @Transactional
    public Part upsertPart(UUID modelId, UUID partId, String name, UUID materialId,
                            Map<String, Object> materialOverrides, UUID requestingUserId) {
        checkModelOwnership(modelId, requestingUserId);
        Part part = partId != null ? partRepository.findById(partId).orElse(new Part()) : new Part();
        part.setModelId(modelId);
        part.setName(name);
        part.setMaterialId(materialId);
        part.setMaterialOverrides(materialOverrides);
        return partRepository.save(part);
    }

    @Transactional
    public void deletePart(UUID partId, UUID requestingUserId) {
        checkPartOwnership(partId, requestingUserId);
        decalRepository.deleteByPartId(partId);
        partRepository.deleteById(partId);
    }

    public List<Decal> getDecalsForPart(UUID partId, UUID requestingUserId) {
        checkPartOwnership(partId, requestingUserId);
        return decalRepository.findByPartId(partId);
    }

    @Transactional
    public Decal upsertDecal(UUID partId, UUID decalId, UUID assetId,
                              double posX, double posY, double sizeW, double sizeH,
                              double rotation, int layerOrder,
                              String name, String type, Map<String, Object> textData,
                              boolean flipH, boolean flipV, Double aspectRatio,
                              UUID requestingUserId) {
        checkPartOwnership(partId, requestingUserId);
        Decal decal = decalId != null ? decalRepository.findById(decalId).orElse(new Decal()) : new Decal();
        decal.setPartId(partId);
        decal.setAssetId(assetId);
        decal.setPosX(posX);
        decal.setPosY(posY);
        decal.setSizeW(sizeW);
        decal.setSizeH(sizeH);
        decal.setRotation(rotation);
        decal.setLayerOrder(layerOrder);
        decal.setName(name);
        decal.setType(type != null ? type : "image");
        decal.setTextData(textData);
        decal.setFlipH(flipH);
        decal.setFlipV(flipV);
        decal.setAspectRatio(aspectRatio);
        return decalRepository.save(decal);
    }

    @Transactional
    public void deleteDecal(UUID decalId, UUID requestingUserId) {
        Decal decal = decalRepository.findById(decalId)
                .orElseThrow(() -> new NotFoundException("Decal not found"));
        checkPartOwnership(decal.getPartId(), requestingUserId);
        decalRepository.deleteById(decalId);
    }
}
