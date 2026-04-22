package com.renderdeck.service;

import com.renderdeck.entity.Asset;
import com.renderdeck.entity.Material;
import com.renderdeck.entity.MaterialChannelMap;
import com.renderdeck.exception.ForbiddenException;
import com.renderdeck.exception.NotFoundException;
import com.renderdeck.repository.AssetRepository;
import com.renderdeck.repository.MaterialChannelMapRepository;
import com.renderdeck.repository.MaterialRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class MaterialService {

    private final MaterialRepository materialRepository;
    private final MaterialChannelMapRepository channelMapRepository;
    private final AssetRepository assetRepository;
    private final AssetService assetService;

    public List<Material> getMaterialsForProject(UUID projectId, UUID requestingUserId) {
        List<Material> materials = materialRepository.findByProjectId(projectId);
        materials.forEach(m -> {
            if (!m.getUserId().equals(requestingUserId)) throw new ForbiddenException();
        });
        return materials;
    }

    @Transactional
    public Material upsert(UUID materialId, UUID userId, UUID projectId, String name, Map<String, Object> materialValues) {
        Material material = materialRepository.findById(materialId).orElse(new Material());
        if (material.getId() == null) {
            material.setId(materialId);
        } else if (!material.getUserId().equals(userId)) {
            throw new ForbiddenException();
        }
        material.setUserId(userId);
        material.setProjectId(projectId);
        material.setName(name);
        material.setMaterialValues(materialValues);
        return materialRepository.save(material);
    }

    @Transactional
    public MaterialChannelMap upsertChannelMap(UUID materialId, String channel, UUID userId, MultipartFile file) throws IOException {
        Material material = materialRepository.findById(materialId)
                .orElseThrow(() -> new NotFoundException("Material not found"));
        if (!material.getUserId().equals(userId)) throw new ForbiddenException();

        // Remove old channel map asset if one exists for this channel
        channelMapRepository.findByMaterialIdAndChannel(materialId, channel).ifPresent(existing -> {
            assetService.delete(existing.getAssetId(), userId);
            channelMapRepository.delete(existing);
        });

        Asset asset = assetService.upload(userId, material.getProjectId(), file);

        MaterialChannelMap map = new MaterialChannelMap();
        map.setMaterialId(materialId);
        map.setChannel(channel);
        map.setAssetId(asset.getId());
        return channelMapRepository.save(map);
    }

    public List<MaterialChannelMap> getChannelMaps(UUID materialId, UUID requestingUserId) {
        Material material = materialRepository.findById(materialId)
                .orElseThrow(() -> new NotFoundException("Material not found"));
        if (!material.getUserId().equals(requestingUserId)) throw new ForbiddenException();
        return channelMapRepository.findByMaterialId(materialId);
    }

    @Transactional
    public void deleteMaterial(UUID materialId, UUID requestingUserId) {
        Material material = materialRepository.findById(materialId)
                .orElseThrow(() -> new NotFoundException("Material not found"));
        if (!material.getUserId().equals(requestingUserId)) throw new ForbiddenException();

        List<MaterialChannelMap> maps = channelMapRepository.findByMaterialId(materialId);
        maps.forEach(m -> assetService.delete(m.getAssetId(), requestingUserId));
        channelMapRepository.deleteByMaterialId(materialId);
        materialRepository.delete(material);
    }

    @Transactional
    public void deleteChannelMap(UUID channelMapId, UUID requestingUserId) {
        MaterialChannelMap map = channelMapRepository.findById(channelMapId)
                .orElseThrow(() -> new NotFoundException("Channel map not found"));
        Material material = materialRepository.findById(map.getMaterialId())
                .orElseThrow(() -> new NotFoundException("Material not found"));
        if (!material.getUserId().equals(requestingUserId)) throw new ForbiddenException();
        assetService.delete(map.getAssetId(), requestingUserId);
        channelMapRepository.delete(map);
    }
}
